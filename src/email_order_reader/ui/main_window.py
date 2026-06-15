from __future__ import annotations

from PySide6.QtCore import QObject, QThread, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from email_order_reader.email_client import ImapEmailClient
from email_order_reader.models import ColumnAliases, ImapConfig, ScanResult
from email_order_reader.scan_service import OrderScanService


class ScanWorker(QObject):
    finished = Signal(object)
    failed = Signal(str)

    def __init__(self, config: ImapConfig, aliases: ColumnAliases) -> None:
        super().__init__()
        self.config = config
        self.aliases = aliases

    def run(self) -> None:
        try:
            client = ImapEmailClient(self.config)
            service = OrderScanService(client=client, aliases=self.aliases)
            self.finished.emit(service.scan_recent_orders(hours=24))
        except Exception as exc:
            self.failed.emit(str(exc))


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("邮件订单读取")
        self.resize(760, 520)
        self.thread: QThread | None = None
        self.worker: ScanWorker | None = None

        root = QWidget()
        self.setCentralWidget(root)
        self.root_layout = QVBoxLayout(root)

        self.settings_panel = QWidget()
        settings_layout = QFormLayout(self.settings_panel)
        self.server_input = QLineEdit()
        self.port_input = QLineEdit("993")
        self.email_input = QLineEdit()
        self.auth_code_input = QLineEdit()
        self.auth_code_input.setEchoMode(QLineEdit.Password)

        self.advanced_toggle_button = QPushButton("高级列名")
        self.advanced_panel = QWidget()
        advanced_layout = QFormLayout(self.advanced_panel)
        self.order_alias_input = QLineEdit()
        self.order_alias_input.setPlaceholderText("额外订单号列名，用逗号分隔")
        self.deadline_alias_input = QLineEdit()
        self.deadline_alias_input.setPlaceholderText("额外截至时间列名，用逗号分隔")
        advanced_layout.addRow("订单号别名", self.order_alias_input)
        advanced_layout.addRow("截至时间别名", self.deadline_alias_input)
        self.advanced_panel.hide()

        settings_layout.addRow("IMAP服务器", self.server_input)
        settings_layout.addRow("端口", self.port_input)
        settings_layout.addRow("邮箱", self.email_input)
        settings_layout.addRow("授权码", self.auth_code_input)
        settings_layout.addRow(self.advanced_toggle_button)
        settings_layout.addRow(self.advanced_panel)

        settings_button_row = QHBoxLayout()
        settings_button_row.addStretch()
        self.refresh_button = QPushButton("刷新最近24小时")
        settings_button_row.addWidget(self.refresh_button)
        settings_layout.addRow(settings_button_row)

        self.summary_panel = QWidget()
        summary_layout = QHBoxLayout(self.summary_panel)
        self.summary_label = QLabel("")
        self.summary_refresh_button = QPushButton("刷新")
        self.edit_settings_button = QPushButton("修改邮箱设置")
        summary_layout.addWidget(self.summary_label)
        summary_layout.addStretch()
        summary_layout.addWidget(self.summary_refresh_button)
        summary_layout.addWidget(self.edit_settings_button)
        self.summary_panel.hide()

        self.table = QTableWidget(0, 2)
        self.table.setHorizontalHeaderLabels(["订单号", "截至时间"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)

        self.status_label = QLabel("请填写邮箱信息后刷新。")
        self.status_label.setWordWrap(True)

        self.root_layout.addWidget(self.settings_panel)
        self.root_layout.addWidget(self.summary_panel)
        self.root_layout.addWidget(self.table)
        self.root_layout.addWidget(self.status_label)

        for input_widget in (self.server_input, self.port_input, self.email_input, self.auth_code_input):
            input_widget.textChanged.connect(self.update_settings_visibility)
        self.advanced_toggle_button.clicked.connect(self.toggle_advanced_panel)
        self.edit_settings_button.clicked.connect(self.expand_settings)
        self.refresh_button.clicked.connect(self.start_scan)
        self.summary_refresh_button.clicked.connect(self.start_scan)

    def required_fields_present(self) -> bool:
        return all(
            field.text().strip()
            for field in (self.server_input, self.port_input, self.email_input, self.auth_code_input)
        )

    def update_settings_visibility(self) -> None:
        if self.required_fields_present():
            self.collapse_settings()

    def collapse_settings(self) -> None:
        self.summary_label.setText(f"{self.email_input.text().strip()} / {self.server_input.text().strip()}")
        self.settings_panel.hide()
        self.summary_panel.show()

    def expand_settings(self) -> None:
        self.summary_panel.hide()
        self.settings_panel.show()

    def toggle_advanced_panel(self) -> None:
        self.advanced_panel.setHidden(not self.advanced_panel.isHidden())

    def build_aliases(self) -> ColumnAliases:
        defaults = ColumnAliases.default()
        return ColumnAliases(
            order_number=_merge_aliases(defaults.order_number, self.order_alias_input.text()),
            deadline=_merge_aliases(defaults.deadline, self.deadline_alias_input.text()),
        )

    def build_config(self) -> ImapConfig | None:
        if not self.required_fields_present():
            QMessageBox.warning(self, "缺少邮箱信息", "请填写IMAP服务器、端口、邮箱和授权码。")
            return None
        try:
            port = int(self.port_input.text().strip())
        except ValueError:
            QMessageBox.warning(self, "端口错误", "端口必须是数字。")
            return None
        return ImapConfig(
            server=self.server_input.text().strip(),
            port=port,
            email=self.email_input.text().strip(),
            auth_code=self.auth_code_input.text(),
        )

    def start_scan(self) -> None:
        config = self.build_config()
        if config is None:
            return

        self.refresh_button.setEnabled(False)
        self.summary_refresh_button.setEnabled(False)
        self.status_label.setText("正在扫描最近24小时邮件...")

        self.thread = QThread()
        self.worker = ScanWorker(config=config, aliases=self.build_aliases())
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.finished.connect(self.apply_scan_result)
        self.worker.failed.connect(self.apply_scan_error)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.worker.finished.connect(self.worker.deleteLater)
        self.worker.failed.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.finished.connect(self._scan_finished)
        self.thread.start()

    def _scan_finished(self) -> None:
        self.refresh_button.setEnabled(True)
        self.summary_refresh_button.setEnabled(True)
        self.thread = None
        self.worker = None

    def apply_scan_result(self, result: ScanResult) -> None:
        self.table.setRowCount(0)
        for row in result.rows:
            row_index = self.table.rowCount()
            self.table.insertRow(row_index)
            self.table.setItem(row_index, 0, QTableWidgetItem(row.order_number))
            self.table.setItem(row_index, 1, QTableWidgetItem(row.deadline))

        status = f"已解析 {result.parsed_attachments} 个附件，读取 {result.row_count} 条订单。"
        if result.warnings:
            status = f"{status} {'；'.join(result.warnings)}"
        self.status_label.setText(status)

    def apply_scan_error(self, message: str) -> None:
        self.status_label.setText(f"扫描失败：{message}")


def _merge_aliases(defaults: tuple[str, ...], extra_text: str) -> tuple[str, ...]:
    values = list(defaults)
    normalized_text = extra_text.replace("，", ",").replace("；", ",").replace(";", ",")
    for item in normalized_text.split(","):
        value = item.strip()
        if value and value not in values:
            values.append(value)
    return tuple(values)
