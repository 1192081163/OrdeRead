import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { UpdateInfo } from "../../shared/types.js";
import { CURRENT_RELEASE_TAG } from "../buildInfo.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version?: string };

export const GITHUB_RELEASE_API_URL = "https://api.github.com/repos/1192081163/order-quick-read/releases/latest";
const USER_AGENT = `OrderQuickRead/${packageJson.version ?? "0.1.0"}`;

type ReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type ReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

export function selectReleaseAsset(
  assetNames: string[],
  platformName: string = process.platform,
  arch: string = process.arch,
): string {
  if (platformName === "win32") {
    return assetNames.find((name) => name.toLowerCase().endsWith(".exe")) ?? "";
  }

  if (platformName === "darwin" && arch === "arm64") {
    return assetNames.find((name) => /arm64|apple-silicon|apple_silicon/i.test(name) && /\.dmg$/i.test(name)) ?? "";
  }

  if (platformName === "darwin") {
    return assetNames.find((name) => /x64|x86_64|intel/i.test(name) && /\.dmg$/i.test(name)) ?? "";
  }

  return "";
}

export function updateInfoFromReleasePayload(
  payload: ReleasePayload,
  options: {
    currentReleaseTag?: string;
    currentVersion?: string;
    platformName?: NodeJS.Platform;
    arch?: string;
  } = {},
): UpdateInfo | null {
  const latestTag = stringValue(payload.tag_name).trim();
  const currentVersion = options.currentVersion ?? packageJson.version ?? "0.1.0";
  const currentReleaseTag = options.currentReleaseTag ?? CURRENT_RELEASE_TAG;
  if (!isNewerRelease(latestTag, currentReleaseTag, currentVersion)) {
    return null;
  }

  const releaseUrl = stringValue(payload.html_url).trim();
  const assets = Array.isArray(payload.assets) ? (payload.assets as ReleaseAsset[]) : [];
  const assetName = selectReleaseAsset(
    assets.map((asset) => stringValue(asset.name)),
    options.platformName ?? process.platform,
    options.arch ?? process.arch,
  );
  const asset = assets.find((candidate) => stringValue(candidate.name) === assetName);
  if (!asset) {
    return {
      tagName: latestTag,
      releaseUrl,
      assetName: "",
      assetUrl: "",
    };
  }

  return {
    tagName: latestTag,
    releaseUrl,
    assetName,
    assetUrl: stringValue(asset.browser_download_url),
  };
}

export async function checkForElectronUpdate(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(GITHUB_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ReleasePayload;
    return updateInfoFromReleasePayload(payload);
  } catch {
    return null;
  }
}

export async function downloadUpdateAsset(update: UpdateInfo, downloadDir: string): Promise<string> {
  if (!update.assetUrl || !update.assetName) {
    throw new Error("更新文件不存在，请打开 Release 页面手动下载。");
  }

  await mkdir(downloadDir, { recursive: true });
  const targetPath = await uniquePath(path.join(downloadDir, update.assetName));
  const response = await fetch(update.assetUrl, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error("更新文件下载失败。");
  }

  const tempPath = `${targetPath}.download`;
  try {
    await writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
  return targetPath;
}

async function uniquePath(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("下载目录中存在过多同名安装包。");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNewerRelease(latestTag: string, currentReleaseTag: string, currentVersion: string): boolean {
  if (!latestTag || currentReleaseTag === "dev") {
    return false;
  }

  if (latestTag === currentReleaseTag) {
    return false;
  }

  const latestBuild = parseBuildTag(latestTag);
  const currentBuild = parseBuildTag(currentReleaseTag);
  if (latestBuild !== null && currentBuild !== null) {
    return latestBuild > currentBuild;
  }

  const latestVersion = parseSemver(latestTag);
  const currentSemver = parseSemver(currentReleaseTag) ?? parseSemver(currentVersion);
  if (latestVersion !== null && currentSemver !== null) {
    return compareSemver(latestVersion, currentSemver) > 0;
  }

  return latestTag !== currentReleaseTag;
}

function parseBuildTag(tag: string): number | null {
  const match = tag.trim().match(/^build-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function parseSemver(tag: string): [number, number, number] | null {
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
