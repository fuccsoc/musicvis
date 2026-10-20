import fs from "node:fs";
import path from "node:path";
import { ChildProcessByStdio, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { app } from "electron";
import { debugLog, log } from "./logger";

export interface HelperProcessOptions<T> {
  /** Executable name inside resources/native. */
  name: string;
  debugEnv: string;
  parseLine: (line: string) => T | null;
  onEvent: (event: T) => void;
  onError: (message: string) => void;
  /** Runs right before each spawn, e.g. for diagnostics. */
  beforeSpawn?: (helperPath: string) => void;
  reconnectDelayMs?: number;
}

export function nativeHelperPath(name: string): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
  return path.join(root, "native", name);
}

/** Keeps a native helper running and forwards its JSON-line stdout as events. */
export class HelperProcess<T> {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private restartTimer: NodeJS.Timeout | null = null;

  private shouldRun = false;

  constructor(private readonly options: HelperProcessOptions<T>) {}

  private debug(message: string): void {
    debugLog(this.options.name, message, this.options.debugEnv);
  }

  start(): void {
    if (this.restartTimer || (this.shouldRun && this.child)) {
      this.debug("start skip reason=already-running");
      return;
    }
    this.shouldRun = true;
    this.spawnHelper();
  }

  restart(): void {
    if (this.restartTimer) {
      this.debug("restart skip reason=restart-pending");
      return;
    }
    this.debug("restart requested");
    this.stop();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.shouldRun = true;
      this.spawnHelper();
    }, 250);
  }

  stop(): void {
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
    const helperPath = nativeHelperPath(this.options.name);
    if (!fs.existsSync(helperPath)) {
      this.options.onError(`${this.options.name} not found`);
      log("error", `${this.options.name} missing at ${helperPath}`);
      return;
    }
    this.options.beforeSpawn?.(helperPath);

    const child = spawn(helperPath, [], { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.debug(`spawned pid=${child.pid ?? "unknown"}`);

    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) {
        return;
      }
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = this.options.parseLine(line);
        if (parsed) {
          this.options.onEvent(parsed);
        } else {
          log("warn", `Malformed ${this.options.name} JSON: ${line.slice(0, 500)}`);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        log("warn", `[${this.options.name}${this.child === child ? "" : " stale"}] ${message}`);
      }
    });

    child.on("error", (error) => {
      if (this.child === child) {
        this.options.onError(`${this.options.name} failed to start: ${String(error)}`);
      }
    });

    child.on("close", (code, signal) => {
      this.debug(`close pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (this.child !== child) {
        return;
      }
      this.child = null;
      if (!this.shouldRun || signal === "SIGTERM") {
        return;
      }
      this.options.onError(`${this.options.name} exited unexpectedly (${code ?? "null"})`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.spawnHelper();
      }, this.options.reconnectDelayMs ?? 1500);
    });
  }
}
