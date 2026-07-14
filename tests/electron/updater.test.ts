import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countOrderChanges } from "../../electron/main/services/notifier";
import {
  checkForElectronUpdate,
  downloadUpdateAsset,
  GITEE_RELEASE_API_URL,
  GITHUB_RELEASE_API_URL,
  githubReleaseApiUrlFromPackageJson,
  RELEASE_API_URLS,
  selectReleaseAsset,
  updateInfoFromReleasePayload,
  WINDOWS_ASSET_NAME,
  WINDOWS_CHECKSUM_ASSET_NAME,
  WINDOWS_PART_ASSET_PREFIX,
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
  it("uses Gitee first and the canonical GitHub repository as fallback", () => {
    expect(GITEE_RELEASE_API_URL).toBe("https://gitee.com/api/v5/repos/wei-dongyu_1_0/OrdeRead/releases/latest");
    expect(GITHUB_RELEASE_API_URL).toBe("https://api.github.com/repos/1192081163/OrdeRead/releases/latest");
    expect(RELEASE_API_URLS).toEqual([GITEE_RELEASE_API_URL, GITHUB_RELEASE_API_URL]);
  });

  it("bounds both update sources so blocked networks do not hang the app", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkForElectronUpdate()).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([...RELEASE_API_URLS]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    }
  });

  it("checks Gitee before GitHub", async () => {
    const urls: string[] = [];
    const result = await checkForElectronUpdate(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ tag_name: "v0.1.0", assets: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(result).toBeNull();
    expect(urls).toEqual([GITEE_RELEASE_API_URL]);
  });

  it("falls back to GitHub when Gitee is unavailable", async () => {
    const urls: string[] = [];
    const result = await checkForElectronUpdate(async (url) => {
      urls.push(String(url));
      if (String(url) === GITEE_RELEASE_API_URL) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ tag_name: "v0.1.0", assets: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(result).toBeNull();
    expect(urls).toEqual([GITEE_RELEASE_API_URL, GITHUB_RELEASE_API_URL]);
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
    expect(selectReleaseAsset([WINDOWS_ASSET_NAME, "OrderQuickRead-macos-arm64.dmg"], "win32", "x64")).toBe(
      WINDOWS_ASSET_NAME,
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

  it("returns update info for newer releases and prefers the complete installer", () => {
    const update = updateInfoFromReleasePayload(
      {
        tag_name: "build-26",
        html_url: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/build-26",
        assets: [
          {
            name: `${WINDOWS_PART_ASSET_PREFIX}00`,
            browser_download_url: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/part-00",
          },
          {
            name: WINDOWS_CHECKSUM_ASSET_NAME,
            browser_download_url: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_CHECKSUM_ASSET_NAME}`,
          },
          {
            name: WINDOWS_ASSET_NAME,
            browser_download_url: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_ASSET_NAME}`,
          },
        ],
      },
      { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
    );

    expect(update).toEqual({
      tagName: "build-26",
      releaseUrl: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/build-26",
      assetName: WINDOWS_ASSET_NAME,
      assetUrl: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_ASSET_NAME}`,
      checksumUrl: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_CHECKSUM_ASSET_NAME}`,
    });
  });

  it("uses complete ordered parts and checksum when Gitee has no complete installer", () => {
    const baseUrl = "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26";
    const update = updateInfoFromReleasePayload(
      {
        tag_name: "build-26",
        assets: [
          { name: `${WINDOWS_PART_ASSET_PREFIX}01`, browser_download_url: `${baseUrl}/${WINDOWS_PART_ASSET_PREFIX}01` },
          { name: WINDOWS_CHECKSUM_ASSET_NAME, browser_download_url: `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}` },
          { name: `${WINDOWS_PART_ASSET_PREFIX}00`, browser_download_url: `${baseUrl}/${WINDOWS_PART_ASSET_PREFIX}00` },
        ],
      },
      { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
    );

    expect(update).toMatchObject({
      tagName: "build-26",
      assetName: WINDOWS_ASSET_NAME,
      assetUrl: "",
      checksumUrl: `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`,
      assetParts: [
        { assetName: `${WINDOWS_PART_ASSET_PREFIX}00` },
        { assetName: `${WINDOWS_PART_ASSET_PREFIX}01` },
      ],
    });
  });

  it("does not use incomplete multipart releases", () => {
    const update = updateInfoFromReleasePayload(
      {
        tag_name: "build-26",
        assets: [
          {
            name: `${WINDOWS_PART_ASSET_PREFIX}01`,
            browser_download_url: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_PART_ASSET_PREFIX}01`,
          },
          {
            name: WINDOWS_CHECKSUM_ASSET_NAME,
            browser_download_url: `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-26/${WINDOWS_CHECKSUM_ASSET_NAME}`,
          },
        ],
      },
      { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
    );

    expect(update).toMatchObject({ assetName: "", assetUrl: "" });
  });

  it("ignores same-version releases", () => {
    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "v1.1.0",
          html_url: "https://github.com/1192081163/OrdeRead/releases/tag/v1.1.0",
          assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://example.com/win.exe" }],
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
          html_url: "https://github.com/1192081163/OrdeRead/releases/tag/build-25",
          assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://example.com/win.exe" }],
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
          assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://example.com/win.exe" }],
        },
        { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
      ),
    ).toBeNull();

    expect(
      updateInfoFromReleasePayload(
        {
          tag_name: "build-26",
          assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://example.com/win.exe" }],
        },
        { currentReleaseTag: "build-25", currentVersion: "0.1.0", platformName: "win32", arch: "x64" },
      ),
    ).toMatchObject({ tagName: "build-26", assetName: WINDOWS_ASSET_NAME });
  });

  it("downloads update assets without overwriting existing installers", async () => {
    await writeFile(path.join(tempDir, WINDOWS_ASSET_NAME), Buffer.from("existing"));

    const downloadedPath = await downloadUpdateAsset(
      {
        tagName: "build-44",
        releaseUrl: "https://github.com/1192081163/OrdeRead/releases/tag/build-44",
        assetName: WINDOWS_ASSET_NAME,
        assetUrl: `https://github.com/1192081163/OrdeRead/releases/download/build-44/${WINDOWS_ASSET_NAME}`,
      },
      tempDir,
      async () => new Response(Buffer.from("new-installer")),
    );

    expect(path.basename(downloadedPath)).toBe("OrderQuickReadSetup-1.exe");
    await expect(readFile(downloadedPath, "utf-8")).resolves.toBe("new-installer");
    await expect(readFile(path.join(tempDir, WINDOWS_ASSET_NAME), "utf-8")).resolves.toBe("existing");
  });

  it("downloads and verifies a complete installer from the official Gitee repository", async () => {
    const content = Buffer.from("gitee-installer");
    const checksum = createHash("sha256").update(content).digest("hex");
    const baseUrl = "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-44";
    const assetUrl = `${baseUrl}/${WINDOWS_ASSET_NAME}`;
    const checksumUrl = `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`;

    const downloadedPath = await downloadUpdateAsset(
      {
        tagName: "build-44",
        releaseUrl: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/build-44",
        assetName: WINDOWS_ASSET_NAME,
        assetUrl,
        checksumUrl,
      },
      tempDir,
      async (url) =>
        new Response(String(url) === checksumUrl ? `${checksum}  ${WINDOWS_ASSET_NAME}\n` : content),
    );

    await expect(readFile(downloadedPath, "utf-8")).resolves.toBe("gitee-installer");
  });

  it("downloads, joins, and verifies multipart Gitee updates", async () => {
    const partContents = [Buffer.from("gitee "), Buffer.from("installer")];
    const checksum = createHash("sha256").update(Buffer.concat(partContents)).digest("hex");
    const baseUrl = "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-44";
    const checksumUrl = `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`;
    const assetParts = partContents.map((_content, index) => ({
      assetName: `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
      assetUrl: `${baseUrl}/${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
    }));

    const downloadedPath = await downloadUpdateAsset(
      {
        tagName: "build-44",
        releaseUrl: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/build-44",
        assetName: WINDOWS_ASSET_NAME,
        assetUrl: "",
        assetParts,
        checksumUrl,
      },
      tempDir,
      async (url) => {
        if (String(url) === checksumUrl) {
          return new Response(`${checksum}  ${WINDOWS_ASSET_NAME}\n`);
        }
        const index = assetParts.findIndex((part) => part.assetUrl === String(url));
        return new Response(partContents[index]);
      },
    );

    await expect(readFile(downloadedPath, "utf-8")).resolves.toBe("gitee installer");
    await expect(access(`${downloadedPath}.download`)).rejects.toBeTruthy();
  });

  it("rejects multipart updates when the checksum does not match", async () => {
    const baseUrl = "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/download/build-44";
    const checksumUrl = `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`;
    const assetParts = [0, 1].map((index) => ({
      assetName: `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
      assetUrl: `${baseUrl}/${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
    }));

    await expect(
      downloadUpdateAsset(
        {
          tagName: "build-44",
          releaseUrl: "https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/build-44",
          assetName: WINDOWS_ASSET_NAME,
          assetUrl: "",
          assetParts,
          checksumUrl,
        },
        tempDir,
        async (url) =>
          new Response(String(url) === checksumUrl ? `${"0".repeat(64)}  ${WINDOWS_ASSET_NAME}\n` : "content"),
      ),
    ).rejects.toThrow("校验失败");
  });

  it("rejects update downloads outside the official repositories", async () => {
    await expect(
      downloadUpdateAsset(
        {
          tagName: "v1.2.0",
          releaseUrl: "https://github.com/1192081163/OrdeRead/releases/tag/v1.2.0",
          assetName: WINDOWS_ASSET_NAME,
          assetUrl: `https://download.example/${WINDOWS_ASSET_NAME}`,
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
          releaseUrl: "https://github.com/1192081163/OrdeRead/releases/tag/v1.2.0",
          assetName: "other.exe",
          assetUrl: "https://github.com/1192081163/OrdeRead/releases/download/v1.2.0/other.exe",
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
