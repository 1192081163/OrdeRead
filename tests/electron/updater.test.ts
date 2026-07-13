import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countOrderChanges } from "../../electron/main/services/notifier";
import {
  downloadUpdateAsset,
  GITHUB_RELEASE_API_URL,
  githubReleaseApiUrlFromPackageJson,
  selectReleaseAsset,
  updateInfoFromReleasePayload,
} from "../../electron/main/services/updater";
import type { OrderRow } from "../../electron/shared/types";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "order-updater-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

function row(orderNumber: string, deadline: string): OrderRow {
  return {
    orderNumber,
    deadline,
    sourceFile: "",
    messageSubject: "",
    messageDate: "",
  };
}

describe("Electron updater", () => {
  it("uses the renamed repository", () => {
    expect(GITHUB_RELEASE_API_URL).toBe("https://api.github.com/repos/1192081163/order-quick-read/releases/latest");
  });

  it("derives release API URLs from package repository metadata", () => {
    expect(githubReleaseApiUrlFromPackageJson({ repository: { url: "git+https://github.com/acme/orders.git" } })).toBe(
      "https://api.github.com/repos/acme/orders/releases/latest",
    );
    expect(githubReleaseApiUrlFromPackageJson({ repository: "https://github.com/acme/orders" })).toBe(
      "https://api.github.com/repos/acme/orders/releases/latest",
    );
  });

  it("selects Windows installer asset", () => {
    expect(selectReleaseAsset(["OrderQuickReadSetup.exe", "OrderQuickRead-macos-arm64.dmg"], "win32", "x64")).toBe(
      "OrderQuickReadSetup.exe",
    );
    expect(selectReleaseAsset(["unexpected-installer.exe"], "win32", "x64")).toBe("");
  });

  it("selects Apple Silicon macOS dmg", () => {
    expect(selectReleaseAsset(["OrderQuickRead-macos-x64.dmg", "OrderQuickRead-macos-arm64.dmg"], "darwin", "arm64")).toBe(
      "OrderQuickRead-macos-arm64.dmg",
    );
  });

  it("selects Intel macOS dmg", () => {
    expect(selectReleaseAsset(["OrderQuickRead-macos-arm64.dmg", "OrderQuickRead-macos-x64.dmg"], "darwin", "x64")).toBe(
      "OrderQuickRead-macos-x64.dmg",
    );
  });

  it("returns update info for newer releases and selected assets", () => {
    const update = updateInfoFromReleasePayload(
      {
        tag_name: "v1.2.0",
        html_url: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
        assets: [
          { name: "OrderQuickRead-macos-arm64.dmg", browser_download_url: "https://example.com/mac.dmg" },
          { name: "OrderQuickReadSetup.exe", browser_download_url: "https://example.com/win.exe" },
        ],
      },
      { currentReleaseTag: "v1.1.0", currentVersion: "1.1.0", platformName: "win32", arch: "x64" },
    );

    expect(update).toEqual({
      tagName: "v1.2.0",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://example.com/win.exe",
    });
  });

  it("ignores same-version releases", () => {
    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "v1.1.0",
          html_url: "https://github.com/1192081163/order-quick-read/releases/tag/v1.1.0",
          assets: [{ name: "OrderQuickReadSetup.exe", browser_download_url: "https://example.com/win.exe" }],
        },
        { currentReleaseTag: "v1.1.0", currentVersion: "1.1.0", platformName: "win32", arch: "x64" },
      ),
    ).toBeNull();
  });

  it("ignores GitHub Actions build releases until the Electron build is stamped", () => {
    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "build-25",
          html_url: "https://github.com/1192081163/order-quick-read/releases/tag/build-25",
          assets: [{ name: "OrderQuickReadSetup.exe", browser_download_url: "https://example.com/win.exe" }],
        },
        { platformName: "win32", arch: "x64" },
      ),
    ).toBeNull();
  });

  it("compares stamped GitHub Actions build tags independently from package version", () => {
    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "build-25",
          html_url: "https://github.com/1192081163/order-quick-read/releases/tag/build-25",
          assets: [{ name: "OrderQuickReadSetup.exe", browser_download_url: "https://example.com/win.exe" }],
        },
        { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
      ),
    ).toBeNull();

    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "build-26",
          html_url: "https://github.com/1192081163/order-quick-read/releases/tag/build-26",
          assets: [{ name: "OrderQuickReadSetup.exe", browser_download_url: "https://example.com/win.exe" }],
        },
        { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
      ),
    ).toEqual({
      tagName: "build-26",
      releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/build-26",
      assetName: "OrderQuickReadSetup.exe",
      assetUrl: "https://example.com/win.exe",
    });
  });

  it("downloads update assets without overwriting existing installers", async () => {
    await writeFile(path.join(tempDir, "OrderQuickReadSetup.exe"), Buffer.from("existing"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: {},
        arrayBuffer: async () => Buffer.from("new-installer"),
      })),
    );

    const downloadedPath = await downloadUpdateAsset(
      {
        tagName: "v1.2.0",
        releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
        assetName: "OrderQuickReadSetup.exe",
        assetUrl: "https://github.com/1192081163/order-quick-read/releases/download/v1.2.0/OrderQuickReadSetup.exe",
      },
      tempDir,
    );

    expect(path.basename(downloadedPath)).toBe("OrderQuickReadSetup-1.exe");
    await expect(readFile(downloadedPath, "utf-8")).resolves.toBe("new-installer");
    await expect(readFile(path.join(tempDir, "OrderQuickReadSetup.exe"), "utf-8")).resolves.toBe("existing");
  });

  it("rejects update downloads outside the official GitHub repository", async () => {
    await expect(
      downloadUpdateAsset(
        {
          tagName: "v1.2.0",
          releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
          assetName: "OrderQuickReadSetup.exe",
          assetUrl: "https://download.example/OrderQuickReadSetup.exe",
        },
        tempDir,
      ),
    ).rejects.toThrow("非官方地址");
  });

  it("rejects update downloads with an unexpected installer name", async () => {
    await expect(
      downloadUpdateAsset(
        {
          tagName: "v1.2.0",
          releaseUrl: "https://github.com/1192081163/order-quick-read/releases/tag/v1.2.0",
          assetName: "other.exe",
          assetUrl: "https://github.com/1192081163/order-quick-read/releases/download/v1.2.0/other.exe",
        },
        tempDir,
      ),
    ).rejects.toThrow("文件名不正确");
  });
});

describe("order change notifications", () => {
  it("counts new and updated orders", () => {
    expect(countOrderChanges([row("PO-1", "2026-06-20"), row("PO-2", "2026-06-21")], [
      row("PO-1", "2026-06-25"),
      row("PO-2", "2026-06-21"),
      row("PO-3", "2026-06-22"),
    ])).toEqual({ newCount: 1, updatedCount: 1 });
  });
});
