import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type AppSettings,
  type RendererApi,
  type ScanOrdersRequest,
  type UpdateInfo,
} from "../shared/types.js";

const api: RendererApi = {
  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadSettings),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC_CHANNELS.saveSettings, settings),
  scanOrders: (options: ScanOrdersRequest) => ipcRenderer.invoke(IPC_CHANNELS.scanOrders, options),
  checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkUpdates),
  downloadUpdate: (update: UpdateInfo) => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate, update),
  installUpdate: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.installUpdate, path),
};

contextBridge.exposeInMainWorld("orderQuickRead", Object.freeze(api));
