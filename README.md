# 订单快读

Order Quick Read is a minimal Electron desktop app for reading Enterprise WeChat/Tencent Exmail order emails and Excel attachments.

## 下载与更新

国内用户优先使用 [AUSMET 下载站](https://download.ausmet.ai/orderead/)，GitHub
[Latest Release](https://github.com/1192081163/OrdeRead/releases/latest) 作为备用入口。应用检查更新时会先访问
AUSMET 下载站；如果下载站不可用，再自动回退 GitHub。安装包附带 SHA-256 校验，应用下载后会先验证再打开。

## 功能

- 优先使用 Orderflow Email API 服务器读取邮件并提取订单；未配置服务器时可回退到本地企业微信邮箱 IMAP：`imap.exmail.qq.com:993`。
- 读取邮件里的 `.xlsx`、`.xlsm`、`.xls` 附件或服务器端提取结果。
- 前台只显示两列：`订单号` 和 `截至时间`。
- 按截止时间排序，并支持按订单号、发送日期筛选。
- 邮箱和授权码保存到本机，启动后自动填入；配置完整后设置区自动收起。
- 每 30 秒自动刷新新邮件，也可以手动刷新或扫描全部邮件。
- 发现新增订单或截止时间变化时发出系统通知。
- 启动时静默检查 AUSMET 下载站和 GitHub Release，也可以点击 `检查更新`；发现新版后下载、校验并打开安装包。

## 本地数据

Electron 版使用系统应用数据目录：

```text
Windows: %APPDATA%\Order Quick Read\settings.json
macOS: ~/Library/Application Support/Order Quick Read/settings.json
```

订单缓存保存在同一目录的 `order_cache.json`。缓存只保存提取后的订单信息，不保存邮件正文或附件文件。

旧版 Python 应用的配置会自动迁移：

```text
Windows: %APPDATA%\EmailOrderReader\settings.json
macOS/Linux: ~/.email-order-reader/settings.json
```

授权码是本地 JSON 保存，不写入系统钥匙串。

## 开发

```bash
npm ci
npm run electron:dev
```

常用检查：

```bash
npm run electron:test
npm run electron:typecheck
npm run electron:build:main
```

## 本地打包

```bash
npm run electron:pack
```

快速打包会生成可运行的 app 目录，不生成安装包。正式生成安装包：

```bash
npm run electron:dist
```

产物输出到：

```text
dist-electron-packages/
```

## CI 与发布

推送到 `main` 后，GitHub Actions 会测试、构建并发布：

```text
OrderQuickReadSetup.exe
```

工作流会同时创建 GitHub Latest Release，并把完整安装包、`OrderQuickReadSetup.exe.sha256`、版本清单和下载页面
自动发布到 AUSMET 下载站。Windows 用户可以直接使用应用内更新，也可以从下载页面获取
`OrderQuickReadSetup.exe` 后双击安装。当前 GitHub Actions 只发布 Windows 安装包。

## 安全说明

邮箱地址和授权码保存在本机应用数据目录的 JSON 文件中，当前不会写入 macOS Keychain
或 Windows Credential Manager。请不要把本地 `settings.json`、`order_cache.json`、
下载的附件、打包产物或安装包提交到仓库。

如果发现安全问题，请按 `SECURITY.md` 私下报告。

## 参与贡献

开发流程和提交要求见 `CONTRIBUTING.md`。参与讨论和提交代码时请遵守
`CODE_OF_CONDUCT.md`。

## 开源许可

本项目使用 MIT License，详见 `LICENSE`。
