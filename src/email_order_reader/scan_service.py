from __future__ import annotations

from typing import Protocol

from email_order_reader.excel_parser import parse_excel_attachment
from email_order_reader.models import ColumnAliases, EmailAttachment, ScanResult


class RecentAttachmentClient(Protocol):
    def fetch_recent_excel_attachments(self, hours: int = 24) -> tuple[list[EmailAttachment], int]:
        pass


class OrderScanService:
    def __init__(self, client: RecentAttachmentClient, aliases: ColumnAliases | None = None) -> None:
        self.client = client
        self.aliases = aliases or ColumnAliases.default()

    def scan_recent_orders(self, hours: int = 24) -> ScanResult:
        attachments, scanned_messages = self.client.fetch_recent_excel_attachments(hours=hours)

        rows = []
        warnings = []
        for attachment in attachments:
            parse_result = parse_excel_attachment(
                attachment.filename,
                attachment.content,
                self.aliases,
                message_subject=attachment.message_subject,
            )
            rows.extend(parse_result.rows)
            warnings.extend(parse_result.warnings)

        return ScanResult(
            rows=rows,
            warnings=warnings,
            scanned_messages=scanned_messages,
            parsed_attachments=len(attachments),
        )
