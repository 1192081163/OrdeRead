import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const releaseTag = process.argv[2]?.trim();
if (!releaseTag) {
  console.error("Usage: node scripts/stamp_electron_build_info.mjs <release-tag>");
  process.exit(2);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildInfoPath = path.join(projectRoot, "electron", "main", "buildInfo.ts");

await writeFile(buildInfoPath, `export const CURRENT_RELEASE_TAG = ${JSON.stringify(releaseTag)};\n`, "utf-8");
