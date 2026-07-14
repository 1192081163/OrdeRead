import { createHash } from "node:crypto";
import { access, appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { UpdateInfo } from "../../shared/types.js";
import { CURRENT_RELEASE_TAG } from "../buildInfo.js";

const require = createRequire(import.meta.url);
type PackageMetadata = {
  version?: string;
  repository?: string | { url?: string };
};

type GitHubRepository = {
  owner: string;
  name: string;
};

type ReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type ReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

const packageJson = require("../../../package.json") as PackageMetadata;
const OFFICIAL_GITHUB_REPOSITORY = githubRepositoryFromPackageJson(packageJson);

export const GITEE_RELEASE_API_URL = "https://gitee.com/api/v5/repos/wei-dongyu_1_0/OrdeRead/releases/latest";
export const GITHUB_RELEASE_API_URL = githubReleaseApiUrlFromPackageJson(packageJson);
export const RELEASE_API_URLS = [GITEE_RELEASE_API_URL, GITHUB_RELEASE_API_URL] as const;
export const WINDOWS_ASSET_NAME = "OrderQuickReadSetup.exe";
export const WINDOWS_CHECKSUM_ASSET_NAME = `${WINDOWS_ASSET_NAME}.sha256`;
export const WINDOWS_PART_ASSET_PREFIX = `${WINDOWS_ASSET_NAME}.part-`;

const MACOS_ARM64_ASSET_NAME = "OrderQuickRead-macos-arm64.dmg";
const MACOS_X64_ASSET_NAME = "OrderQuickRead-macos-x64.dmg";
const SUPPORTED_ASSET_NAMES = new Set([
  WINDOWS_ASSET_NAME,
  MACOS_ARM64_ASSET_NAME,
  MACOS_X64_ASSET_NAME,
]);
const USER_AGENT = `OrderQuickRead/${packageJson.version ?? "0.1.0"}`;
const UPDATE_CHECK_TIMEOUT_MS = 5_000;
const RELEASE_SOURCES = [
  {
    name: "Gitee",
    apiUrl: GITEE_RELEASE_API_URL,
    accept: "application/json",
    releaseUrl: (tag: string) =>
      `https://gitee.com/wei-dongyu_1_0/OrdeRead/releases/tag/${encodeURIComponent(tag)}`,
  },
  {
    name: "GitHub",
    apiUrl: GITHUB_RELEASE_API_URL,
    accept: "application/vnd.github+json",
    releaseUrl: (tag: string) =>
      `https://github.com/${OFFICIAL_GITHUB_REPOSITORY.owner}/${OFFICIAL_GITHUB_REPOSITORY.name}/releases/tag/${encodeURIComponent(tag)}`,
  },
] as const;

export function githubReleaseApiUrlFromPackageJson(metadata: PackageMetadata): string {
  const repository = githubRepositoryFromPackageJson(metadata);
  return `https://api.github.com/repos/${repository.owner}/${repository.name}/releases/latest`;
}

function githubRepositoryFromPackageJson(metadata: PackageMetadata): GitHubRepository {
  const repository =
    typeof metadata.repository === "string" ? metadata.repository : stringValue(metadata.repository?.url).trim();
  const match = repository.match(/github\.com[:/]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[#?].*)?$/i);
  if (!match) {
    throw new Error("package.json repository must point to a GitHub repository for update checks.");
  }
  return { owner: match[1], name: match[2] };
}

export function selectReleaseAsset(
  assetNames: string[],
  platformName: string = process.platform,
  arch: string = process.arch,
): string {
  const expectedName = expectedAssetName(platformName, arch);
  return expectedName && assetNames.includes(expectedName) ? expectedName : "";
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

  const platformName = options.platformName ?? process.platform;
  const arch = options.arch ?? process.arch;
  const releaseUrl = stringValue(payload.html_url).trim();
  const assets = Array.isArray(payload.assets) ? (payload.assets as ReleaseAsset[]) : [];
  const expectedName = expectedAssetName(platformName, arch);
  const assetName = selectReleaseAsset(
    assets.map((asset) => stringValue(asset.name)),
    platformName,
    arch,
  );
  const asset = assets.find(
    (candidate) =>
      stringValue(candidate.name) === assetName && Boolean(stringValue(candidate.browser_download_url).trim()),
  );
  const checksum = expectedName
    ? assets.find(
        (candidate) =>
          stringValue(candidate.name) === `${expectedName}.sha256` &&
          Boolean(stringValue(candidate.browser_download_url).trim()),
      )
    : undefined;

  if (asset) {
    return {
      tagName: latestTag,
      releaseUrl,
      assetName,
      assetUrl: stringValue(asset.browser_download_url).trim(),
      ...(checksum ? { checksumUrl: stringValue(checksum.browser_download_url).trim() } : {}),
    };
  }

  const multipart = expectedName === WINDOWS_ASSET_NAME ? selectWindowsMultipart(assets) : null;
  if (multipart) {
    return {
      tagName: latestTag,
      releaseUrl,
      assetName: WINDOWS_ASSET_NAME,
      assetUrl: "",
      assetParts: multipart.parts.map((part) => ({
        assetName: stringValue(part.name),
        assetUrl: stringValue(part.browser_download_url).trim(),
      })),
      checksumUrl: stringValue(multipart.checksum.browser_download_url).trim(),
    };
  }

  return {
    tagName: latestTag,
    releaseUrl,
    assetName: "",
    assetUrl: "",
  };
}

export async function checkForElectronUpdate(fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  for (const source of RELEASE_SOURCES) {
    try {
      const response = await fetchImpl(source.apiUrl, {
        headers: {
          Accept: source.accept,
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as ReleasePayload;
      const latestTag = stringValue(payload.tag_name).trim();
      if (!latestTag) {
        continue;
      }
      const update = updateInfoFromReleasePayload({
        ...payload,
        html_url: payload.html_url || source.releaseUrl(latestTag),
      });
      if (update && hasDownloadableAsset(update)) {
        return update;
      }
      if (!update && releaseIsCurrent(latestTag)) {
        return null;
      }
    } catch {
      // Try the next official source when this one is blocked or unavailable.
    }
  }
  return null;
}

export async function downloadUpdateAsset(
  update: UpdateInfo,
  downloadDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!update.assetName || !hasDownloadableAsset(update)) {
    throw new Error("更新文件不存在，请打开 Release 页面手动下载。");
  }
  if (!SUPPORTED_ASSET_NAMES.has(update.assetName)) {
    throw new Error("更新文件名不正确，已拒绝下载。");
  }

  await mkdir(downloadDir, { recursive: true });
  const targetPath = await uniquePath(path.join(downloadDir, update.assetName));
  const tempPath = `${targetPath}.download`;

  try {
    const expectedChecksum = update.checksumUrl
      ? await downloadExpectedChecksum(update.checksumUrl, update.assetName, fetchImpl)
      : null;
    const hash = createHash("sha256");

    if (update.assetUrl) {
      assertOfficialDownloadUrl(update.assetUrl, update.assetName);
      const content = await fetchUpdateBuffer(update.assetUrl, fetchImpl);
      hash.update(content);
      await writeFile(tempPath, content);
    } else {
      await downloadMultipartAsset(update, tempPath, hash, fetchImpl);
    }

    if (expectedChecksum && hash.digest("hex") !== expectedChecksum) {
      throw new Error("更新文件校验失败，已拒绝打开。");
    }
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
  return targetPath;
}

function expectedAssetName(platformName: string, arch: string): string {
  if (platformName === "win32") {
    return WINDOWS_ASSET_NAME;
  }
  if (platformName === "darwin" && arch === "arm64") {
    return MACOS_ARM64_ASSET_NAME;
  }
  if (platformName === "darwin") {
    return MACOS_X64_ASSET_NAME;
  }
  return "";
}

function selectWindowsMultipart(assets: ReleaseAsset[]): { parts: ReleaseAsset[]; checksum: ReleaseAsset } | null {
  const parts = assets
    .filter((asset) => stringValue(asset.name).startsWith(WINDOWS_PART_ASSET_PREFIX))
    .sort((left, right) => stringValue(left.name).localeCompare(stringValue(right.name)));
  const checksum = assets.find(
    (asset) =>
      stringValue(asset.name) === WINDOWS_CHECKSUM_ASSET_NAME &&
      Boolean(stringValue(asset.browser_download_url).trim()),
  );
  const partsAreComplete =
    parts.length >= 2 &&
    parts.every(
      (part, index) =>
        stringValue(part.name) === `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}` &&
        Boolean(stringValue(part.browser_download_url).trim()),
    );
  return checksum && partsAreComplete ? { parts, checksum } : null;
}

function hasDownloadableAsset(update: UpdateInfo): boolean {
  return Boolean(update.assetUrl || (update.assetParts?.length && update.checksumUrl));
}

function releaseIsCurrent(latestTag: string): boolean {
  const currentReleaseTag = String(CURRENT_RELEASE_TAG);
  if (currentReleaseTag === "dev" || latestTag === currentReleaseTag) {
    return true;
  }
  const latestVersion = parseSemver(latestTag);
  const currentVersion = parseSemver(packageJson.version ?? "0.1.0");
  return latestVersion !== null && currentVersion !== null && compareSemver(latestVersion, currentVersion) === 0;
}

async function downloadExpectedChecksum(
  checksumUrl: string,
  assetName: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  assertOfficialDownloadUrl(checksumUrl, `${assetName}.sha256`);
  const payload = await fetchUpdateBuffer(checksumUrl, fetchImpl);
  const checksum = payload.toString("utf8").trim().match(/^([a-f0-9]{64})(?:\s|$)/i)?.[1]?.toLowerCase();
  if (!checksum) {
    throw new Error("更新校验文件无效，已拒绝下载。");
  }
  return checksum;
}

async function downloadMultipartAsset(
  update: UpdateInfo,
  tempPath: string,
  hash: ReturnType<typeof createHash>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const parts = update.assetParts ?? [];
  if (!update.checksumUrl || parts.length < 2) {
    throw new Error("更新分片不完整，请打开 Release 页面手动下载。");
  }
  const partsAreComplete = parts.every(
    (part, index) => part.assetName === `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
  );
  if (!partsAreComplete) {
    throw new Error("更新分片顺序不正确，已拒绝下载。");
  }

  for (const [index, part] of parts.entries()) {
    assertOfficialDownloadUrl(part.assetUrl, part.assetName);
    const content = await fetchUpdateBuffer(part.assetUrl, fetchImpl);
    hash.update(content);
    if (index === 0) {
      await writeFile(tempPath, content);
    } else {
      await appendFile(tempPath, content);
    }
  }
}

async function fetchUpdateBuffer(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`更新文件下载失败：HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function assertOfficialDownloadUrl(value: string, expectedFilename: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("更新下载地址无效，已拒绝下载。");
  }
  if (url.protocol !== "https:") {
    throw new Error("更新文件来自非官方地址，已拒绝下载。");
  }

  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("更新下载地址无效，已拒绝下载。");
  }

  const [owner, repository, releases, download] = segments;
  const filename = segments.at(-1) ?? "";
  const isReleaseDownload = releases === "releases" && download === "download" && segments.length === 6;
  const isOfficialGitHub =
    url.hostname.toLowerCase() === "github.com" &&
    owner?.toLowerCase() === OFFICIAL_GITHUB_REPOSITORY.owner.toLowerCase() &&
    [OFFICIAL_GITHUB_REPOSITORY.name.toLowerCase(), "order-quick-read", "orderead"].includes(
      repository?.toLowerCase() ?? "",
    ) &&
    isReleaseDownload &&
    filename === expectedFilename;
  const isOfficialGiteeRelease =
    url.hostname.toLowerCase() === "gitee.com" &&
    owner?.toLowerCase() === "wei-dongyu_1_0" &&
    repository?.toLowerCase() === "orderead" &&
    isReleaseDownload &&
    filename === expectedFilename;
  const isOfficialGiteeApi =
    url.hostname.toLowerCase() === "gitee.com" &&
    /^\/api\/v5\/repos\/wei-dongyu_1_0\/OrdeRead\/releases\/\d+\/attach_files\/\d+\/download$/i.test(
      url.pathname,
    );
  if (!isOfficialGitHub && !isOfficialGiteeRelease && !isOfficialGiteeApi) {
    throw new Error("更新文件来自非官方地址，已拒绝下载。");
  }
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
