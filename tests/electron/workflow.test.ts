import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/build.yml"), "utf-8");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as {
  repository?: { url?: string };
  build?: { compression?: string; electronLanguages?: string[]; files?: string[]; npmRebuild?: boolean };
};
const downloadPublisher = readFileSync(path.join(repoRoot, "scripts/publish-download-server.sh"), "utf-8");

describe("GitHub Actions packaging workflow", () => {
  it("builds only the Windows Electron installer for now", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("npm ci --no-audit --no-fund");
    expect(workflow).not.toMatch(/run: npm ci\s*$/m);
    expect(workflow).toContain("npm run electron:typecheck");
    expect(workflow).toContain("npm run electron:test");
    expect(workflow).toContain("npm run electron:build -- --win nsis --publish never");
    expect(workflow).toContain("if: github.event_name != 'pull_request'");
    expect(workflow).not.toContain("npm run electron:build -- --mac");
    expect(workflow).not.toContain("build-macos");
    expect(workflow).not.toContain("macos-latest");
    expect(workflow).not.toContain("macos-15-intel");
    expect(workflow).not.toContain("scripts/build_windows.ps1");
    expect(workflow).not.toContain("scripts/build_macos.sh");

    const cacheStep = workflow.indexOf("- name: Cache Electron builder downloads");
    const buildInstallStep = workflow.lastIndexOf("run: npm ci --no-audit --no-fund");
    expect(cacheStep).toBeGreaterThan(-1);
    expect(cacheStep).toBeLessThan(buildInstallStep);
  });

  it("publishes the direct Windows installer release asset", () => {
    expect(workflow).toContain("permissions:\n      contents: write");
    expect(workflow).toContain("dist-electron-packages/OrderQuickReadSetup.exe");
    expect(workflow).toContain("release-assets/OrderQuickReadSetup.exe#OrderQuickReadSetup.exe");
    expect(workflow).toContain("OrderQuickReadSetup.exe.sha256#OrderQuickReadSetup.exe.sha256");
    expect(workflow.match(/compression-level: 0/g)).toHaveLength(1);
    expect(workflow).not.toContain(".dmg");
  });

  it("publishes verified updates to the AUSMET download server", () => {
    expect(workflow).toContain("publish-download-server:");
    expect(workflow).toContain("DOWNLOAD_SSH_PRIVATE_KEY: ${{ secrets.DOWNLOAD_SSH_PRIVATE_KEY }}");
    expect(workflow).toContain("DOWNLOAD_SSH_KNOWN_HOSTS: ${{ secrets.DOWNLOAD_SSH_KNOWN_HOSTS }}");
    expect(workflow).toContain("DOWNLOAD_BASE_URL: https://download.ausmet.ai/orderead");
    expect(workflow).toContain("DOWNLOAD_REMOTE_ROOT: /srv/orderflow-download/public/orderead");
    expect(workflow).toContain("scripts/publish-download-server.sh");
    expect(workflow.toLowerCase()).not.toContain("gitee");

    expect(downloadPublisher).toContain("/srv/orderflow-download/public/orderead");
    expect(downloadPublisher).toContain("OrderQuickReadSetup.exe.sha256");
    expect(downloadPublisher).toContain("latest.json.tmp");
    expect(downloadPublisher).toContain("index.html.tmp");
  });

  it("uses the canonical repository and maximum installer compression", () => {
    expect(packageJson.repository?.url).toBe("git+https://github.com/1192081163/OrdeRead.git");
    expect(packageJson.build?.compression).toBe("maximum");
    expect(packageJson.build?.electronLanguages).toEqual(["en", "zh-CN"]);
    expect(packageJson.build?.npmRebuild).toBe(false);
    expect(packageJson.build?.files).toEqual(["dist-renderer/**/*", "dist-electron/**/*", "package.json"]);
  });
});
