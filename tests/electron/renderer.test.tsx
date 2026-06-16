import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../electron/renderer/App";
import type { RendererApi, ScanResult } from "../../electron/shared/types";

const emptyScanResult: ScanResult = {
  rows: [],
  warnings: [],
  scannedMessages: 0,
  parsedAttachments: 0,
  scanMode: "incremental",
};

const api: RendererApi = {
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  scanOrders: vi.fn(),
  checkUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.loadSettings).mockResolvedValue({ email: "", authCode: "" });
  vi.mocked(api.saveSettings).mockResolvedValue();
  vi.mocked(api.scanOrders).mockResolvedValue(emptyScanResult);
  vi.mocked(api.checkUpdates).mockResolvedValue(null);
  vi.mocked(api.downloadUpdate).mockResolvedValue("");
  vi.mocked(api.installUpdate).mockResolvedValue();
  window.orderQuickRead = api;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Electron renderer", () => {
  it("collapses settings after saved credentials load", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    expect(await screen.findByText("saved@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
  });

  it("runs scan all and refresh with the correct scan modes", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    await screen.findByText("saved@example.com");

    fireEvent.click(screen.getByRole("button", { name: "扫描全部邮件" }));
    await waitFor(() => expect(api.scanOrders).toHaveBeenCalledWith({ fullScan: true }));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(api.scanOrders).toHaveBeenLastCalledWith({ fullScan: false }));
  });

  it("filters rendered rows by order number, sent date preset, and deadline preset", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.scanOrders).mockResolvedValue({
      rows: [
        {
          orderNumber: "TODAY-SENT-TODAY-DUE",
          deadline: "2026-06-16",
          sourceFile: "",
          messageSubject: "",
          messageDate: "2026-06-16T09:00:00.000Z",
        },
        {
          orderNumber: "TODAY-SENT-FUTURE-DUE",
          deadline: "2026-06-18",
          sourceFile: "",
          messageSubject: "",
          messageDate: "2026-06-16T10:00:00.000Z",
        },
        {
          orderNumber: "YESTERDAY-SENT-TODAY-DUE",
          deadline: "2026-06-16",
          sourceFile: "",
          messageSubject: "",
          messageDate: "2026-06-15T09:00:00.000Z",
        },
      ],
      warnings: [],
      scannedMessages: 3,
      parsedAttachments: 3,
      scanMode: "full",
    });

    render(<App />);
    await screen.findByText("saved@example.com");

    fireEvent.click(screen.getByRole("button", { name: "扫描全部邮件" }));
    await screen.findByText("TODAY-SENT-TODAY-DUE");

    fireEvent.change(screen.getByLabelText("发送时间"), { target: { value: "today" } });
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "today" } });
    fireEvent.change(screen.getByLabelText("订单号"), { target: { value: "today" } });

    expect(screen.getByText("TODAY-SENT-TODAY-DUE")).toBeInTheDocument();
    expect(screen.queryByText("TODAY-SENT-FUTURE-DUE")).not.toBeInTheDocument();
    expect(screen.queryByText("YESTERDAY-SENT-TODAY-DUE")).not.toBeInTheDocument();
  });

  it("opens settings for editing and collapses them after save", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修改邮箱设置" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "edited@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({ email: "edited@example.com", authCode: "secret" }),
    );
    expect(await screen.findByText("edited@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
  });

  it("shows API errors as status text without crashing", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.scanOrders).mockRejectedValue(new Error("IMAP 登录失败"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "刷新" }));

    expect(await screen.findByText("IMAP 登录失败")).toBeInTheDocument();
    expect(screen.getByText("saved@example.com")).toBeInTheDocument();
  });

  it("auto refreshes saved mailbox every 30 seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("saved@example.com")).toBeInTheDocument();
    expect(api.scanOrders).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(api.scanOrders).toHaveBeenCalledWith({ fullScan: false });
    expect(screen.getByText("扫描到 0 封邮件，找到 0 个 Excel 附件，读取 0 条订单。")).toBeInTheDocument();
  });

  it("checks for updates on startup without blocking saved settings", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.checkUpdates).mockResolvedValue({
      tagName: "v1.2.0",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://example.com/OrderQuickReadSetup.exe",
    });

    render(<App />);

    expect(await screen.findByText("saved@example.com")).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "发现新版本" })).toBeInTheDocument();
    expect(screen.getByText("发现新版本 v1.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载新版" })).toBeInTheDocument();
  });

  it("downloads and opens an available update from the prompt action", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.checkUpdates).mockResolvedValue({
      tagName: "v1.2.0",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://example.com/OrderQuickReadSetup.exe",
    });
    vi.mocked(api.downloadUpdate).mockResolvedValue("C:\\Users\\admin\\Downloads\\OrderQuickReadSetup.exe");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
    expect(await screen.findByRole("dialog", { name: "发现新版本" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载新版" }));
    await waitFor(() =>
      expect(api.downloadUpdate).toHaveBeenCalledWith({
        tagName: "v1.2.0",
        releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
        assetName: "OrderQuickReadSetup.exe",
        assetUrl: "https://example.com/OrderQuickReadSetup.exe",
      }),
    );
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledWith("C:\\Users\\admin\\Downloads\\OrderQuickReadSetup.exe"));
    expect(await screen.findByText("已打开新版安装包。请按安装向导完成更新。")).toBeInTheDocument();
  });
});
