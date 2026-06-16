import { parseExcelAttachment, type AttachmentParseResult } from "./excelParser.js";
import type { AttachmentBatch, AttachmentClient, EmailAttachment } from "./mailClient.js";
import { loadOrderCache, mergeOrderRows, saveOrderCache, type OrderCache } from "./orderCache.js";
import type { OrderRow, ScanResult } from "../../shared/types.js";

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
  cachePath?: string;
  accountEmail?: string;
  parseAttachment?: ParseAttachment;
};

export async function scanOrders(options: ScanOrdersOptions): Promise<ScanResult> {
  if (options.cachePath && options.fullScan === false) {
    return scanIncrementalWithCache(options);
  }

  return scanMailbox(options, {
    sinceUid: options.fullScan === false ? options.sinceUid : undefined,
    scanMode: options.fullScan === false ? "incremental" : "full",
  });
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

  const batch = await options.client.fetchExcelAttachmentBatch({ sinceUid: cache.lastUid });
  if (cache.uidvalidity && batch.uidvalidity && cache.uidvalidity !== batch.uidvalidity) {
    return scanMailbox(options, { sinceUid: undefined, scanMode: "full" });
  }

  const newResult = parseAttachmentBatch(batch, options.parseAttachment ?? parseExcelAttachment, "incremental");
  const result: ScanResult = {
    rows: mergeOrderRows(cache.rows, newResult.rows),
    warnings: [...cache.warnings, ...newResult.warnings],
    scannedMessages: cache.scannedMessages + batch.scannedMessages,
    parsedAttachments: cache.parsedAttachments + batch.attachments.length,
    scanMode: "incremental",
  };
  await saveCacheIfConfigured(options, batch, result, cache);
  return result;
}

async function scanMailbox(
  options: ScanOrdersOptions,
  scanOptions: { sinceUid: number | undefined; scanMode: ScanResult["scanMode"] },
): Promise<ScanResult> {
  const batch = await options.client.fetchExcelAttachmentBatch({ sinceUid: scanOptions.sinceUid });
  const result = parseAttachmentBatch(batch, options.parseAttachment ?? parseExcelAttachment, scanOptions.scanMode);
  await saveCacheIfConfigured(options, batch, result);
  return result;
}

function parseAttachmentBatch(batch: AttachmentBatch, parser: ParseAttachment, scanMode: ScanResult["scanMode"]): ScanResult {
  const rows: OrderRow[] = [];
  const warnings: string[] = [];

  for (const attachment of batch.attachments) {
    const parsed = parseOneAttachment(parser, attachment);
    rows.push(...parsed.rows);
    warnings.push(...parsed.warnings);
  }

  return {
    rows,
    warnings,
    scannedMessages: batch.scannedMessages,
    parsedAttachments: batch.attachments.length,
    scanMode,
  };
}

function parseOneAttachment(parser: ParseAttachment, attachment: EmailAttachment): AttachmentParseResult {
  return parser(attachment.filename, attachment.content, attachment.messageSubject, attachment.messageDate);
}

async function saveCacheIfConfigured(
  options: ScanOrdersOptions,
  batch: AttachmentBatch,
  result: ScanResult,
  previousCache?: OrderCache,
): Promise<void> {
  const accountEmail = normalizedAccountEmail(options.accountEmail);
  if (!options.cachePath || !accountEmail) {
    return;
  }

  await saveOrderCache(options.cachePath, {
    email: accountEmail,
    uidvalidity: batch.uidvalidity || previousCache?.uidvalidity || "",
    lastUid: Math.max(batch.latestUid, previousCache?.lastUid ?? 0),
    rows: result.rows,
    warnings: result.warnings,
    scannedMessages: result.scannedMessages,
    parsedAttachments: result.parsedAttachments,
  });
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
