from email_order_reader.updates import GITHUB_RELEASE_API_URL, update_info_from_release_payload


def test_update_checker_uses_renamed_repository():
    assert GITHUB_RELEASE_API_URL == "https://api.github.com/repos/1192081163/order-quick-read/releases/latest"


def test_update_info_selects_windows_asset_for_newer_build():
    payload = {
        "tag_name": "build-15",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/build-15",
        "assets": [
            {
                "name": "OrderQuickRead.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead.dmg",
            },
            {
                "name": "OrderQuickRead.exe",
                "browser_download_url": "https://example.com/OrderQuickRead.exe",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="build-14",
        current_version="0.1.0",
        platform_name="win32",
    )

    assert update is not None
    assert update.tag_name == "build-15"
    assert update.asset_name == "OrderQuickRead.exe"
    assert update.asset_url == "https://example.com/OrderQuickRead.exe"


def test_update_info_selects_macos_asset_for_newer_semver_release():
    payload = {
        "tag_name": "v1.2.0",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
        "assets": [
            {
                "name": "OrderQuickRead.exe",
                "browser_download_url": "https://example.com/OrderQuickRead.exe",
            },
            {
                "name": "OrderQuickRead.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead.dmg",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="v1.1.0",
        current_version="1.1.0",
        platform_name="darwin",
    )

    assert update is not None
    assert update.tag_name == "v1.2.0"
    assert update.asset_name == "OrderQuickRead.dmg"


def test_update_info_selects_macos_arm64_asset_for_apple_silicon():
    payload = {
        "tag_name": "build-20",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/build-20",
        "assets": [
            {
                "name": "OrderQuickRead-macos-x64.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead-macos-x64.dmg",
            },
            {
                "name": "OrderQuickRead-macos-arm64.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead-macos-arm64.dmg",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="build-19",
        current_version="0.1.0",
        platform_name="darwin",
        machine_name="arm64",
    )

    assert update is not None
    assert update.asset_name == "OrderQuickRead-macos-arm64.dmg"


def test_update_info_selects_macos_x64_asset_for_intel_mac():
    payload = {
        "tag_name": "build-20",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/build-20",
        "assets": [
            {
                "name": "OrderQuickRead-macos-arm64.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead-macos-arm64.dmg",
            },
            {
                "name": "OrderQuickRead-macos-x64.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead-macos-x64.dmg",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="build-19",
        current_version="0.1.0",
        platform_name="darwin",
        machine_name="x86_64",
    )

    assert update is not None
    assert update.asset_name == "OrderQuickRead-macos-x64.dmg"


def test_update_info_ignores_same_build_release():
    payload = {
        "tag_name": "build-15",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/build-15",
        "assets": [
            {
                "name": "OrderQuickRead.exe",
                "browser_download_url": "https://example.com/OrderQuickRead.exe",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="build-15",
        current_version="0.1.0",
        platform_name="win32",
    )

    assert update is None


def test_update_info_uses_release_page_when_platform_asset_is_missing():
    payload = {
        "tag_name": "build-16",
        "html_url": "https://github.com/1192081163/order-quick-read/releases/tag/build-16",
        "assets": [
            {
                "name": "OrderQuickRead.dmg",
                "browser_download_url": "https://example.com/OrderQuickRead.dmg",
            },
        ],
    }

    update = update_info_from_release_payload(
        payload,
        current_release_tag="build-15",
        current_version="0.1.0",
        platform_name="win32",
    )

    assert update is not None
    assert update.asset_name == ""
    assert update.asset_url == ""
    assert update.release_url.endswith("/build-16")
