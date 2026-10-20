import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { HelperEvent } from "../shared/types";
import { HelperProcess } from "./helperProcess";
import { debugLog } from "./logger";

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
  private readonly process: HelperProcess<HelperEvent>;

  private lastAudioDebugAt = 0;

  constructor(onEvent: (event: HelperEvent) => void) {
    this.process = new HelperProcess<HelperEvent>({
      name: "AudioCaptureHelper",
      debugEnv: "MUSICVIS_DEBUG_AUDIO",
      parseLine: parseHelperJsonLine,
      onEvent: (event) => {
        this.debugHelperEvent(event);
        onEvent(event);
      },
      onError: (message) => onEvent({ type: "error", message }),
      beforeSpawn: debugHelperPreflight
    });
  }

  start(): void {
    this.process.start();
  }

  restart(): void {
    this.process.restart();
  }

  stop(): void {
    this.process.stop();
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
