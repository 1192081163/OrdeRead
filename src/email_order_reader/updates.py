from __future__ import annotations

import json
import platform
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib import request

from email_order_reader import __version__
from email_order_reader.branding import REPOSITORY
from email_order_reader.build_info import CURRENT_RELEASE_TAG


GITHUB_RELEASE_API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
USER_AGENT = f"OrderQuickRead/{__version__}"


@dataclass(frozen=True)
class UpdateInfo:
    tag_name: str
    release_url: str
    asset_name: str
    asset_url: str


def check_for_update(
    current_release_tag: str = CURRENT_RELEASE_TAG,
    current_version: str = __version__,
    platform_name: str = sys.platform,
    machine_name: str | None = None,
    timeout: int = 5,
) -> UpdateInfo | None:
    try:
        payload = fetch_latest_release_payload(timeout=timeout)
    except Exception:
        return None

    return update_info_from_release_payload(
        payload,
        current_release_tag=current_release_tag,
        current_version=current_version,
        platform_name=platform_name,
        machine_name=machine_name,
    )


def fetch_latest_release_payload(timeout: int = 5) -> dict:
    http_request = request.Request(
        GITHUB_RELEASE_API_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        },
    )
    with request.urlopen(http_request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def update_info_from_release_payload(
    payload: dict,
    current_release_tag: str,
    current_version: str,
    platform_name: str = sys.platform,
    machine_name: str | None = None,
) -> UpdateInfo | None:
    latest_tag = str(payload.get("tag_name") or "").strip()
    if not _is_newer_release(latest_tag, current_release_tag, current_version):
        return None

    release_url = str(payload.get("html_url") or "").strip()
    asset = _select_platform_asset(payload.get("assets") or [], platform_name, machine_name)
    if not asset:
        return UpdateInfo(
            tag_name=latest_tag,
            release_url=release_url,
            asset_name="",
            asset_url="",
        )

    return UpdateInfo(
        tag_name=latest_tag,
        release_url=release_url,
        asset_name=str(asset.get("name") or ""),
        asset_url=str(asset.get("browser_download_url") or ""),
    )


def download_update_asset(update_info: UpdateInfo, download_dir: Path | None = None, timeout: int = 60) -> Path:
    if not update_info.asset_url or not update_info.asset_name:
        raise ValueError("update asset is missing")

    target_dir = download_dir or default_download_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = _unique_path(target_dir / update_info.asset_name)
    temp_path: Path | None = None

    http_request = request.Request(
        update_info.asset_url,
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with request.urlopen(http_request, timeout=timeout) as response:
            with tempfile.NamedTemporaryFile(delete=False, dir=target_dir, suffix=".download") as temp_file:
                shutil.copyfileobj(response, temp_file)
                temp_path = Path(temp_file.name)
        temp_path.replace(target_path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()

    return target_path


def default_download_dir() -> Path:
    downloads_dir = Path.home() / "Downloads"
    if downloads_dir.exists():
        return downloads_dir
    return Path.home()


def _select_platform_asset(assets: list[dict], platform_name: str, machine_name: str | None = None) -> dict | None:
    suffix = _asset_suffix_for_platform(platform_name)
    if not suffix:
        return None

    if platform_name == "darwin":
        preferred_asset = _select_macos_arch_asset(assets, machine_name or platform.machine())
        if preferred_asset is not None:
            return preferred_asset

    for asset in assets:
        name = str(asset.get("name") or "").lower()
        if name.endswith(suffix):
            return asset
    return None


def _select_macos_arch_asset(assets: list[dict], machine_name: str) -> dict | None:
    machine = machine_name.lower()
    if machine in {"arm64", "aarch64"}:
        preferred_tokens = ("arm64", "apple-silicon", "apple_silicon")
    elif machine in {"x86_64", "amd64", "i386", "i686"}:
        preferred_tokens = ("x64", "x86_64", "intel")
    else:
        return None

    for asset in assets:
        name = str(asset.get("name") or "").lower()
        if name.endswith(".dmg") and any(token in name for token in preferred_tokens):
            return asset
    return None


def _asset_suffix_for_platform(platform_name: str) -> str:
    if platform_name.startswith("win"):
        return ".exe"
    if platform_name == "darwin":
        return ".dmg"
    return ""


def _is_newer_release(latest_tag: str, current_release_tag: str, current_version: str) -> bool:
    if not latest_tag or current_release_tag == "dev":
        return False

    if latest_tag == current_release_tag:
        return False

    latest_build = _parse_build_tag(latest_tag)
    current_build = _parse_build_tag(current_release_tag)
    if latest_build is not None and current_build is not None:
        return latest_build > current_build

    latest_version = _parse_semver(latest_tag)
    current_semver = _parse_semver(current_release_tag) or _parse_semver(current_version)
    if latest_version is not None and current_semver is not None:
        return latest_version > current_semver

    return latest_tag != current_release_tag


def _parse_build_tag(tag: str) -> int | None:
    match = re.fullmatch(r"build-(\d+)", tag.strip())
    if not match:
        return None
    return int(match.group(1))


def _parse_semver(tag: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", tag.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    for index in range(1, 100):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(f"too many existing downloads for {path.name}")
