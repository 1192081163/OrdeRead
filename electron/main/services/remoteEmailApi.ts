import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { OrderRow, ScanOrdersRequest, ScanResult } from "../../shared/types.js";
import { loadOrderCache, mergeOrderRows, saveOrderCache } from "./orderCache.js";

export type RemoteEmailApiConfig = {
  baseUrl: string;
  token?: string;
};

export type RemoteEmailApiStatus = {
  configured: boolean;
  baseUrl?: string;
};

type EnvLike = Record<string, string | undefined>;

type EmailMessageSummary = {
  uid: string;
  subject: string;
  date?: string;
  attachmentCount: number;
  excelAttachmentNames: string[];
  hasExcelAttachments: boolean;
};

type EmailListResult = {
  messages: EmailMessageSummary[];
  scannedMessages: number;
  days: number;
};

type ExtractedOrderRow = {
  values: Array<string | number | null>;
  notes: string[];
  manualCheck: string[];
  sourceFile: string;
};

type EmailExtractionResult = {
  emailFetch: {
    files: string[];
    scannedMessages: number;
    attachmentCount: number;
    downloadDir: string;
  };
  extraction: {
    inputFiles: string[];
    rows: ExtractedOrderRow[];
    skippedFiles: string[];
    failures: Array<{ path: string; error: string }>;
  };
};

export type ScanRemoteOrdersOptions = {
  client: RemoteEmailApiClient;
  request: ScanOrdersRequest;
  cachePath: string;
  accountEmail: string;
  now?: () => Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PO_NUMBER_INDEX = 1;
const D_DATE_INDEX = 0;
const IDEAL_D_DATE_INDEX = 14;
const ESTIMATE_C_DATE_INDEX = 15;

export function defaultRemoteEmailApiConfigPaths(resourcesPath?: string): string[] {
  return [
    path.join(os.homedir(), ".order_organizer_assistant", "email_api_client.json"),
    ...(resourcesPath ? [path.join(resourcesPath, "config", "remote-email-api.json")] : []),
    path.join(process.cwd(), "resources", "remote-email-api.json"),
  ];
}

export async function loadRemoteEmailApiConfig(
  env: EnvLike = process.env,
  configPaths = defaultRemoteEmailApiConfigPaths((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath),
): Promise<RemoteEmailApiConfig | undefined> {
  const envBaseUrl = env.ORDERFLOW_EMAIL_API_URL?.trim();
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      token: optionalTrimmed(env.ORDERFLOW_EMAIL_API_TOKEN),
    };
  }

  for (const configPath of configPaths) {
    const config = await readRemoteEmailApiConfig(configPath);
    if (config) {
      return config;
    }
  }

  return undefined;
}

export function remoteEmailApiStatus(config: RemoteEmailApiConfig | undefined): RemoteEmailApiStatus | undefined {
  return config ? { configured: true, baseUrl: config.baseUrl } : undefined;
}

export class RemoteEmailApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config: RemoteEmailApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = optionalTrimmed(config.token);
  }

  async listMessages(days: number): Promise<EmailListResult> {
    return this.post<EmailListResult>("/api/email/messages", { days });
  }

  async extractMessages(messageUids: string[], hours: number): Promise<EmailExtractionResult> {
    return this.post<EmailExtractionResult>("/api/email/extract", {
      messageUids,
      hours,
      inferManual: true,
    });
  }

  private async post<T>(pathname: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : response.statusText;
      throw new Error(message || `远端邮件服务请求失败：${response.status}`);
    }

    return payload as T;
  }
}

