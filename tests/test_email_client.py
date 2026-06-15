from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from email_order_reader.email_client import (
    extract_excel_attachments,
    imap_since_date,
    is_excel_filename,
    parse_message_date,
)


def test_imap_since_date_uses_cutoff_calendar_date():
    now = datetime(2026, 6, 15, 10, 30, tzinfo=timezone.utc)

    assert imap_since_date(now - timedelta(hours=24)) == "14-Jun-2026"


def test_is_excel_filename_accepts_supported_formats():
    assert is_excel_filename("orders.xlsx")
    assert is_excel_filename("orders.xlsm")
    assert is_excel_filename("orders.xls")
    assert not is_excel_filename("orders.csv")


def test_extract_excel_attachments_decodes_filename_and_payload():
    message = EmailMessage()
    message["Subject"] = "供应商订单"
    message["Date"] = "Mon, 15 Jun 2026 10:00:00 +0000"
    message.set_content("see attachment")
    message.add_attachment(
        b"excel-bytes",
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="orders.xlsx",
    )
    message.add_attachment(
        b"text-bytes",
        maintype="text",
        subtype="plain",
        filename="notes.txt",
    )

    attachments = extract_excel_attachments(message)

    assert len(attachments) == 1
    assert attachments[0].filename == "orders.xlsx"
    assert attachments[0].content == b"excel-bytes"
    assert attachments[0].message_subject == "供应商订单"
    assert attachments[0].message_date == datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)


def test_parse_message_date_returns_none_for_missing_date():
    message = EmailMessage()

    assert parse_message_date(message) is None
