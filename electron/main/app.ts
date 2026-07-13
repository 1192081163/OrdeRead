import { fileURLToPath } from "node:url";
import path from "node:path";

import { app, BrowserWindow } from "electron";

import { closeMailboxClients, registerIpcHandlers } from "./ipc.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl).catch((error) => console.error("加载开发页面失败：", error));
    return;
  }

  void window
    .loadFile(path.join(currentDir, "../../dist-renderer/index.html"))
    .catch((error) => console.error("加载应用页面失败：", error));
}

app.whenReady()
  .then(() => {
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    console.error("应用启动失败：", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void closeMailboxClients().catch((error) => console.warn("关闭邮箱连接失败：", error));
});
