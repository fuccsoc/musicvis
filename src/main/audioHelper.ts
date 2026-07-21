import fs from "node:fs";
import path from "node:path";
import { ChildProcessByStdio, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { app } from "electron";
import type { HelperEvent } from "./types";
import { log } from "./logger";

export function parseHelperJsonLine(line: string): HelperEvent | null {
  try {
    const payload = JSON.parse(line) as Partial<HelperEvent>;
    if (payload.type === "audio" && Array.isArray(payload.samples)) {
      return {
        type: "audio",
        timestamp: Number(payload.timestamp) || Date.now(),
        samples: payload.samples.filter((value): value is number => typeof value === "number")
      };
    }
    if (payload.type === "status" && typeof payload.status === "string") {
      if (["started", "permission-denied", "stopped"].includes(payload.status)) {
        return { type: "status", status: payload.status as "started" | "permission-denied" | "stopped" };
      }
      return null;
    }
    if (payload.type === "error" && typeof payload.message === "string") {
      return { type: "error", message: payload.message };
    }
  } catch {
    return null;
  }
  return null;
}

function resolveHelperPath(): string {
  const relativePath = path.join("native", "AudioCaptureHelper");
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "resources", relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
}

export class AudioHelperManager {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private shouldRun = false;

  constructor(private readonly onEvent: (event: HelperEvent) => void) {}

  start(): void {
    if (this.shouldRun && this.child) {
      return;
    }
    this.shouldRun = true;
    this.spawnHelper();
  }

  restart(): void {
    this.stop();
    this.shouldRun = true;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.spawnHelper();
    }, 250);
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  private spawnHelper(): void {
    const helperPath = resolveHelperPath();
    if (!fs.existsSync(helperPath)) {
      this.onEvent({ type: "error", message: "Audio helper not found" });
      log("error", `Audio helper missing at ${helperPath}`);
      return;
    }

    const child = spawn(helperPath, [], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;

    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = parseHelperJsonLine(line);
        if (parsed) {
          this.onEvent(parsed);
        } else {
          log("warn", `Malformed helper JSON: ${line}`);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      log("warn", `[AudioHelper] ${chunk.toString("utf8").trim()}`);
    });

    child.on("close", (code, signal) => {
      this.child = null;
      if (!this.shouldRun) {
        return;
      }
      if (signal === "SIGTERM") {
        return;
      }
      this.onEvent({ type: "error", message: `Audio helper exited unexpectedly (${code ?? "null"})` });
      this.reconnectTimer = setTimeout(() => this.spawnHelper(), 1500);
    });
  }
}
