import { ImapFlow, type ImapFlowOptions, type MessageStructureObject } from "imapflow";

import { sentDateFromMessageDate } from "../../shared/date.js";
import type { ScanMetrics } from "../../shared/types.js";

const SUPPORTED_EXCEL_EXTENSION = /\.(xlsx|xlsm|xls)$/i;
const MAX_ATTACHMENT_DOWNLOADS = 3;
const IMAP_CONNECTION_TIMEOUT_MS = 10_000;
const IMAP_GREETING_TIMEOUT_MS = 10_000;
const IMAP_SOCKET_TIMEOUT_MS = 120_000;

export const ENTERPRISE_WECHAT_IMAP_HOST = "imap.exmail.qq.com";

export type ImapConfig = {
  email: string;
  authCode: string;
  host?: string;
  port?: number;
  secure?: boolean;
};

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  messageSubject: string;
  messageDate: string;
  messageUid: number;
  messagePart: string;
};

export type AttachmentBatch = {
  attachments: EmailAttachment[];
  cachedAttachmentKeys?: string[];
  scannedMessages: number;
  latestUid: number;
  uidvalidity: string;
  metrics?: AttachmentFetchMetrics;
};

export type AttachmentFetchOptions = {
  sinceUid?: number;
  sentStartDate?: string;
  sentEndDate?: string;
  cachedAttachmentKeys?: string[];
  includeMetrics?: boolean;
};

export type AttachmentClient = {
  fetchExcelAttachmentBatch(options: AttachmentFetchOptions): Promise<AttachmentBatch>;
  close?(): Promise<void>;
};

type SelectedMailbox = {
  uidValidity?: bigint | number | string;
  uidNext?: number;
};

type ExcelBodyPart = {
  part: string;
  filename: string;
};

type AttachmentDownloadJob = {
  uid: number;
  excelParts: ExcelBodyPart[];
  messageSubject: string;
  messageDate: string;
};

type SentDateRange = {
  startDate?: string;
  endDate?: string;
};

type AttachmentFetchMetrics = Pick<
  ScanMetrics,
  "connectMs" | "searchMs" | "fetchMs" | "downloadMs" | "cacheHits" | "retryCount"
>;

export class ImapAttachmentClient implements AttachmentClient {
  private client: ImapFlow | null = null;
  private connecting: Promise<ImapFlow> | null = null;

  constructor(private readonly config: ImapConfig) {}

  async fetchExcelAttachmentBatch(options: AttachmentFetchOptions): Promise<AttachmentBatch> {
    try {
      return await this.fetchExcelAttachmentBatchOnce(options, 0);
    } catch (error) {
      if (!isTransientMailError(error)) {
        throw error;
      }

      await this.close();
      return this.fetchExcelAttachmentBatchOnce(options, 1);
    }
  }

  private async fetchExcelAttachmentBatchOnce(
    options: AttachmentFetchOptions,
    retryCount: number,
  ): Promise<AttachmentBatch> {
    const metrics = options.includeMetrics ? createFetchMetrics(retryCount) : undefined;
    const connectStarted = nowMs();
    const client = await this.connectedClient();
    addElapsed(metrics, "connectMs", connectStarted);
    const attachments: EmailAttachment[] = [];
    const cachedAttachmentKeys: string[] = [];
    const requestedCachedAttachmentKeys = new Set(options.cachedAttachmentKeys ?? []);
    const downloadJobs: AttachmentDownloadJob[] = [];
    let scannedMessages = 0;
    let latestUid = options.sinceUid ?? 0;
    let uidvalidity = "";
    const sentDateRange = normalizedSentDateRange(options);

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
      const mailbox = client.mailbox as SelectedMailbox | false;
      uidvalidity = mailbox ? String(mailbox.uidValidity ?? "") : "";
      if (isNoNewUidRange(options.sinceUid, mailbox ? mailbox.uidNext : undefined)) {
        return attachmentBatch({ attachments, cachedAttachmentKeys, scannedMessages, latestUid, uidvalidity, metrics });
      }

      const searchStarted = nowMs();
      const fetchRange = await createFetchRange(client, options.sinceUid, sentDateRange);
      addElapsed(metrics, "searchMs", searchStarted);
      if (Array.isArray(fetchRange) && fetchRange.length === 0) {
        return attachmentBatch({ attachments, cachedAttachmentKeys, scannedMessages, latestUid, uidvalidity, metrics });
      }
      const fetchStarted = nowMs();
      for await (const message of client.fetch(
            fetchRange,
            { uid: true, envelope: true, internalDate: true, bodyStructure: true, headers: ["date"] },
          { uid: true },
        )) {
          if (options.sinceUid !== undefined && message.uid <= options.sinceUid) {
            continue;
          }

          latestUid = Math.max(latestUid, message.uid);
          const messageSubject = message.envelope?.subject ?? "";
          const messageDate = messageDateFromHeaders(message.headers, message.envelope?.date ?? message.internalDate);
          if (!messageMatchesSentDateRange(messageDate, sentDateRange)) {
            continue;
          }

          scannedMessages += 1;
        const excelParts = collectExcelBodyParts(message.bodyStructure);
        if (excelParts.length === 0) {
          continue;
        }

        const partsToDownload = excelParts.filter((part) => {
          const key = attachmentCacheKey(uidvalidity, message.uid, part.part, part.filename);
          if (requestedCachedAttachmentKeys.has(key)) {
          cachedAttachmentKeys.push(key);
          if (metrics) {
            metrics.cacheHits += 1;
          }
          return false;
          }
          return true;
        });
        if (partsToDownload.length === 0) {
          continue;
        }

        downloadJobs.push({
          uid: message.uid,
          excelParts: partsToDownload,
          messageSubject,
          messageDate,
        });
      }
      addElapsed(metrics, "fetchMs", fetchStarted);

      const downloadStarted = nowMs();
      const downloadedAttachments = await mapWithConcurrency(
        downloadJobs,
        MAX_ATTACHMENT_DOWNLOADS,
        async (job) => downloadExcelAttachments(client, job),
      );
      addElapsed(metrics, "downloadMs", downloadStarted);
        for (const attachmentGroup of downloadedAttachments) {
          attachments.push(...attachmentGroup);
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      await this.close();
      throw error;
    }

    return attachmentBatch({ attachments, cachedAttachmentKeys, scannedMessages, latestUid, uidvalidity, metrics });
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    await client?.logout().catch(() => undefined);
  }

