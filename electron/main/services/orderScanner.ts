import { parseExcelAttachment, type AttachmentParseResult } from "./excelParser.js";
import { attachmentCacheKey, type AttachmentBatch, type AttachmentClient, type EmailAttachment } from "./mailClient.js";
import {
  loadOrderCache,
  mergeOrderRows,
  mergeParsedAttachmentCache,
  saveOrderCache,
  type OrderCache,
  type ParsedAttachmentCacheEntry,
} from "./orderCache.js";
import { sentDateFromMessageDate } from "../../shared/date.js";
import type { BackgroundBackfillStatus, OrderRow, ScanMetrics, ScanResult } from "../../shared/types.js";

export type ParseAttachment = (
  filename: string,
  content: Buffer,
  messageSubject: string,
  messageDate: string,
) => AttachmentParseResult;

export type ScanOrdersOptions = {
  client: AttachmentClient;
  fullScan?: boolean;
  sinceUid?: number;
  sentStartDate?: string;
  sentEndDate?: string;
  backgroundBackfill?: boolean;
  backgroundSentStartDate?: string;
  backgroundSentEndDate?: string;
  cachePath?: string;
  accountEmail?: string;
  parseAttachment?: ParseAttachment;
  onBackgroundBackfillStatus?: (status: BackgroundBackfillStatus) => void;
  cacheDateRangedScan?: boolean;
  includeMetrics?: boolean;
};

let backgroundBackfill: Promise<void> | null = null;

type ParsedAttachmentBatch = {
  result: ScanResult;
  parsedAttachmentCache: ParsedAttachmentCacheEntry[];
};

export async function scanOrders(options: ScanOrdersOptions): Promise<ScanResult> {
  if (hasSentDateRange(options)) {
    const replacesSameRangeBackfill = hasSameBackgroundBackfillRange(options);
    const foregroundOptions = replacesSameRangeBackfill
      ? { ...options, cacheDateRangedScan: true, backgroundBackfill: false }
      : options;
    const reusableCache = await loadReusableCache(foregroundOptions);
    const result = await scanMailbox(foregroundOptions, {
      sinceUid: foregroundOptions.fullScan === false ? foregroundOptions.sinceUid : undefined,
      scanMode: options.fullScan === false ? "incremental" : "full",
    }, reusableCache);
    if (options.backgroundBackfill && !replacesSameRangeBackfill) {
      startBackgroundBackfill(options);
    }
    return result;
  }

  if (options.cachePath && options.fullScan === false) {
    return scanIncrementalWithCache(options);
  }

  const reusableCache = await loadReusableCache(options);
  return scanMailbox(options, {
    sinceUid: options.fullScan === false ? options.sinceUid : undefined,
    scanMode: options.fullScan === false ? "incremental" : "full",
  }, reusableCache);
}

async function scanIncrementalWithCache(options: ScanOrdersOptions): Promise<ScanResult> {
  const cachePath = options.cachePath;
  if (!cachePath) {
    return scanMailbox(options, { sinceUid: options.sinceUid, scanMode: "incremental" });
  }

  const cache = await loadOrderCache(cachePath);
  const accountEmail = normalizedAccountEmail(options.accountEmail);

  if (!cacheMatchesAccount(cache, accountEmail) || cache.lastUid <= 0 || hasLegacyRowsWithoutMessageDates(cache.rows)) {
    return scanMailbox(options, { sinceUid: undefined, scanMode: "full" });
  }

  const scanStarted = nowMs();
  const batch = await options.client.fetchExcelAttachmentBatch({
    sinceUid: cache.lastUid,
    ...cachedAttachmentFetchOptions(cache),
    includeMetrics: options.includeMetrics,
  });
  if (cache.uidvalidity && batch.uidvalidity && cache.uidvalidity !== batch.uidvalidity) {
    return scanMailbox(options, { sinceUid: undefined, scanMode: "full" });
  }

  const parseStarted = nowMs();
  const parsedBatch = parseAttachmentBatch(batch, options.parseAttachment ?? parseExcelAttachment, "incremental", cache);
  const parseMs = nowMs() - parseStarted;
  const newResult = parsedBatch.result;
  const result: ScanResult = {
    rows: mergeOrderRows(cache.rows, newResult.rows),
    warnings: [...cache.warnings, ...newResult.warnings],
    scannedMessages: cache.scannedMessages + batch.scannedMessages,
    parsedAttachments: cache.parsedAttachments + newResult.parsedAttachments,
    scanMode: "incremental",
  };
  attachScanMetrics(result, options, batch, parseMs, scanStarted);
  await saveCacheIfConfigured(options, batch, result, cache, parsedBatch.parsedAttachmentCache);
  return result;
}

