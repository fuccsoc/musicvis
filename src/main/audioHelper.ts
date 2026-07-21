import fs from "node:fs";
import path from "node:path";
import { ChildProcessByStdio, spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { app } from "electron";
import type { HelperEvent } from "./types";
import { debugLog, log } from "./logger";

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

function probeCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    return `error=${String(result.error)}`;
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().replace(/\s+/g, " ");
  if (output) {
    return output.slice(0, 1200);
  }

  return `status=${result.status ?? "null"} signal=${result.signal ?? "null"}`;
}

function debugHelperPreflight(helperPath: string): void {
  if (process.env.MUSICVIS_DEBUG_AUDIO !== "1") {
    return;
  }

  try {
    const stat = fs.statSync(helperPath);
    debugLog(
      "audio-helper",
      `preflight file mode=${(stat.mode & 0o777).toString(8)} size=${stat.size} mtime=${stat.mtime.toISOString()}`,
      "MUSICVIS_DEBUG_AUDIO"
    );
  } catch (error) {
    debugLog("audio-helper", `preflight stat failed error="${String(error)}"`, "MUSICVIS_DEBUG_AUDIO");
  }

  debugLog(
    "audio-helper",
    `preflight codesign="${probeCommand("codesign", ["-dv", "--verbose=4", helperPath])}"`,
    "MUSICVIS_DEBUG_AUDIO"
  );
  debugLog("audio-helper", `preflight xattr="${probeCommand("xattr", ["-l", helperPath])}"`, "MUSICVIS_DEBUG_AUDIO");
}

export class AudioHelperManager {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private restartTimer: NodeJS.Timeout | null = null;

  private shouldRun = false;

  private lastAudioDebugAt = 0;

  constructor(private readonly onEvent: (event: HelperEvent) => void) {}

  start(): void {
    if (this.restartTimer) {
      debugLog("audio-helper", "start skip reason=restart-pending", "MUSICVIS_DEBUG_AUDIO");
      return;
    }
    if (this.shouldRun && this.child) {
      debugLog("audio-helper", `start skip reason=already-running pid=${this.child.pid ?? "unknown"}`, "MUSICVIS_DEBUG_AUDIO");
      return;
    }
    debugLog("audio-helper", "start requested", "MUSICVIS_DEBUG_AUDIO");
    this.shouldRun = true;
    this.spawnHelper();
  }

  restart(): void {
    if (this.restartTimer) {
      debugLog("audio-helper", "restart skip reason=restart-pending", "MUSICVIS_DEBUG_AUDIO");
      return;
    }
    debugLog("audio-helper", "restart requested", "MUSICVIS_DEBUG_AUDIO");
    this.stop();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.shouldRun = true;
      debugLog("audio-helper", "restart spawning", "MUSICVIS_DEBUG_AUDIO");
      this.spawnHelper();
    }, 250);
  }

  stop(): void {
    debugLog(
      "audio-helper",
      `stop requested hasChild=${Boolean(this.child)} hasReconnect=${Boolean(this.reconnectTimer)} hasRestart=${Boolean(this.restartTimer)}`,
      "MUSICVIS_DEBUG_AUDIO"
    );
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  private spawnHelper(): void {
    const helperPath = resolveHelperPath();
    debugLog("audio-helper", `spawn resolve path="${helperPath}" packaged=${app.isPackaged}`, "MUSICVIS_DEBUG_AUDIO");
    if (!fs.existsSync(helperPath)) {
      this.onEvent({ type: "error", message: "Audio helper not found" });
      log("error", `Audio helper missing at ${helperPath}`);
      return;
    }
    debugHelperPreflight(helperPath);

    const child = spawn(helperPath, [], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    debugLog("audio-helper", `spawned pid=${child.pid ?? "unknown"}`, "MUSICVIS_DEBUG_AUDIO");

    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const isCurrent = this.child === child;
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      debugLog(
        "audio-helper",
        `stdout chunk pid=${child.pid ?? "unknown"} current=${isCurrent} bytes=${chunk.length} lines=${lines.length} buffered=${buffered.length}`,
        "MUSICVIS_DEBUG_AUDIO"
      );
      if (!isCurrent) {
        return;
      }
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = parseHelperJsonLine(line);
        if (parsed) {
          this.debugHelperEvent(parsed);
          this.onEvent(parsed);
        } else {
          debugLog("audio-helper", `stdout malformed line="${line.slice(0, 500)}"`, "MUSICVIS_DEBUG_AUDIO");
          log("warn", `Malformed helper JSON: ${line}`);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const isCurrent = this.child === child;
      const message = chunk.toString("utf8").trim();
      if (message) {
        log("warn", `[AudioHelper${isCurrent ? "" : " stale"}] ${message}`);
      }
    });

    child.on("error", (error) => {
      const isCurrent = this.child === child;
      debugLog(
        "audio-helper",
        `process error pid=${child.pid ?? "unknown"} current=${isCurrent} error="${String(error)}"`,
        "MUSICVIS_DEBUG_AUDIO"
      );
      if (!isCurrent) {
        return;
      }
      this.onEvent({ type: "error", message: `Audio helper failed to start: ${String(error)}` });
    });

    child.on("close", (code, signal) => {
      const isCurrent = this.child === child;
      debugLog(
        "audio-helper",
        `close pid=${child.pid ?? "unknown"} current=${isCurrent} code=${code ?? "null"} signal=${signal ?? "null"} shouldRun=${this.shouldRun}`,
        "MUSICVIS_DEBUG_AUDIO"
      );
      if (!isCurrent) {
        return;
      }
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

  private debugHelperEvent(event: HelperEvent): void {
    if (event.type === "audio") {
      const now = Date.now();
      if (now - this.lastAudioDebugAt < 2000) {
        return;
      }
      this.lastAudioDebugAt = now;
      debugLog("audio-helper", `event audio samples=${event.samples.length} timestamp=${event.timestamp}`, "MUSICVIS_DEBUG_AUDIO");
      return;
    }
    if (event.type === "status") {
      debugLog("audio-helper", `event status=${event.status}`, "MUSICVIS_DEBUG_AUDIO");
      return;
    }
    debugLog("audio-helper", `event error="${event.message}"`, "MUSICVIS_DEBUG_AUDIO");
  }
}
