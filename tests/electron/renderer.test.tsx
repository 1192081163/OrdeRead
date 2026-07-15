import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../electron/renderer/App";
import { StatusBar } from "../../electron/renderer/components/StatusBar";
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
  clearCache: vi.fn(),
  checkUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  onBackfillStatus: vi.fn(),
};
const rendererStyles = readFileSync(resolve(__dirname, "../../electron/renderer/styles.css"), "utf-8");
let backfillStatusHandler: Parameters<RendererApi["onBackfillStatus"]>[0] | null = null;

async function clickMoreMenuItem(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => {
  vi.resetAllMocks();
  backfillStatusHandler = null;
  vi.mocked(api.loadSettings).mockResolvedValue({ email: "", authCode: "" });
  vi.mocked(api.saveSettings).mockResolvedValue();
  vi.mocked(api.scanOrders).mockResolvedValue(emptyScanResult);
  vi.mocked(api.clearCache).mockResolvedValue();
  vi.mocked(api.checkUpdates).mockResolvedValue(null);
  vi.mocked(api.downloadUpdate).mockResolvedValue("");
  vi.mocked(api.installUpdate).mockResolvedValue();
  vi.mocked(api.onBackfillStatus).mockImplementation((handler) => {
    backfillStatusHandler = handler;
    return () => {
      backfillStatusHandler = null;
    };
  });
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

  it("does not show the enterprise mailbox subtitle in settings", async () => {
    render(<App />);

    expect(await screen.findByRole("region", { name: "邮件读取设置" })).toBeInTheDocument();
    expect(screen.queryByText("企业微信邮箱")).not.toBeInTheDocument();
  });

  it("renders the order workspace with named Fluent layout regions", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    const { container } = render(<App />);

    expect(await screen.findByRole("main", { name: "订单快读" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "订单读取工具栏" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "订单筛选" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "订单列表" })).toBeInTheDocument();
    expect(container.querySelector(".date-filter-group")).toBeInTheDocument();
  });

  it("keeps date filter controls from being squeezed by the search field", () => {
    expect(rendererStyles).toMatch(/\.filter-search\s*{[^}]*max-width:\s*400px;/s);
    expect(rendererStyles).toMatch(/\.date-filter-field\s*{[^}]*flex:\s*0 0 220px;/s);
    expect(rendererStyles).toMatch(/\.date-filter-field\s*{[^}]*min-width:\s*220px;/s);
    expect(rendererStyles).toMatch(
      /\.filter-bar\s*{[^}]*grid-template-columns:\s*minmax\(280px,\s*360px\)\s+220px\s+220px\s+104px\s+minmax\(0,\s*1fr\);/s,
    );
    expect(rendererStyles).toMatch(/\.filter-row\s*{[^}]*display:\s*contents;/s);
    expect(rendererStyles).toMatch(
      /\.orders-table\s+tr,\s*\.orders-table\s*\[role="row"\]\s*{[^}]*grid-template-columns:\s*180px\s+120px\s+120px\s+minmax\(0,\s*1fr\);/s,
    );
    expect(rendererStyles).toMatch(/\.order-number-column\s*{[^}]*width:\s*180px;/s);
    expect(rendererStyles).toMatch(/\.sent-date-column\s*{[^}]*width:\s*120px;/s);
    expect(rendererStyles).toMatch(/\.deadline-column\s*{[^}]*width:\s*120px;/s);
  });

  it("groups low frequency toolbar actions behind a menu", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");

    expect(screen.getByRole("button", { name: "刷新最新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取近一周" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清空缓存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "检查更新" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "修改读取设置" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    expect(await screen.findByRole("menuitem", { name: "清空缓存" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "修改读取设置" })).toBeInTheDocument();
  });

  it("keeps more actions inline with the toolbar when opened", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const toolbar = screen.getByRole("region", { name: "订单读取工具栏" });
    expect(toolbar).toContainElement(await screen.findByRole("menu"));
    expect(screen.getByRole("main", { name: "订单快读" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "订单筛选" })).toBeInTheDocument();
  });

  it("shows running status as a transient popup instead of a persistent bar", () => {
    vi.useFakeTimers();

    render(<StatusBar status="已加载邮件读取设置。" />);

    expect(screen.getByRole("status", { name: "运行状态" })).toHaveTextContent("已加载邮件读取设置。");

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(screen.queryByRole("status", { name: "运行状态" })).not.toBeInTheDocument();
  });

  it("runs scan all and refresh with the correct scan modes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-17T10:00:00+08:00"));
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    await screen.findByText("saved@example.com");

    fireEvent.click(screen.getByRole("button", { name: "读取近一周" }));
    await waitFor(() =>
      expect(api.scanOrders).toHaveBeenCalledWith({
        fullScan: true,
        includeMetrics: true,
        sentStartDate: "2026-06-11",
        sentEndDate: "2026-06-17",
        backgroundBackfill: true,
        backgroundSentStartDate: "2026-06-11",
        backgroundSentEndDate: "2026-06-17",
      }),
    );
    expect(await screen.findByText("按近一周读取，匹配 0 封邮件，找到 0 个 Excel 附件，读取 0 条订单。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新最新" }));
    await waitFor(() => expect(api.scanOrders).toHaveBeenLastCalledWith({ fullScan: false, includeMetrics: true }));
  });

  it("shows scan timing and cache hit details when metrics are returned", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.scanOrders).mockResolvedValue({
      rows: [],
      warnings: [],
      scannedMessages: 1,
      parsedAttachments: 1,
      scanMode: "full",
      metrics: {
        totalMs: 1234,
        connectMs: 100,
        searchMs: 200,
        fetchMs: 300,
        downloadMs: 400,
        parseMs: 50,
        cacheHits: 2,
        retryCount: 1,
      },
    });

    render(<App />);
    await screen.findByText("saved@example.com");
    fireEvent.click(screen.getByRole("button", { name: "读取近一周" }));

    expect(
      await screen.findByText(
        "按近一周读取，匹配 1 封邮件，找到 1 个 Excel 附件，读取 0 条订单。耗时 1.2 秒，缓存命中 2 个，重试 1 次。",
      ),
    ).toBeInTheDocument();
  });

  it("shows background history sync status events", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");

    act(() => {
      backfillStatusHandler?.({ state: "completed", message: "历史邮件同步完成，缓存已更新。" });
    });

    expect(await screen.findByText("历史邮件同步完成，缓存已更新。")).toBeInTheDocument();
  });

  it("filters rendered rows by order number, sent date, and deadline date", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "读取近一周" }));
    await screen.findByText("TODAY-SENT-TODAY-DUE");

    fireEvent.change(screen.getByLabelText("发送时间"), { target: { value: "2026-06-16" } });
    fireEvent.blur(screen.getByLabelText("发送时间"));
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-06-16" } });
    fireEvent.blur(screen.getByLabelText("截止时间"));
    fireEvent.change(screen.getByLabelText("订单号"), { target: { value: "today" } });

    await waitFor(() => expect(screen.queryByText("TODAY-SENT-FUTURE-DUE")).not.toBeInTheDocument());
    expect(screen.getByText("TODAY-SENT-TODAY-DUE")).toBeInTheDocument();
    expect(screen.queryByText("YESTERDAY-SENT-TODAY-DUE")).not.toBeInTheDocument();
  });

  it("passes the selected sent date range into full scans", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");
    fireEvent.change(screen.getByLabelText("发送时间"), { target: { value: "2026-06-18" } });
    fireEvent.blur(screen.getByLabelText("发送时间"));
    fireEvent.click(screen.getByRole("button", { name: "读取近一周" }));

    await waitFor(() =>
      expect(api.scanOrders).toHaveBeenCalledWith({
        fullScan: true,
        includeMetrics: true,
        sentStartDate: "2026-06-18",
        sentEndDate: "2026-06-18",
      }),
    );
  });

  it("clears sent and deadline date filters in one action", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");
    fireEvent.change(screen.getByLabelText("发送时间"), { target: { value: "2026-06-18" } });
    fireEvent.blur(screen.getByLabelText("发送时间"));
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-06-20" } });
    fireEvent.blur(screen.getByLabelText("截止时间"));

    fireEvent.click(screen.getByRole("button", { name: "清空时间" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新最新" }));

    await waitFor(() => expect(api.scanOrders).toHaveBeenCalledWith({ fullScan: false, includeMetrics: true }));
    expect(screen.getByLabelText("发送时间")).toHaveValue("");
    expect(screen.getByLabelText("截止时间")).toHaveValue("");
  });

  it("clears each date filter independently from its field", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");
    fireEvent.change(screen.getByLabelText("发送时间"), { target: { value: "2026-06-18" } });
    fireEvent.blur(screen.getByLabelText("发送时间"));
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-06-20" } });
    fireEvent.blur(screen.getByLabelText("截止时间"));

    fireEvent.click(screen.getByRole("button", { name: "清空发送时间" }));

    expect(screen.getByLabelText("发送时间")).toHaveValue("");
    expect(screen.getByLabelText("截止时间")).toHaveValue("2026-06-20");
    expect(screen.getByRole("button", { name: "清空截止时间" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清空发送时间" })).not.toBeInTheDocument();
  });

  it("shows sent dates in the order table", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.scanOrders).mockResolvedValue({
      rows: [
        {
          orderNumber: "PO-SENT",
          deadline: "2026-06-20",
          sourceFile: "",
          messageSubject: "",
          messageDate: "2026-06-18T09:00:00.000Z",
        },
      ],
      warnings: [],
      scannedMessages: 1,
      parsedAttachments: 1,
      scanMode: "full",
    });

    render(<App />);
    await screen.findByText("saved@example.com");
    fireEvent.click(screen.getByRole("button", { name: "读取近一周" }));

    expect(await screen.findByText("PO-SENT")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "发送时间" })).toBeInTheDocument();
    expect(screen.getByText("2026-06-18")).toBeInTheDocument();
  });

  it("clears the local order cache from the toolbar", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);
    await screen.findByText("saved@example.com");
    await clickMoreMenuItem("清空缓存");

    await waitFor(() => expect(api.clearCache).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已清空本地读取缓存。")).toBeInTheDocument();
  });

  it("opens calendar pickers directly from sent and deadline date filters", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    const { container } = render(<App />);
    await screen.findByText("saved@example.com");

    fireEvent.click(screen.getByLabelText("发送时间"));

    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("发送时间"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Calendar" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("截止时间"));

    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeInTheDocument();
  });

  it("opens settings for editing and collapses them after save", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });

    render(<App />);

    await clickMoreMenuItem("修改读取设置");
    fireEvent.change(screen.getByLabelText("邮箱账号"), { target: { value: "edited@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存读取设置" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({ email: "edited@example.com", authCode: "secret" }),
    );
    expect(await screen.findByText("edited@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱账号")).not.toBeInTheDocument();
  });

  it("shows API errors as status text without crashing", async () => {
    vi.mocked(api.loadSettings).mockResolvedValue({ email: "saved@example.com", authCode: "secret" });
    vi.mocked(api.scanOrders).mockRejectedValue(new Error("IMAP 登录失败"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "刷新最新" }));

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

    expect(api.scanOrders).toHaveBeenCalledWith({ fullScan: false, includeMetrics: true });
    expect(screen.getByText("读取到 0 封邮件，找到 0 个 Excel 附件，读取 0 条订单。")).toBeInTheDocument();
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
    expect(screen.getByText("安装程序打开后会关闭当前版本，安装完成后请重新打开订单快读。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载并安装" })).toBeInTheDocument();
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

    await clickMoreMenuItem("检查更新");
    expect(await screen.findByRole("dialog", { name: "发现新版本" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载并安装" }));
    await waitFor(() => expect(api.downloadUpdate).toHaveBeenCalledWith());
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledWith("C:\\Users\\admin\\Downloads\\OrderQuickReadSetup.exe"));
    expect(await screen.findByText("已打开新版安装包，当前版本将关闭。安装完成后请重新打开订单快读。")).toBeInTheDocument();
  });
});
