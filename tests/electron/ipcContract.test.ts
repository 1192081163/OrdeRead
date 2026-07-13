import { afterEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../../electron/shared/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("electron");
  vi.doUnmock("../../electron/main/services/settingsStore.js");
  vi.doUnmock("../../electron/main/services/orderCache.js");
  vi.doUnmock("../../electron/main/services/orderScanner.js");
  vi.doUnmock("../../electron/main/services/mailClient.js");
  vi.doUnmock("../../electron/main/services/mailClientCache.js");
  vi.doUnmock("../../electron/main/services/notifier.js");
  vi.doUnmock("../../electron/main/services/remoteEmailApi.js");
  vi.doUnmock("../../electron/main/services/updater.js");
});

type Handler = (...args: unknown[]) => unknown;

function mockElectron(handlers: Map<string, Handler>) {
  vi.doMock("electron", () => ({
    app: { getPath: vi.fn(() => "/tmp/order-quick-read-test"), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
    },
    shell: {
      showItemInFolder: vi.fn(),
      openPath: vi.fn(async () => ""),
    },
  }));
}

function mockCommonServices(settings = { email: "buyer@example.com", authCode: "secret" }) {
  vi.doMock("../../electron/main/services/settingsStore.js", () => ({
    loadSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async () => undefined),
  }));
  vi.doMock("../../electron/main/services/orderCache.js", () => ({
    loadOrderCache: vi.fn(async () => ({
      email: "",
      uidvalidity: "",
      lastUid: 0,
      rows: [],
      warnings: [],
      scannedMessages: 0,
      parsedAttachments: 0,
    })),
    clearOrderCache: vi.fn(async () => undefined),
  }));
  vi.doMock("../../electron/main/services/mailClient.js", () => ({
    ImapAttachmentClient: vi.fn(),
  }));
  vi.doMock("../../electron/main/services/notifier.js", () => ({
    countOrderChanges: vi.fn(() => ({ newCount: 0, updatedCount: 0 })),
    notifyOrderChanges: vi.fn(),
  }));
  vi.doMock("../../electron/main/services/updater.js", () => ({
    checkForElectronUpdate: vi.fn(async () => null),
    downloadUpdateAsset: vi.fn(),
  }));
}

