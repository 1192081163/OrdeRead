#!/usr/bin/env bash

set -euo pipefail

: "${GITEE_TOKEN:?GITEE_TOKEN is required}"
: "${GITEE_TAG:?GITEE_TAG is required}"
: "${GITEE_TARGET:?GITEE_TARGET is required}"

GITEE_OWNER="${GITEE_OWNER:-wei-dongyu_1_0}"
GITEE_REPO="${GITEE_REPO:-OrdeRead}"
GITEE_RELEASE_NAME="${GITEE_RELEASE_NAME:-订单快读 ${GITEE_TAG}}"
GITEE_RELEASE_BODY="${GITEE_RELEASE_BODY:-Windows 安装包已自动分片发布，订单快读会自动下载、合并并校验；GitHub 作为备用下载源。}"
GITEE_API_BASE="${GITEE_API_BASE:-https://gitee.com/api/v5}"

if [[ ! "$GITEE_TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsupported Gitee release tag: $GITEE_TAG" >&2
  exit 2
fi

if (( $# > 0 )); then
  assets=("$@")
elif [[ -n "${GITEE_ASSET:-}" ]]; then
  assets=("$GITEE_ASSET")
else
  echo "Provide at least one Gitee release asset as an argument or GITEE_ASSET." >&2
  exit 2
fi

for asset in "${assets[@]}"; do
  if [[ ! -f "$asset" ]]; then
    echo "Gitee release asset does not exist: $asset" >&2
    exit 2
  fi
  asset_size=$(wc -c <"$asset" | tr -d '[:space:]')
  if (( asset_size >= 104857600 )); then
    echo "Gitee release asset is ${asset_size} bytes; it must be smaller than 100 MB: $asset" >&2
    exit 2
  fi
done

repo_api="${GITEE_API_BASE}/repos/${GITEE_OWNER}/${GITEE_REPO}"
auth_header="Authorization: token ${GITEE_TOKEN}"

existing_release=$(curl -sS --retry 3 --max-time 60 \
  -H "$auth_header" \
  "${repo_api}/releases/tags/${GITEE_TAG}")
existing_release_id=$(jq -r 'if (.id | type) == "number" then .id else empty end' <<<"$existing_release")

if [[ -n "$existing_release_id" ]]; then
  curl -fsS --retry 3 --max-time 60 \
    -X DELETE \
    -H "$auth_header" \
    "${repo_api}/releases/${existing_release_id}" >/dev/null
fi

release_payload=$(jq -n \
  --arg tag_name "$GITEE_TAG" \
  --arg target_commitish "$GITEE_TARGET" \
  --arg name "$GITEE_RELEASE_NAME" \
  --arg body "$GITEE_RELEASE_BODY" \
  '{tag_name: $tag_name, target_commitish: $target_commitish, name: $name, body: $body, prerelease: true}')

release=$(curl -fsS --retry 3 --max-time 60 \
  -X POST \
  -H "$auth_header" \
  -H 'Content-Type: application/json;charset=UTF-8' \
  --data-binary @- \
  "${repo_api}/releases" <<<"$release_payload")
release_id=$(jq -er '.id' <<<"$release")

upload_concurrency="${GITEE_UPLOAD_CONCURRENCY:-3}"
if [[ ! "$upload_concurrency" =~ ^[1-9][0-9]*$ ]] || (( upload_concurrency > 8 )); then
  echo "GITEE_UPLOAD_CONCURRENCY must be an integer between 1 and 8." >&2
  exit 2
fi

upload_dir=$(mktemp -d)
trap 'rm -rf "$upload_dir"' EXIT
upload_pids=()
upload_results=()

upload_asset() {
  local asset="$1"
  local result_file="$2"
  local response_file="${result_file}.response"

  curl -fsS --retry 3 --connect-timeout 60 --max-time 600 \
    -X POST \
    -H "$auth_header" \
    -F "file=@${asset}" \
    "${repo_api}/releases/${release_id}/attach_files" >"$response_file"

  jq -e --arg expected "$(basename "$asset")" \
    'select(.name == $expected and (.browser_download_url | type) == "string") | {id, name, size, browser_download_url}' \
    "$response_file" >"$result_file"
}

wait_for_upload_batch() {
  local failed=0
  local pid

  for pid in "${upload_pids[@]}"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  upload_pids=()
  (( failed == 0 ))
}

upload_index=0
for asset in "${assets[@]}"; do
  result_file="${upload_dir}/$(printf '%03d' "$upload_index").json"
  upload_results+=("$result_file")
  upload_asset "$asset" "$result_file" &
  upload_pids+=("$!")
  (( upload_index += 1 ))

  if (( ${#upload_pids[@]} >= upload_concurrency )); then
    wait_for_upload_batch
  fi
done
wait_for_upload_batch

for result_file in "${upload_results[@]}"; do
  cat "$result_file"
done

published_payload=$(jq -n \
  --arg tag_name "$GITEE_TAG" \
  --arg name "$GITEE_RELEASE_NAME" \
  --arg body "$GITEE_RELEASE_BODY" \
  '{tag_name: $tag_name, name: $name, body: $body, prerelease: false}')

curl -fsS --retry 3 --max-time 60 \
  -X PATCH \
  -H "$auth_header" \
  -H 'Content-Type: application/json;charset=UTF-8' \
  --data-binary @- \
  "${repo_api}/releases/${release_id}" <<<"$published_payload" >/dev/null