async function scanMailbox(
  options: ScanOrdersOptions,
  scanOptions: { sinceUid: number | undefined; scanMode: ScanResult["scanMode"] },
  previousCache?: OrderCache,
): Promise<ScanResult> {
  const scanStarted = nowMs();
  const batch = await options.client.fetchExcelAttachmentBatch({
    sinceUid: scanOptions.sinceUid,
    ...sentDateFetchOptions(options),
    ...cachedAttachmentFetchOptions(previousCache),
    includeMetrics: options.includeMetrics,
  });
  const parseStarted = nowMs();
  const parsedBatch = parseAttachmentBatch(
    batch,
    options.parseAttachment ?? parseExcelAttachment,
    scanOptions.scanMode,
    previousCache,
  );
  const parseMs = nowMs() - parseStarted;
  attachScanMetrics(parsedBatch.result, options, batch, parseMs, scanStarted);
  await saveCacheIfConfigured(options, batch, parsedBatch.result, previousCache, parsedBatch.parsedAttachmentCache);
  return parsedBatch.result;
}

function parseAttachmentBatch(
  batch: AttachmentBatch,
  parser: ParseAttachment,
  scanMode: ScanResult["scanMode"],
  previousCache?: OrderCache,
): ParsedAttachmentBatch {
  const rows: OrderRow[] = [];
  const warnings: string[] = [];
  const parsedAttachmentCache: ParsedAttachmentCacheEntry[] = [];
  const cachedEntries = new Map((previousCache?.parsedAttachmentCache ?? []).map((entry) => [entry.key, entry]));

  for (const key of batch.cachedAttachmentKeys ?? []) {
    const entry = cachedEntries.get(key);
    if (!entry) {
      continue;
    }
    rows.push(...entry.rows);
    warnings.push(...entry.warnings);
    parsedAttachmentCache.push(entry);
  }

  for (const attachment of batch.attachments) {
    const parsed = parseOneAttachment(parser, attachment);
    rows.push(...parsed.rows);
    warnings.push(...parsed.warnings);
    parsedAttachmentCache.push({
      key: attachmentCacheKey(batch.uidvalidity, attachment.messageUid, attachment.messagePart, attachment.filename),
      rows: parsed.rows,
      warnings: parsed.warnings,
    });
  }

  return {
    result: {
      rows,
      warnings,
      scannedMessages: batch.scannedMessages,
      parsedAttachments: parsedAttachmentCache.length,
      scanMode,
    },
    parsedAttachmentCache,
  };
}

function parseOneAttachment(parser: ParseAttachment, attachment: EmailAttachment): AttachmentParseResult {
  return parser(attachment.filename, attachment.content, attachment.messageSubject, attachment.messageDate);
}

function sentDateFetchOptions(options: ScanOrdersOptions): Pick<ScanOrdersOptions, "sentStartDate" | "sentEndDate"> {
  if (!hasSentDateRange(options)) {
    return {};
  }

  return {
    sentStartDate: options.sentStartDate,
    sentEndDate: options.sentEndDate,
  };
}

function hasSentDateRange(options: Pick<ScanOrdersOptions, "sentStartDate" | "sentEndDate">): boolean {
  return Boolean(options.sentStartDate || options.sentEndDate);
}

function hasSameBackgroundBackfillRange(
  options: Pick<
    ScanOrdersOptions,
    "backgroundBackfill" | "sentStartDate" | "sentEndDate" | "backgroundSentStartDate" | "backgroundSentEndDate"
  >,
): boolean {
  return Boolean(
    options.backgroundBackfill &&
    options.sentStartDate === options.backgroundSentStartDate &&
    options.sentEndDate === options.backgroundSentEndDate,
  );
}