describe("IPC contract", () => {
  it("defines stable channels renderer calls", () => {
    expect(IPC_CHANNELS).toEqual({
      loadSettings: "settings:load",
      saveSettings: "settings:save",
      scanOrders: "orders:scan",
      backfillStatus: "orders:backfill:status",
      clearCache: "orders:cache:clear",
      checkUpdates: "updates:check",
      downloadUpdate: "updates:download",
      installUpdate: "updates:install",
    });
  });

  it("forwards scan background backfill requests to the local scanner when remote API is not configured", async () => {
    const handlers = new Map<string, Handler>();
    const scanOrders = vi.fn(async () => ({
      rows: [],
      warnings: [],
      scannedMessages: 0,
      parsedAttachments: 0,
      scanMode: "full" as const,
    }));
    const send = vi.fn();

    mockElectron(handlers);
    mockCommonServices();
    vi.doMock("../../electron/main/services/orderScanner.js", () => ({ scanOrders }));
    vi.doMock("../../electron/main/services/remoteEmailApi.js", async () => {
      const actual = await vi.importActual<typeof import("../../electron/main/services/remoteEmailApi")>(
        "../../electron/main/services/remoteEmailApi",
      );
      return {
        ...actual,
        loadRemoteEmailApiConfig: vi.fn(async () => undefined),
        scanRemoteOrders: vi.fn(),
      };
    });

    const { registerIpcHandlers } = await import("../../electron/main/ipc");
    registerIpcHandlers();
    const handler = handlers.get(IPC_CHANNELS.scanOrders);

    await handler?.(
      { sender: { send } },
      {
        fullScan: true,
        includeMetrics: true,
        sentStartDate: "2026-06-11",
        sentEndDate: "2026-06-17",
        backgroundBackfill: true,
        backgroundSentStartDate: "2026-05-19",
        backgroundSentEndDate: "2026-06-17",
      },
    );

    expect(scanOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        fullScan: true,
        includeMetrics: true,
        sentStartDate: "2026-06-11",
        sentEndDate: "2026-06-17",
        backgroundBackfill: true,
        backgroundSentStartDate: "2026-05-19",
        backgroundSentEndDate: "2026-06-17",
        accountEmail: "buyer@example.com",
        onBackgroundBackfillStatus: expect.any(Function),
      }),
    );
    const scanOptions = (scanOrders.mock.calls as unknown as [
      [
        {
          onBackgroundBackfillStatus(status: { state: "completed"; message: string }): void;
        },
      ],
    ])[0][0];
    scanOptions.onBackgroundBackfillStatus({
      state: "completed",
      message: "历史邮件同步完成。",
    });
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.backfillStatus, {
      state: "completed",
      message: "历史邮件同步完成。",
    });
  });

  it("uses the remote email API instead of local IMAP when configured", async () => {
    const handlers = new Map<string, Handler>();
    const scanOrders = vi.fn();
    const scanRemoteOrders = vi.fn(async () => ({
      rows: [],
      warnings: [],
      scannedMessages: 1,
      parsedAttachments: 1,
      scanMode: "full" as const,
    }));

    mockElectron(handlers);
    mockCommonServices({ email: "", authCode: "" });
    vi.doMock("../../electron/main/services/orderScanner.js", () => ({ scanOrders }));
    vi.doMock("../../electron/main/services/remoteEmailApi.js", async () => {
      const actual = await vi.importActual<typeof import("../../electron/main/services/remoteEmailApi")>(
        "../../electron/main/services/remoteEmailApi",
      );
      return {
        ...actual,
        loadRemoteEmailApiConfig: vi.fn(async () => ({ baseUrl: "https://api.example", token: "secret" })),
        scanRemoteOrders,
      };
    });

    const { registerIpcHandlers } = await import("../../electron/main/ipc");
    registerIpcHandlers();
    const handler = handlers.get(IPC_CHANNELS.scanOrders);

    await handler?.(
      { sender: { send: vi.fn() } },
      {
        fullScan: true,
        includeMetrics: true,
        sentStartDate: "2026-06-11",
        sentEndDate: "2026-06-17",
      },
    );

    expect(scanOrders).not.toHaveBeenCalled();
    expect(scanRemoteOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          fullScan: true,
          includeMetrics: true,
          sentStartDate: "2026-06-11",
          sentEndDate: "2026-06-17",
        }),
        cachePath: "/tmp/order-quick-read-test/order_cache.json",
        accountEmail: "远端邮件服务",
      }),
    );
  });

  it("rechecks the update in the main process and quits after the downloaded installer opens", async () => {
    const handlers = new Map<string, Handler>();
    mockElectron(handlers);
    mockCommonServices();

    const { registerIpcHandlers } = await import("../../electron/main/ipc");
    const { app, shell } = await import("electron");
    const { checkForElectronUpdate, downloadUpdateAsset } = await import("../../electron/main/services/updater.js");
    const officialUpdate = {
      tagName: "build-101",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/build-101",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://github.com/1192081163/order-quick-read/releases/download/build-101/OrderQuickReadSetup.exe",
    };
    vi.mocked(checkForElectronUpdate).mockResolvedValue(officialUpdate);
    vi.mocked(downloadUpdateAsset).mockResolvedValue("/tmp/OrderQuickReadSetup.exe");
    registerIpcHandlers();
    const downloadHandler = handlers.get(IPC_CHANNELS.downloadUpdate);
    const installHandler = handlers.get(IPC_CHANNELS.installUpdate);

    await downloadHandler?.({}, { assetUrl: "https://evil.example/payload.exe" });
    await installHandler?.({}, "/tmp/OrderQuickReadSetup.exe");

    expect(downloadUpdateAsset).toHaveBeenCalledWith(officialUpdate, "/tmp/order-quick-read-test");
    expect(shell.openPath).toHaveBeenCalledWith("/tmp/OrderQuickReadSetup.exe");
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it("does not quit current app when update installer fails to open", async () => {
    const handlers = new Map<string, Handler>();
    mockElectron(handlers);
    mockCommonServices();

    const { registerIpcHandlers } = await import("../../electron/main/ipc");
    const { app, shell } = await import("electron");
    const { checkForElectronUpdate, downloadUpdateAsset } = await import("../../electron/main/services/updater.js");
    vi.mocked(checkForElectronUpdate).mockResolvedValue({
      tagName: "build-101",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/build-101",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://github.com/1192081163/order-quick-read/releases/download/build-101/OrderQuickReadSetup.exe",
    });
    vi.mocked(downloadUpdateAsset).mockResolvedValue("/tmp/OrderQuickReadSetup.exe");
    vi.mocked(shell.openPath).mockResolvedValue("permission denied");
    registerIpcHandlers();
    const downloadHandler = handlers.get(IPC_CHANNELS.downloadUpdate);
    const installHandler = handlers.get(IPC_CHANNELS.installUpdate);

    await downloadHandler?.({});
    await expect(installHandler?.({}, "/tmp/OrderQuickReadSetup.exe")).rejects.toThrow("permission denied");

    expect(app.quit).not.toHaveBeenCalled();
  });

  it("refuses to open an installer path that was not downloaded by the current app", async () => {
    const handlers = new Map<string, Handler>();
    mockElectron(handlers);
    mockCommonServices();

    const { registerIpcHandlers } = await import("../../electron/main/ipc");
    const { app, shell } = await import("electron");
    registerIpcHandlers();
    const handler = handlers.get(IPC_CHANNELS.installUpdate);

    await expect(handler?.({}, "/tmp/untrusted.exe")).rejects.toThrow("未经当前应用下载");

    expect(shell.openPath).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });
});
