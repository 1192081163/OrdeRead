import { app, ipcMain } from "electron";
import { join } from "node:path";

import {
  IPC_CHANNELS,
  type AppSettings,
  type ScanOrdersRequest,
  type ScanResult,
  type UpdateInfo,
} from "../shared/types.js";
import { ImapAttachmentClient } from "./services/mailClient.js";
import { scanOrders } from "./services/orderScanner.js";
import { loadSettings, saveSettings } from "./services/settingsStore.js";

function appDataPath(filename: string): string {
  return join(app.getPath("userData"), filename);
}

function legacySettingsPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(app.getPath("home"), "AppData", "Roaming");
    return join(appData, "EmailOrderReader", "settings.json");
  }

  return join(app.getPath("home"), ".email-order-reader", "settings.json");
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.loadSettings, async () => loadStoredSettings());

  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, settings: AppSettings) => {
    await saveSettings({ settingsPath: appDataPath("settings.json") }, settings);
  });

  ipcMain.handle(IPC_CHANNELS.scanOrders, async (_event, options: ScanOrdersRequest) => scanStoredMailbox(options));

  ipcMain.handle(IPC_CHANNELS.checkUpdates, async (): Promise<UpdateInfo | null> => null);

  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async (): Promise<string> => {
    throw new Error("更新下载功能将在后续步骤接入。");
  });

  ipcMain.handle(IPC_CHANNELS.installUpdate, async (): Promise<void> => {
    throw new Error("更新安装功能将在后续步骤接入。");
  });
}

async function loadStoredSettings(): Promise<AppSettings> {
  return loadSettings({
    settingsPath: appDataPath("settings.json"),
    legacySettingsPath: legacySettingsPath(),
  });
}

async function scanStoredMailbox(options: ScanOrdersRequest): Promise<ScanResult> {
  const settings = await loadStoredSettings();
  if (!settings.email || !settings.authCode) {
    throw new Error("请先填写并保存企业微信邮箱和授权码。");
  }

  return scanOrders({
    client: new ImapAttachmentClient({
      email: settings.email,
      authCode: settings.authCode,
    }),
    fullScan: options.fullScan,
    cachePath: appDataPath("order_cache.json"),
    accountEmail: settings.email,
  });
}
