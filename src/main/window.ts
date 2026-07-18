import path from "node:path";
import { BrowserWindow } from "electron";

export function createMainWindow(): BrowserWindow {
  const browserWindow = new BrowserWindow({
    frame: false,
    transparent: false,
    backgroundColor: "#000000",
    resizable: true,
    fullscreenable: true,
    minWidth: 640,
    minHeight: 360,
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void browserWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void browserWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });

  return browserWindow;
}