export async function scanRemoteOrders(options: ScanRemoteOrdersOptions): Promise<ScanResult> {
  const cache = await loadOrderCache(options.cachePath);
  const days = scanDays(options.request, options.now?.() ?? new Date());
  const listResult = await options.client.listMessages(days);
  const candidateMessages = listResult.messages.filter((message) =>
    shouldExtractMessage(message, options.request, cache.lastUid),
  );

  if (candidateMessages.length === 0) {
    return {
      rows: cache.rows,
      warnings: cache.warnings,
      scannedMessages: listResult.scannedMessages,
      parsedAttachments: 0,
      scanMode: options.request.fullScan ? "full" : "incremental",
    };
  }

  const extraction = await options.client.extractMessages(
    candidateMessages.map((message) => message.uid),
    days * 24,
  );
  const rows = mapExtractedRows(extraction.extraction.rows, candidateMessages);
  const mergedRows = options.request.fullScan ? rows : mergeOrderRows(cache.rows, rows);
  const warnings = [
    ...extraction.extraction.failures.map((failure) => `${path.basename(failure.path)}：${failure.error}`),
    ...extraction.extraction.skippedFiles.map((filePath) => `${path.basename(filePath)}：未识别为订单文件`),
  ];
  const latestUid = Math.max(cache.lastUid, ...candidateMessages.map((message) => numericUid(message.uid)));

  await saveOrderCache(options.cachePath, {
    email: options.accountEmail,
    uidvalidity: "remote-email-api",
    lastUid: latestUid,
    rows: mergedRows,
    warnings,
    scannedMessages: listResult.scannedMessages,
    parsedAttachments: extraction.emailFetch.attachmentCount,
  });

  return {
    rows: mergedRows,
    warnings,
    scannedMessages: listResult.scannedMessages,
    parsedAttachments: extraction.emailFetch.attachmentCount,
    scanMode: options.request.fullScan ? "full" : "incremental",
  };
}

function shouldExtractMessage(message: EmailMessageSummary, request: ScanOrdersRequest, lastUid: number): boolean {
  if (!message.hasExcelAttachments) {
    return false;
  }
  if (!isMessageInDateRange(message, request)) {
    return false;
  }
  return request.fullScan || numericUid(message.uid) > lastUid;
}

function mapExtractedRows(rows: ExtractedOrderRow[], messages: EmailMessageSummary[]): OrderRow[] {
  const firstMessage = messages[0];
  return rows
    .map((row) => {
      const orderNumber = valueText(row.values[PO_NUMBER_INDEX]);
      const deadline =
        valueText(row.values[IDEAL_D_DATE_INDEX]) ||
        valueText(row.values[D_DATE_INDEX]) ||
        valueText(row.values[ESTIMATE_C_DATE_INDEX]);
      if (!orderNumber || !deadline) {
        return undefined;
      }

      return {
        orderNumber,
        deadline,
        sourceFile: path.basename(row.sourceFile),
        messageSubject: firstMessage?.subject ?? "",
        messageDate: firstMessage?.date ?? "",
      };
    })
    .filter((row): row is OrderRow => row !== undefined);
}

function scanDays(request: ScanOrdersRequest, now: Date): number {
  const startDate = earliestDate(request.sentStartDate, request.backgroundSentStartDate);
  if (!startDate) {
    return request.fullScan ? 30 : 7;
  }

  const start = localDateStart(startDate);
  if (!start) {
    return request.fullScan ? 30 : 7;
  }

  return Math.max(1, Math.ceil((localDateStart(localIsoDate(now))!.getTime() - start.getTime()) / MS_PER_DAY) + 1);
}

function isMessageInDateRange(message: EmailMessageSummary, request: ScanOrdersRequest): boolean {
  if (!request.sentStartDate && !request.sentEndDate) {
    return true;
  }
  const messageDate = message.date ? localDateStart(message.date.slice(0, 10)) : undefined;
  if (!messageDate) {
    return true;
  }
  const start = request.sentStartDate ? localDateStart(request.sentStartDate) : undefined;
  const end = request.sentEndDate ? localDateStart(request.sentEndDate) : undefined;
  return (!start || messageDate >= start) && (!end || messageDate <= end);
}

function earliestDate(...dates: Array<string | undefined>): string | undefined {
  return dates.filter(Boolean).sort()[0];
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateStart(value: string): Date | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return undefined;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function numericUid(uid: string): number {
  const value = Number(uid);
  return Number.isFinite(value) ? value : 0;
}

function valueText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

async function readRemoteEmailApiConfig(configPath: string): Promise<RemoteEmailApiConfig | undefined> {
  try {
    const raw = JSON.parse(await readFile(configPath, "utf-8")) as Partial<Record<keyof RemoteEmailApiConfig, unknown>>;
    const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
    if (!baseUrl) {
      return undefined;
    }
    return {
      baseUrl,
      token: typeof raw.token === "string" ? optionalTrimmed(raw.token) : undefined,
    };
  } catch {
    return undefined;
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