function startBackgroundBackfill(options: ScanOrdersOptions): void {
  if (backgroundBackfill) {
    options.onBackgroundBackfillStatus?.({
      state: "skipped",
      message: "历史邮件同步已在后台运行。",
    });
    return;
  }

  const backfillOptions = {
    ...options,
    sentStartDate: options.backgroundSentStartDate,
    sentEndDate: options.backgroundSentEndDate,
    backgroundBackfill: false,
    cacheDateRangedScan: true,
  };
  options.onBackgroundBackfillStatus?.({
    state: "started",
    message: hasSentDateRange(backfillOptions) ? "正在后台同步近一个月邮件。" : "正在后台同步历史邮件。",
  });
  backgroundBackfill = loadReusableCache(backfillOptions)
    .then((reusableCache) => scanMailbox(backfillOptions, { sinceUid: undefined, scanMode: "full" }, reusableCache))
    .then(() => {
      options.onBackgroundBackfillStatus?.({
        state: "completed",
        message: hasSentDateRange(backfillOptions) ? "近一个月邮件同步完成，缓存已更新。" : "历史邮件同步完成，缓存已更新。",
      });
    })
    .catch((error: unknown) => {
      options.onBackgroundBackfillStatus?.({
        state: "failed",
        message: `历史邮件后台同步失败：${error instanceof Error ? error.message : String(error)}`,
      });
      console.warn("历史邮件后台扫描失败：", error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      backgroundBackfill = null;
    });
}

async function saveCacheIfConfigured(
  options: ScanOrdersOptions,
  batch: AttachmentBatch,
  result: ScanResult,
  previousCache?: OrderCache,
  parsedAttachmentCache: ParsedAttachmentCacheEntry[] = [],
): Promise<void> {
  const accountEmail = normalizedAccountEmail(options.accountEmail);
  if (!options.cachePath || !accountEmail || (hasSentDateRange(options) && !options.cacheDateRangedScan)) {
    return;
  }

  const retentionStartDate = cacheRetentionStartDate(options);
  const rows = rowsInsideSentDateWindow(result.rows, retentionStartDate);
  const parsedCache = parsedAttachmentCacheInsideSentDateWindow(
    mergeParsedAttachmentCache(previousCache?.parsedAttachmentCache ?? [], parsedAttachmentCache),
    retentionStartDate,
  );

  await saveOrderCache(options.cachePath, {
    email: accountEmail,
    uidvalidity: batch.uidvalidity || previousCache?.uidvalidity || "",
    lastUid: Math.max(batch.latestUid, previousCache?.lastUid ?? 0),
    rows,
    warnings: result.warnings,
    scannedMessages: result.scannedMessages,
    parsedAttachments: retentionStartDate ? parsedCache.length : result.parsedAttachments,
    parsedAttachmentCache: parsedCache,
  });
}

function attachScanMetrics(
  result: ScanResult,
  options: Pick<ScanOrdersOptions, "includeMetrics">,
  batch: AttachmentBatch,
  parseMs: number,
  scanStarted: number,
): void {
  if (!options.includeMetrics) {
    return;
  }

  result.metrics = {
    totalMs: nowMs() - scanStarted,
    connectMs: batch.metrics?.connectMs ?? 0,
    searchMs: batch.metrics?.searchMs ?? 0,
    fetchMs: batch.metrics?.fetchMs ?? 0,
    downloadMs: batch.metrics?.downloadMs ?? 0,
    parseMs,
    cacheHits: batch.metrics?.cacheHits ?? batch.cachedAttachmentKeys?.length ?? 0,
    retryCount: batch.metrics?.retryCount ?? 0,
  };
}

function cacheRetentionStartDate(options: ScanOrdersOptions): string | undefined {
  return options.cacheDateRangedScan ? options.sentStartDate : undefined;
}

function rowsInsideSentDateWindow(rows: OrderRow[], startDate: string | undefined): OrderRow[] {
  if (!startDate) {
    return rows;
  }

  return rows.filter((row) => {
    const sentDate = sentDateFromMessageDate(row.messageDate);
    return !sentDate || sentDate >= startDate;
  });
}

function parsedAttachmentCacheInsideSentDateWindow(
  entries: ParsedAttachmentCacheEntry[],
  startDate: string | undefined,
): ParsedAttachmentCacheEntry[] {
  if (!startDate) {
    return entries;
  }

  return entries
    .map((entry) => ({
      ...entry,
      rows: rowsInsideSentDateWindow(entry.rows, startDate),
    }))
    .filter((entry) => entry.rows.length > 0);
}

function nowMs(): number {
  return performance.now();
}

async function loadReusableCache(options: ScanOrdersOptions): Promise<OrderCache | undefined> {
  const accountEmail = normalizedAccountEmail(options.accountEmail);
  if (!options.cachePath || !accountEmail) {
    return undefined;
  }

  const cache = await loadOrderCache(options.cachePath);
  if (!cacheMatchesAccount(cache, accountEmail) || hasLegacyRowsWithoutMessageDates(cache.rows)) {
    return undefined;
  }
  return cache;
}

function cachedAttachmentFetchOptions(cache: OrderCache | undefined): { cachedAttachmentKeys?: string[] } {
  const cachedAttachmentKeys = cache?.parsedAttachmentCache?.map((entry) => entry.key).filter(Boolean) ?? [];
  return cachedAttachmentKeys.length > 0 ? { cachedAttachmentKeys } : {};
}

function normalizedAccountEmail(email: string | undefined): string {
  return (email ?? "").trim();
}

function cacheMatchesAccount(cache: OrderCache, accountEmail: string): boolean {
  return Boolean(cache.email && accountEmail && cache.email === accountEmail);
}

function hasLegacyRowsWithoutMessageDates(rows: OrderRow[]): boolean {
  return rows.some((row) => !row.messageDate.trim());
}
