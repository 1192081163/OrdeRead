import { useEffect, useMemo, useState } from "react";

import { filterOrderRows } from "../shared/filtering";
import { sortOrderRows } from "../shared/sorting";
import type { AppSettings, DateFilter, OrderRow, RendererApi, ScanResult, UpdateInfo } from "../shared/types";
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

function scanStatus(result: ScanResult): string {
  return `扫描到 ${result.scannedMessages} 封邮件，找到 ${result.parsedAttachments} 个 Excel 附件，读取 ${result.rows.length} 条订单。`;
}

function rendererApi(): RendererApi | null {
  return window.orderQuickRead ?? null;
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [editingSettings, setEditingSettings] = useState(true);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState<DateFilter>(EMPTY_FILTER);
  const [status, setStatus] = useState("请填写邮箱和授权码。");
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
          setStatus("已加载保存的邮箱。");
          return;
        }

        setEditingSettings(true);
        setStatus("请填写邮箱和授权码。");
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
    if (editingSettings || !hasCompleteSettings(settings)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (!isBusy) {
        void scan(false, { auto: true });
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [editingSettings, isBusy, settings]);

  const displayRows = useMemo(() => filterOrderRows(sortOrderRows(rows), filter), [rows, filter]);

  async function saveSettings(): Promise<boolean> {
    const nextSettings = {
      email: settings.email.trim(),
      authCode: settings.authCode,
    };

    if (!hasCompleteSettings(nextSettings)) {
      setEditingSettings(true);
      setStatus("请填写邮箱和授权码。");
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
      setStatus("已保存邮箱设置。");
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
      setStatus("请填写邮箱和授权码。");
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
      setStatus(fullScan ? "正在扫描全部邮件..." : options.auto ? "自动刷新新邮件..." : "正在刷新新邮件...");
      const api = rendererApi();
      if (!api) {
        setStatus("桌面接口尚未连接。请在 Electron 应用中打开。");
        return;
      }

      const result = await api.scanOrders({ fullScan });
      setRows(result.rows);
      setStatus(scanStatus(result));
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

      const installerPath = await api.downloadUpdate(pendingUpdate);
      await api.installUpdate(installerPath);
      setIsUpdatePromptOpen(false);
      setStatus("已打开新版安装包。请按安装向导完成更新。");
    } catch (error) {
      setStatus(statusFromError(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="app-shell">
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
          onCheckUpdate={() => void checkUpdate()}
          onEditSettings={() => setEditingSettings(true)}
        />
      )}
      <FilterBar filter={filter} onChange={setFilter} />
      <OrderTable rows={displayRows} />
      <StatusBar status={status} />
      {isUpdatePromptOpen && pendingUpdate ? (
        <div className="modal-backdrop">
          <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
            <h2 id="update-dialog-title">发现新版本</h2>
            <p>发现新版本 {pendingUpdate.tagName}</p>
            <p className="update-asset-name">{pendingUpdate.assetName || "请打开 Release 页面下载适合当前系统的安装包。"}</p>
            <div className="dialog-actions">
              <button type="button" disabled={isBusy} onClick={() => setIsUpdatePromptOpen(false)}>
                稍后
              </button>
              <button type="button" className="primary" disabled={isBusy} onClick={() => void downloadUpdate()}>
                下载新版
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
