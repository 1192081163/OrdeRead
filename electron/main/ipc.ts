import { app, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";

import {
  IPC_CHANNELS,
  type AppSettings,
  type BackgroundBackfillStatus,
  type ScanOrdersRequest,
  type ScanResult,
  type UpdateInfo,
} from "../shared/types.js";
import { ImapAttachmentClient } from "./services/mailClient.js";
import { MailboxClientCache } from "./services/mailClientCache.js";
import { countOrderChanges, notifyOrderChanges } from "./services/notifier.js";
import { clearOrderCache, loadOrderCache } from "./services/orderCache.js";
import {
  defaultRemoteEmailApiConfigPaths,
  loadRemoteEmailApiConfig,
  RemoteEmailApiClient,
  remoteEmailApiStatus,
  scanRemoteOrders,
} from "./services/remoteEmailApi.js";
import { scanOrders } from "./services/orderScanner.js";
import { loadSettings, saveSettings } from "./services/settingsStore.js";
import { checkForElectronUpdate, downloadUpdateAsset } from "./services/updater.js";

const mailboxClients = new MailboxClientCache(
  (email, authCode) =>
    new ImapAttachmentClient({
      email,
      authCode,
    }),
);

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

function remoteEmailApiConfigPaths(): string[] {
  return [
    appDataPath("email_api_client.json"),
    ...defaultRemoteEmailApiConfigPaths((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath),
  ];
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.loadSettings, async () => loadStoredSettings());

  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, settings: AppSettings) => {
    await saveSettings({ settingsPath: appDataPath("settings.json") }, settings);
  });

  ipcMain.handle(IPC_CHANNELS.scanOrders, async (event, options: ScanOrdersRequest) =>
    scanStoredMailbox(options, (status) => sendBackfillStatus(event, status)),
  );

  ipcMain.handle(IPC_CHANNELS.clearCache, async () => {
    await clearOrderCache(appDataPath("order_cache.json"));
  });

  ipcMain.handle(IPC_CHANNELS.checkUpdates, async (): Promise<UpdateInfo | null> => checkForElectronUpdate());

  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async (_event, update: UpdateInfo): Promise<string> => {
    const downloadPath = await downloadUpdateAsset(update, app.getPath("downloads"));
    await shell.showItemInFolder(downloadPath);
    return downloadPath;
  });

  ipcMain.handle(IPC_CHANNELS.installUpdate, async (_event, installerPath: string): Promise<void> => {
    const errorMessage = await shell.openPath(installerPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
}

export async function closeMailboxClients(): Promise<void> {
  await mailboxClients.close();
}

async function loadStoredSettings(): Promise<AppSettings> {
  const settings = await loadSettings({
    settingsPath: appDataPath("settings.json"),
    legacySettingsPath: legacySettingsPath(),
  });
  const remoteConfig = await loadRemoteEmailApiConfig(process.env, remoteEmailApiConfigPaths());
  const remoteEmailApi = remoteEmailApiStatus(remoteConfig);
  return {
    ...settings,
    ...(remoteEmailApi ? { remoteEmailApi } : {}),
    ...(!settings.email && remoteEmailApi ? { email: "远端邮件服务" } : {}),
  };
}

function sendBackfillStatus(event: IpcMainInvokeEvent, status: BackgroundBackfillStatus): void {
  event.sender.send(IPC_CHANNELS.backfillStatus, status);
}

async function scanStoredMailbox(
  options: ScanOrdersRequest,
  onBackgroundBackfillStatus?: (status: BackgroundBackfillStatus) => void,
): Promise<ScanResult> {
  const settings = await loadStoredSettings();
  const remoteConfig = await loadRemoteEmailApiConfig(process.env, remoteEmailApiConfigPaths());
  const cachePath = appDataPath("order_cache.json");
  if (remoteConfig) {
    return scanRemoteOrders({
      client: new RemoteEmailApiClient(remoteConfig),
      request: options,
      cachePath,
      accountEmail: settings.email || "远端邮件服务",
    });
  }

  if (!settings.email || !settings.authCode) {
    throw new Error("请先填写并保存企业微信邮箱和授权码。");
  }

  const previousCache = await loadOrderCache(cachePath);
  const client = mailboxClients.get(settings);
  const result = await scanOrders({
    client,
    fullScan: options.fullScan,
    includeMetrics: options.includeMetrics,
    sentStartDate: options.sentStartDate,
    sentEndDate: options.sentEndDate,
    backgroundBackfill: options.backgroundBackfill,
    backgroundSentStartDate: options.backgroundSentStartDate,
    backgroundSentEndDate: options.backgroundSentEndDate,
    onBackgroundBackfillStatus,
    cachePath,
    accountEmail: settings.email,
  });
  if (previousCache.rows.length > 0) {
    notifyOrderChanges(countOrderChanges(previousCache.rows, result.rows));
  }

  return result;
}
