import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

const SUPPORTED_EXCEL_EXTENSION = /\.(xlsx|xlsm|xls)$/i;

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
};

export type AttachmentBatch = {
  attachments: EmailAttachment[];
  scannedMessages: number;
  latestUid: number;
  uidvalidity: string;
};

export type AttachmentFetchOptions = {
  sinceUid?: number;
};

export type AttachmentClient = {
  fetchExcelAttachmentBatch(options: AttachmentFetchOptions): Promise<AttachmentBatch>;
};

type SelectedMailbox = {
  uidValidity?: bigint | number | string;
  uidNext?: number;
};

export class ImapAttachmentClient implements AttachmentClient {
  constructor(private readonly config: ImapConfig) {}

  async fetchExcelAttachmentBatch(options: AttachmentFetchOptions): Promise<AttachmentBatch> {
    const client = new ImapFlow(this.createClientOptions());
    const attachments: EmailAttachment[] = [];
    let scannedMessages = 0;
    let latestUid = options.sinceUid ?? 0;
    let uidvalidity = "";

    try {
      await client.connect();
    } catch (error) {
      throw new Error(formatLoginError(error));
    }

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mailbox = client.mailbox as SelectedMailbox | false;
        uidvalidity = mailbox ? String(mailbox.uidValidity ?? "") : "";
        if (isNoNewUidRange(options.sinceUid, mailbox ? mailbox.uidNext : undefined)) {
          return { attachments, scannedMessages, latestUid, uidvalidity };
        }

        const fetchRange = createFetchRange(options.sinceUid);
        for await (const message of client.fetch(
          fetchRange,
          { uid: true, envelope: true, internalDate: true, source: true },
          { uid: true },
        )) {
          if (options.sinceUid !== undefined && message.uid <= options.sinceUid) {
            continue;
          }

          scannedMessages += 1;
          latestUid = Math.max(latestUid, message.uid);
          if (!message.source) {
            continue;
          }

          const parsed = await simpleParser(message.source);
          const messageSubject = parsed.subject ?? message.envelope?.subject ?? "";
          const messageDate = messageDateFromParsedMail(parsed, message.envelope?.date ?? message.internalDate);

          for (const attachment of parsed.attachments) {
            const filename = attachment.filename ?? "";
            if (!isExcelFilename(filename)) {
              continue;
            }

            attachments.push({
              filename,
              content: attachment.content,
              messageSubject,
              messageDate,
              messageUid: message.uid,
            });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    return { attachments, scannedMessages, latestUid, uidvalidity };
  }

  private createClientOptions(): ImapFlowOptions {
    return {
      host: this.config.host ?? ENTERPRISE_WECHAT_IMAP_HOST,
      port: this.config.port ?? 993,
      secure: this.config.secure ?? true,
      auth: {
        user: this.config.email,
        pass: this.config.authCode,
      },
    };
  }
}

function createFetchRange(sinceUid: number | undefined): string {
  if (sinceUid === undefined || sinceUid <= 0) {
    return "1:*";
  }
  return `${sinceUid + 1}:*`;
}

function isNoNewUidRange(sinceUid: number | undefined, uidNext: number | undefined): boolean {
  return sinceUid !== undefined && sinceUid > 0 && uidNext !== undefined && sinceUid + 1 >= uidNext;
}

function isExcelFilename(filename: string): boolean {
  return SUPPORTED_EXCEL_EXTENSION.test(filename);
}

function messageDateFromParsedMail(parsed: ParsedMail, fallback: Date | string | undefined): string {
  const rawDateHeader = parsed.headerLines?.find((header) => header.key.toLowerCase() === "date")?.line;
  const dateFromHeader = rawDateHeader ? rfcDateHeaderToIso(rawDateHeader) : "";
  if (dateFromHeader) {
    return dateFromHeader;
  }

  return toIsoDate(parsed.date ?? fallback);
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

function exceptionText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
