import type { AppSettings, BackgroundBackfillStatus, RendererApi, ScanOrdersRequest } from "../shared/types.js";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const IPC_CHANNELS = {
  loadSettings: "settings:load",
  saveSettings: "settings:save",
  scanOrders: "orders:scan",
  backfillStatus: "orders:backfill:status",
  clearCache: "orders:cache:clear",
  checkUpdates: "updates:check",
  downloadUpdate: "updates:download",
  installUpdate: "updates:install",
} as const;

const api: RendererApi = {
  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadSettings),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC_CHANNELS.saveSettings, settings),
  scanOrders: (options: ScanOrdersRequest) => ipcRenderer.invoke(IPC_CHANNELS.scanOrders, options),
  onBackfillStatus: (handler: (status: BackgroundBackfillStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: BackgroundBackfillStatus) => handler(status);
    ipcRenderer.on(IPC_CHANNELS.backfillStatus, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.backfillStatus, listener);
  },
  clearCache: () => ipcRenderer.invoke(IPC_CHANNELS.clearCache),
  checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.installUpdate, path),
};

contextBridge.exposeInMainWorld("orderQuickRead", Object.freeze(api));
