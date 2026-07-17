#!/usr/bin/env bash

set -euo pipefail

: "${DOWNLOAD_SSH_HOST:?DOWNLOAD_SSH_HOST is required}"
: "${DOWNLOAD_SSH_USER:?DOWNLOAD_SSH_USER is required}"
: "${DOWNLOAD_TAG:?DOWNLOAD_TAG is required}"

download_base_url="${DOWNLOAD_BASE_URL:-https://download.ausmet.ai/orderead}"
remote_root="${DOWNLOAD_REMOTE_ROOT:-/srv/orderflow-download/public/orderead}"
windows_asset="${1:-}"

if [[ ! "${DOWNLOAD_TAG}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsupported download release tag: ${DOWNLOAD_TAG}" >&2
  exit 2
fi
if [[ "${download_base_url}" != "https://download.ausmet.ai/orderead" ]]; then
  echo "Unsupported download base URL: ${download_base_url}" >&2
  exit 2
fi
if [[ "${remote_root}" != "/srv/orderflow-download/public/orderead" ]]; then
  echo "Unsupported remote download root: ${remote_root}" >&2
  exit 2
fi
if [[ ! -f "${windows_asset}" || "$(basename "${windows_asset}")" != "OrderQuickReadSetup.exe" ]]; then
  echo "Expected the Windows release asset OrderQuickReadSetup.exe." >&2
  exit 2
fi

work_dir=$(mktemp -d)
ssh_target="${DOWNLOAD_SSH_USER}@${DOWNLOAD_SSH_HOST}"
ssh_options=(-o BatchMode=yes -o IdentitiesOnly=yes)
if [[ -n "${DOWNLOAD_SSH_KEY_PATH:-}" ]]; then
  ssh_options+=(-i "${DOWNLOAD_SSH_KEY_PATH}")
fi
if [[ -n "${DOWNLOAD_SSH_KNOWN_HOSTS_PATH:-}" ]]; then
  ssh_options+=(-o "UserKnownHostsFile=${DOWNLOAD_SSH_KNOWN_HOSTS_PATH}")
fi
run_token="${GITHUB_RUN_ID:-manual}-$$"
remote_staging="${remote_root}/releases/.upload-${DOWNLOAD_TAG}-${run_token}"
remote_target="${remote_root}/releases/${DOWNLOAD_TAG}"
remote_previous="${remote_root}/releases/.previous-${DOWNLOAD_TAG}-${run_token}"

cleanup() {
  rm -rf "${work_dir}"
  ssh "${ssh_options[@]}" "${ssh_target}" \
    "rm -rf '${remote_staging}' '${remote_previous}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if command -v sha256sum >/dev/null 2>&1; then
  windows_sha=$(sha256sum "${windows_asset}" | awk '{print $1}')
else
  windows_sha=$(shasum -a 256 "${windows_asset}" | awk '{print $1}')
fi
if windows_size=$(stat -c '%s' "${windows_asset}" 2>/dev/null); then
  :
else
  windows_size=$(stat -f '%z' "${windows_asset}")
fi

printf '%s  %s\n' "${windows_sha}" "OrderQuickReadSetup.exe" \
  > "${work_dir}/OrderQuickReadSetup.exe.sha256"

jq -n \
  --arg tag_name "${DOWNLOAD_TAG}" \
  --arg html_url "${download_base_url}/releases/${DOWNLOAD_TAG}/" \
  --arg published_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg windows_url "${download_base_url}/releases/${DOWNLOAD_TAG}/OrderQuickReadSetup.exe" \
  --arg windows_checksum_url "${download_base_url}/releases/${DOWNLOAD_TAG}/OrderQuickReadSetup.exe.sha256" \
  --arg windows_sha "${windows_sha}" \
  --argjson windows_size "${windows_size}" \
  '{
    tag_name: $tag_name,
    html_url: $html_url,
    published_at: $published_at,
    assets: [
      {name: "OrderQuickReadSetup.exe", browser_download_url: $windows_url, sha256: $windows_sha, size: $windows_size},
      {name: "OrderQuickReadSetup.exe.sha256", browser_download_url: $windows_checksum_url}
    ]
  }' > "${work_dir}/latest.json"

cat > "${work_dir}/index.html" <<HTML
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>订单快读下载</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f2eb; color: #1d1d1b; }
    main { box-sizing: border-box; width: min(680px, calc(100% - 32px)); margin: 10vh auto; padding: 48px; background: #fff; border: 1px solid #d8d2c7; border-radius: 20px; }
    h1 { margin: 0 0 12px; font-size: clamp(28px, 6vw, 44px); }
    p { line-height: 1.65; color: #5d594f; }
    .tag { margin-bottom: 28px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .download { display: block; padding: 16px 20px; border-radius: 12px; background: #1d1d1b; color: #fff; text-decoration: none; font-weight: 650; }
    .footer { margin: 26px 0 0; font-size: 14px; }
    .footer a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>订单快读</h1>
    <p>最新版 Windows 安装包由 AUSMET 下载站直接提供。</p>
    <p class="tag">${DOWNLOAD_TAG}</p>
    <a class="download" href="/orderead/releases/${DOWNLOAD_TAG}/OrderQuickReadSetup.exe">下载 Windows 安装包</a>
    <p class="footer"><a href="https://github.com/1192081163/OrdeRead/releases/latest">GitHub 备用下载</a></p>
  </main>
</body>
</html>
HTML

ssh "${ssh_options[@]}" "${ssh_target}" \
  "set -e; rm -rf '${remote_staging}'; mkdir -p '${remote_staging}'"
scp -q "${ssh_options[@]}" \
  "${windows_asset}" \
  "${work_dir}/OrderQuickReadSetup.exe.sha256" \
  "${work_dir}/latest.json" \
  "${work_dir}/index.html" \
  "${ssh_target}:${remote_staging}/"

ssh "${ssh_options[@]}" "${ssh_target}" "set -e
test -s '${remote_staging}/OrderQuickReadSetup.exe'
chmod 0644 '${remote_staging}'/*
rm -rf '${remote_previous}'
if test -e '${remote_target}'; then mv '${remote_target}' '${remote_previous}'; fi
if ! mv '${remote_staging}' '${remote_target}'; then
  if test -e '${remote_previous}'; then mv '${remote_previous}' '${remote_target}'; fi
  exit 1
fi
install -m 0644 '${remote_target}/latest.json' '${remote_root}/latest.json.tmp'
mv '${remote_root}/latest.json.tmp' '${remote_root}/latest.json'
install -m 0644 '${remote_target}/index.html' '${remote_root}/index.html.tmp'
mv '${remote_root}/index.html.tmp' '${remote_root}/index.html'
rm -rf '${remote_previous}'"

trap - EXIT
rm -rf "${work_dir}"
printf 'Published %s to %s\n' "${DOWNLOAD_TAG}" "${download_base_url}"
