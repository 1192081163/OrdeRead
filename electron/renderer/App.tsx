import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Text,
  webLightTheme,
} from "@fluentui/react-components";

import { filterOrderRows } from "../shared/filtering";
import { sortOrderRows } from "../shared/sorting";
import type {
  AppSettings,
  DateFilter,
  OrderRow,
  RendererApi,
  ScanOrdersRequest,
  ScanResult,
  UpdateInfo,
} from "../shared/types";
import { FilterBar } from "./components/FilterBar";
import { OrderTable } from "./components/OrderTable";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";

const EMPTY_SETTINGS: AppSettings = { email: "", authCode: "" };
const EMPTY_FILTER: DateFilter = {
  searchText: "",
  sentPreset: "all",
  sentStartDate: "",
  sentEndDate: "",
  deadlinePreset: "all",
  deadlineStartDate: "",
  deadlineEndDate: "",
};
const AUTO_REFRESH_INTERVAL_MS = 30_000;
const RECENT_SCAN_DAYS = 7;
const MAX_SCAN_DAYS = 7;

function hasCompleteSettings(settings: AppSettings): boolean {
  return Boolean(settings.email.trim() && settings.authCode);
}

function statusFromError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "操作失败。";
}

function scanStatus(result: ScanResult, scopeLabel = ""): string {
  const prefix = scopeLabel ? `按${scopeLabel}读取，匹配` : "读取到";
  return `${prefix} ${result.scannedMessages} 封邮件，找到 ${result.parsedAttachments} 个 Excel 附件，读取 ${result.rows.length} 条订单。${metricsStatus(result)}`;
}

function metricsStatus(result: ScanResult): string {
  if (!result.metrics) {
    return "";
  }

  const parts = [`耗时 ${(result.metrics.totalMs / 1000).toFixed(1)} 秒`];
  if (result.metrics.cacheHits > 0) {
    parts.push(`缓存命中 ${result.metrics.cacheHits} 个`);
  }
  if (result.metrics.retryCount > 0) {
    parts.push(`重试 ${result.metrics.retryCount} 次`);
  }
  return `${parts.join("，")}。`;
}

function sentDateScanOptions(filter: DateFilter, fullScan: boolean): Pick<ScanOrdersRequest, "sentStartDate" | "sentEndDate"> {
  if (filter.sentPreset === "custom") {
    const sentStartDate = filter.sentStartDate.trim();
    const sentEndDate = filter.sentEndDate.trim();
    if (!sentStartDate && !sentEndDate) {
      return {};
    }

    return {
      sentStartDate: sentStartDate || sentEndDate,
      sentEndDate: sentEndDate || sentStartDate,
    };
  }

  return fullScan ? recentSentDateRange() : {};
}

function shouldBackgroundBackfill(filter: DateFilter, fullScan: boolean): boolean {
  return fullScan && filter.sentPreset !== "custom";
}

function backgroundBackfillScanOptions(
  filter: DateFilter,
  fullScan: boolean,
): Pick<ScanOrdersRequest, "backgroundBackfill" | "backgroundSentStartDate" | "backgroundSentEndDate"> {
  if (!shouldBackgroundBackfill(filter, fullScan)) {
    return {};
  }

  const range = maxSentDateRange();
  return {
    backgroundBackfill: true,
    backgroundSentStartDate: range.sentStartDate,
    backgroundSentEndDate: range.sentEndDate,
  };
}

function recentSentDateRange(referenceDate = new Date()): Pick<ScanOrdersRequest, "sentStartDate" | "sentEndDate"> {
  const endDate = localIsoDate(referenceDate);
  const startDate = localIsoDate(addLocalDays(referenceDate, -(RECENT_SCAN_DAYS - 1)));
  return { sentStartDate: startDate, sentEndDate: endDate };
}

function maxSentDateRange(referenceDate = new Date()): Pick<ScanOrdersRequest, "sentStartDate" | "sentEndDate"> {
  const endDate = localIsoDate(referenceDate);
  const startDate = localIsoDate(addLocalDays(referenceDate, -(MAX_SCAN_DAYS - 1)));
  return { sentStartDate: startDate, sentEndDate: endDate };
}

function scanScopeLabel(options: Pick<ScanOrdersRequest, "sentStartDate" | "sentEndDate">): string {
  if (!options.sentStartDate && !options.sentEndDate) {
    return "";
  }
  const recentRange = recentSentDateRange();
  if (options.sentStartDate === recentRange.sentStartDate && options.sentEndDate === recentRange.sentEndDate) {
    return "近一周";
  }
  if (options.sentStartDate === options.sentEndDate) {
    return `发送时间 ${options.sentStartDate}`;
  }
  return `发送时间 ${options.sentStartDate} 至 ${options.sentEndDate}`;
}

function addLocalDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function localIsoDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function rendererApi(): RendererApi | null {
  return window.orderQuickRead ?? null;
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [editingSettings, setEditingSettings] = useState(true);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
  const [isUpdatePromptOpen, setIsUpdatePromptOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const api = rendererApi();
        if (!api) {
          setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
          return;
        }

        const loadedSettings = await api.loadSettings();
        if (!isMounted) {
          return;
        }

      setSettings(loadedSettings);
      if (hasCompleteSettings(loadedSettings)) {
        setEditingSettings(false);
        setStatus("已加载邮件读取设置。");
        return;
      }

      setEditingSettings(true);
      setStatus("请填写企业微信邮箱和授权码。");
      } catch (error) {
        if (isMounted) {
          setStatus(statusFromError(error));
        }
      }
    }

    async function checkStartupUpdate() {
      try {
        const api = rendererApi();
        if (!api) {
          return;
        }

        const update = await api.checkUpdates();
        if (!isMounted || !update) {
          return;
        }

        setPendingUpdate(update);
        setIsUpdatePromptOpen(true);
        setStatus(`发现新版本 ${update.tagName}。`);
      } catch {
        // 启动更新检查失败时不影响正常读取订单。
      }
    }

    void loadSettings();
    void checkStartupUpdate();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const api = rendererApi();
    if (!api) {
      return undefined;
    }

    return api.onBackfillStatus((event) => {
      if (event.message) {
        setStatus(event.message);
      }
    });
  }, []);

  useEffect(() => {
    if (editingSettings || !hasCompleteSettings(settings)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (!isBusy) {
        void scan(false, { auto: true });
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [editingSettings, filter, isBusy, settings]);

  const displayRows = useMemo(() => filterOrderRows(sortOrderRows(rows), filter), [rows, filter]);

  async function saveSettings(): Promise<boolean> {
    const nextSettings: AppSettings = {
      email: settings.email.trim(),
      authCode: settings.authCode,
    };

    if (!hasCompleteSettings(nextSettings)) {
      setEditingSettings(true);
      setStatus("请填写企业微信邮箱和授权码。");
      return false;
    }

    try {
      setIsBusy(true);
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return false;
      }

      await api.saveSettings(nextSettings);
      setSettings(nextSettings);
      setEditingSettings(false);
      setStatus("已保存邮件读取设置。");
      return true;
    } catch (error) {
      setStatus(statusFromError(error));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function ensureReadyForScan(): Promise<boolean> {
    if (editingSettings) {
      return saveSettings();
    }

    if (!hasCompleteSettings(settings)) {
      setEditingSettings(true);
      setStatus("请填写企业微信邮箱和授权码。");
      return false;
    }

    return true;
  }

  async function scan(fullScan: boolean, options: { auto?: boolean } = {}) {
    if (!(await ensureReadyForScan())) {
      return;
    }

    try {
      setIsBusy(true);
      const scanRequest = {
        fullScan,
        includeMetrics: true,
        ...sentDateScanOptions(filter, fullScan),
        ...backgroundBackfillScanOptions(filter, fullScan),
      };
      const scopeLabel = fullScan ? scanScopeLabel(scanRequest) : "";
      setStatus(
        fullScan
          ? `正在读取${scopeLabel || "全部"}邮件...`
          : options.auto
            ? "自动读取最新邮件..."
            : "正在读取最新邮件...",
      );
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return;
      }

      const result = await api.scanOrders(scanRequest);
      setRows(result.rows);
      setStatus(scanStatus(result, scopeLabel));
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function clearCache() {
    try {
      setIsBusy(true);
      setStatus("正在清空本地读取缓存...");
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return;
      }

      await api.clearCache();
      setRows([]);
      setStatus("已清空本地读取缓存。");
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function checkUpdate() {
    try {
      setIsBusy(true);
      setStatus("正在检查更新...");
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return;
      }

      const update = await api.checkUpdates();
      setPendingUpdate(update);
      setIsUpdatePromptOpen(Boolean(update));
      setStatus(update ? `发现新版本 ${update.tagName}。` : "当前已是最新版本。");
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function downloadUpdate() {
    if (!pendingUpdate) {
      return;
    }

    try {
      setIsBusy(true);
      setStatus("正在下载新版安装包...");
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return;
      }

      const installerPath = await api.downloadUpdate();
      await api.installUpdate(installerPath);
      setIsUpdatePromptOpen(false);
      setStatus("已打开新版安装包，当前版本将关闭。安装完成后请重新打开订单快读。");
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <FluentProvider theme={webLightTheme} className="fluent-root">
      <main className="app-shell" aria-label="订单快读">
        <div className="workspace">
          {editingSettings ? (
            <SettingsPanel
              disabled={isBusy}
              settings={settings}
              onChange={setSettings}
              onSave={() => void saveSettings()}
              onScanAll={() => void scan(true)}
            />
          ) : (
            <Toolbar
              disabled={isBusy}
              email={settings.email}
              onRefresh={() => void scan(false)}
              onScanAll={() => void scan(true)}
              onClearCache={() => void clearCache()}
              onCheckUpdate={() => void checkUpdate()}
              onEditSettings={() => setEditingSettings(true)}
            />
          )}
          <FilterBar filter={filter} onChange={setFilter} />
          <OrderTable rows={displayRows} />
        </div>
        <StatusBar status={status} />
        {pendingUpdate ? (
          <Dialog open={isUpdatePromptOpen}>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>发现新版本</DialogTitle>
                <DialogContent>
                  <Text block>发现新版本 {pendingUpdate.tagName}</Text>
                  <Text block className="update-asset-name">
                    {pendingUpdate.assetName || "请打开 Release 页面下载适合当前系统的安装包。"}
                  </Text>
                  <Text block>安装程序打开后会关闭当前版本，安装完成后请重新打开订单快读。</Text>
                </DialogContent>
                <DialogActions>
                  <Button disabled={isBusy} onClick={() => setIsUpdatePromptOpen(false)}>
                    稍后
                  </Button>
                  <Button appearance="primary" disabled={isBusy} onClick={() => void downloadUpdate()}>
                    下载并安装
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        ) : null}
      </main>
    </FluentProvider>
  );
}
