from datetime import date
from io import BytesIO

from openpyxl import Workbook

from email_order_reader.models import ColumnAliases, EmailAttachment
from email_order_reader.scan_service import OrderScanService


class FakeClient:
    def __init__(self, attachments, scanned_messages):
        self.attachments = attachments
        self.scanned_messages = scanned_messages
        self.hours = None

    def fetch_recent_excel_attachments(self, hours=24):
        self.hours = hours
        return self.attachments, self.scanned_messages


def make_attachment(filename="orders.xlsx"):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["订单号", "交单日期"])
    sheet.append(["PO-6006", date(2026, 10, 1)])
    stream = BytesIO()
    workbook.save(stream)
    return EmailAttachment(
        filename=filename,
        content=stream.getvalue(),
        message_subject="供应商订单",
    )


def test_scan_service_replaces_current_results_from_attachments():
    client = FakeClient([make_attachment()], scanned_messages=2)
    service = OrderScanService(client=client, aliases=ColumnAliases.default())

    result = service.scan_recent_orders(hours=24)

    assert client.hours == 24
    assert result.scanned_messages == 2
    assert result.parsed_attachments == 1
    assert [(row.order_number, row.deadline) for row in result.rows] == [("PO-6006", "2026-10-01")]
    assert result.warnings == []


def test_scan_service_keeps_attachment_warnings():
    client = FakeClient([EmailAttachment(filename="bad.xlsx", content=b"bad")], scanned_messages=1)
    service = OrderScanService(client=client, aliases=ColumnAliases.default())

    result = service.scan_recent_orders(hours=24)

    assert result.rows == []
    assert result.parsed_attachments == 1
    assert result.warnings
    assert result.warnings[0].startswith("bad.xlsx：无法读取Excel附件")
