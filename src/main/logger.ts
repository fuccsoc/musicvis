import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export function log(level: "info" | "warn" | "error", message: string): void {
  const payload = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (!app.isPackaged) {
    // eslint-disable-next-line no-console
    console[level === "info" ? "log" : level](payload);
    return;
  }
  try {
    const logsDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "app.log"), `${payload}\n`);
  } catch {
    // eslint-disable-next-line no-console
    console.error(payload);
  }
}

export function debugLog(scope: string, message: string): void {
  if (process.env.MUSICVIS_DEBUG !== "1") {
    return;
  }
  log("info", `debug:${scope} ${message}`);
}