  private async connectedClient(): Promise<ImapFlow> {
    if (this.client) {
      return this.client;
    }
    if (this.connecting) {
      return this.connecting;
    }

    const client = new ImapFlow(this.createClientOptions());
    this.attachClientErrorHandler(client);
    this.connecting = client
      .connect()
      .then(() => {
        this.client = client;
        return client;
      })
      .catch((error: unknown) => {
        this.client = null;
        throw loginError(error);
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  private createClientOptions(): ImapFlowOptions {
    return {
      host: this.config.host ?? ENTERPRISE_WECHAT_IMAP_HOST,
      port: this.config.port ?? 993,
      secure: this.config.secure ?? true,
      logger: false,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
      auth: {
        user: this.config.email,
        pass: this.config.authCode,
      },
    };
  }

  private attachClientErrorHandler(client: ImapFlow): void {
    client.on("error", (error: unknown) => {
      if (this.client === client) {
        this.client = null;
      }
      console.warn("邮箱连接异常：", exceptionText(error));
    });
  }
}

async function createFetchRange(
  client: ImapFlow,
  sinceUid: number | undefined,
  sentDateRange: SentDateRange | null,
): Promise<string | number[]> {
  if (sentDateRange) {
    const matchedUids = await client.search(sentDateSearchQuery(sentDateRange), { uid: true });
    if (!matchedUids) {
      return [];
    }
    return matchedUids.filter((uid) => sinceUid === undefined || uid > sinceUid);
  }

  if (sinceUid === undefined || sinceUid <= 0) {
    return "1:*";
  }
  return `${sinceUid + 1}:*`;
}

function sentDateSearchQuery(range: SentDateRange): { sentSince: string; sentBefore: string } {
  return {
    sentSince: range.startDate ?? range.endDate ?? "",
    sentBefore: addIsoDays(range.endDate ?? range.startDate ?? "", 1),
  };
}

function addIsoDays(value: string, days: number): string {
  const [yearText, monthText, dayText] = value.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function normalizedSentDateRange(options: AttachmentFetchOptions): SentDateRange | null {
  if (!options.sentStartDate && !options.sentEndDate) {
    return null;
  }

  return {
    startDate: options.sentStartDate || options.sentEndDate,
    endDate: options.sentEndDate || options.sentStartDate,
  };
}

function messageMatchesSentDateRange(messageDate: string, range: SentDateRange | null): boolean {
  if (!range) {
    return true;
  }

  const sentDate = sentDateFromMessageDate(messageDate);
  if (!sentDate) {
    return false;
  }
  if (range.startDate && sentDate < range.startDate) {
    return false;
  }
  if (range.endDate && sentDate > range.endDate) {
    return false;
  }
  return true;
}

function isNoNewUidRange(sinceUid: number | undefined, uidNext: number | undefined): boolean {
  return sinceUid !== undefined && sinceUid > 0 && uidNext !== undefined && sinceUid + 1 >= uidNext;
}

function isExcelFilename(filename: string): boolean {
  return SUPPORTED_EXCEL_EXTENSION.test(filename);
}

function collectExcelBodyParts(structure: MessageStructureObject | undefined): ExcelBodyPart[] {
  if (!structure) {
    return [];
  }

  const parts: ExcelBodyPart[] = [];
  collectExcelBodyPartsInto(structure, parts);
  return parts;
}

async function downloadExcelAttachments(client: ImapFlow, job: AttachmentDownloadJob): Promise<EmailAttachment[]> {
  const downloads = await client.downloadMany(
    String(job.uid),
    job.excelParts.map((part) => part.part),
    { uid: true },
  );
  const attachments: EmailAttachment[] = [];

  for (const excelPart of job.excelParts) {
    const content = downloads[excelPart.part]?.content;
    if (!content) {
      continue;
    }

    attachments.push({
      filename: excelPart.filename,
      content,
      messageSubject: job.messageSubject,
      messageDate: job.messageDate,
      messageUid: job.uid,
      messagePart: excelPart.part,
    });
  }

  return attachments;
}

export function attachmentCacheKey(
  uidvalidity: string,
  messageUid: number,
  messagePart: string,
  filename: string,
): string {
  return [uidvalidity, String(messageUid), messagePart, filename].map((part) => encodeURIComponent(part)).join("|");
}

function attachmentBatch(batch: AttachmentBatch & { cachedAttachmentKeys: string[] }): AttachmentBatch {
  if (batch.cachedAttachmentKeys.length === 0) {
    const { cachedAttachmentKeys: _cachedAttachmentKeys, ...rest } = batch;
    return rest;
  }
  return batch;
}

function createFetchMetrics(retryCount: number): AttachmentFetchMetrics {
  return {
    connectMs: 0,
    searchMs: 0,
    fetchMs: 0,
    downloadMs: 0,
    cacheHits: 0,
    retryCount,
  };
}

function addElapsed(metrics: AttachmentFetchMetrics | undefined, key: keyof AttachmentFetchMetrics, startedAt: number): void {
  if (!metrics || key === "cacheHits" || key === "retryCount") {
    return;
  }
  metrics[key] += nowMs() - startedAt;
}

function nowMs(): number {
  return performance.now();
}

function isTransientMailError(error: unknown): boolean {
  const code = errorCode(error);
  if (["ETIMEOUT", "ETIMEDOUT", "ECONNRESET", "EPIPE", "EHOSTUNREACH"].includes(code)) {
    return true;
  }

  return exceptionText(error).toLowerCase().includes("socket timeout");
}

async function mapWithConcurrency<TInput, TResult>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );

  return results;
}

function collectExcelBodyPartsInto(node: MessageStructureObject, parts: ExcelBodyPart[]): void {
  const filename = filenameFromStructure(node);
  if (node.part && isExcelFilename(filename)) {
    parts.push({ part: node.part, filename });
  }

  for (const child of node.childNodes ?? []) {
    collectExcelBodyPartsInto(child, parts);
  }
}

function filenameFromStructure(node: MessageStructureObject): string {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? "";
}

function messageDateFromHeaders(headers: Buffer | undefined, fallback: Date | string | undefined): string {
  const rawDateHeader = headers
    ?.toString("utf-8")
    .split(/\r?\n/)
    .find((line) => /^date:/i.test(line));
  const dateFromHeader = rawDateHeader ? rfcDateHeaderToIso(rawDateHeader) : "";
  if (dateFromHeader) {
    return dateFromHeader;
  }

  return toIsoDate(fallback);
}

function rfcDateHeaderToIso(rawHeader: string): string {
  const value = rawHeader.replace(/^date:\s*/i, "").trim();
  const match = value.match(
    /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{2}:?\d{2})\b/i,
  );
  if (!match) {
    return "";
  }

  const [, dayText, monthText, yearText, hourText, minuteText, secondText = "00", offsetText] = match;
  const month = monthNumber(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const normalizedOffset = normalizeOffset(offsetText);
  if (
    month === 0 ||
    !isValidDateTimeParts(year, month, day, hour, minute, second) ||
    normalizedOffset === ""
  ) {
    return "";
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${normalizedOffset}`;
}

function monthNumber(monthText: string): number {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
    monthText.toLowerCase(),
  ) + 1;
}

function normalizeOffset(offsetText: string): string {
  const match = offsetText.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return "";
  }

  const [, sign, hours, minutes] = match;
  return `${sign}${hours}:${minutes}`;
}

function isValidDateTimeParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function toIsoDate(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "string" || !value) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function formatLoginError(error: unknown): string {
  const rawMessage = exceptionText(error);
  if (rawMessage.toLowerCase().includes("login fail")) {
    return (
      "邮箱登录失败：企业微信拒绝登录。请检查企业微信邮箱是否已开启 IMAP/SMTP 服务、" +
      "授权码是否正确；如果刚连续刷新多次，可能触发登录频率限制，请等待几分钟后再试。"
    );
  }

  return `邮箱登录失败：${rawMessage}`;
}

function loginError(error: unknown): Error {
  const wrappedError = new Error(formatLoginError(error), { cause: error });
  const code = errorCode(error);
  return code ? Object.assign(wrappedError, { code }) : wrappedError;
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

function exceptionText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
