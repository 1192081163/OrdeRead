from __future__ import annotations

import imaplib
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import Message
from email.policy import default
from email.utils import parsedate_to_datetime
from pathlib import Path

from email_order_reader.models import EmailAttachment, ImapConfig


SUPPORTED_EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xls"}


def imap_since_date(cutoff: datetime) -> str:
    return cutoff.strftime("%d-%b-%Y")


def is_excel_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXCEL_SUFFIXES


def parse_message_date(message: Message) -> datetime | None:
    raw_date = message.get("Date")
    if not raw_date:
        return None
    parsed = parsedate_to_datetime(raw_date)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def decode_mime_text(value: str | None) -> str:
    if not value:
        return ""
    return str(make_header(decode_header(value)))


def extract_excel_attachments(message: Message) -> list[EmailAttachment]:
    subject = decode_mime_text(message.get("Subject"))
    message_date = parse_message_date(message)
    attachments: list[EmailAttachment] = []

    for part in message.walk():
        filename = part.get_filename()
        if not filename:
            continue

        decoded_filename = decode_mime_text(filename)
        if not is_excel_filename(decoded_filename):
            continue

        payload = part.get_payload(decode=True)
        if payload is None:
            continue

        attachments.append(
            EmailAttachment(
                filename=decoded_filename,
                content=payload,
                message_subject=subject,
                message_date=message_date,
            )
        )

    return attachments


class ImapEmailClient:
    def __init__(self, config: ImapConfig, timeout_seconds: int = 30) -> None:
        self.config = config
        self.timeout_seconds = timeout_seconds

    def fetch_recent_excel_attachments(self, hours: int = 24) -> tuple[list[EmailAttachment], int]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        attachments: list[EmailAttachment] = []
        scanned_messages = 0

        with imaplib.IMAP4_SSL(self.config.server, self.config.port, timeout=self.timeout_seconds) as mailbox:
            mailbox.login(self.config.email, self.config.auth_code)
            mailbox.select("INBOX")
            status, data = mailbox.search(None, "SINCE", imap_since_date(cutoff))
            if status != "OK":
                raise RuntimeError("邮箱搜索失败")

            message_ids = data[0].split() if data and data[0] else []
            for message_id in message_ids:
                status, fetch_data = mailbox.fetch(message_id, "(RFC822)")
                if status != "OK":
                    continue

                for item in fetch_data:
                    if not isinstance(item, tuple):
                        continue

                    message = message_from_bytes(item[1], policy=default)
                    message_date = parse_message_date(message)
                    if message_date is not None and message_date < cutoff:
                        continue

                    scanned_messages += 1
                    attachments.extend(extract_excel_attachments(message))

        return attachments, scanned_messages
