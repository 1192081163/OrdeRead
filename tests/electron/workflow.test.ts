import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/build.yml"), "utf-8");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as {
  repository?: { url?: string };
  build?: { compression?: string; electronLanguages?: string[] };
};
const giteePublisher = readFileSync(path.join(repoRoot, "scripts/publish-gitee-release.sh"), "utf-8");

describe("GitHub Actions packaging workflow", () => {
  it("builds only the Windows Electron installer for now", () => {
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run electron:typecheck");
    expect(workflow).toContain("npm run electron:test");
    expect(workflow).toContain("npm run electron:build -- --win nsis --publish never");
    expect(workflow).not.toContain("npm run electron:build -- --mac");
    expect(workflow).not.toContain("build-macos");
    expect(workflow).not.toContain("macos-latest");
    expect(workflow).not.toContain("macos-15-intel");
    expect(workflow).not.toContain("scripts/build_windows.ps1");
    expect(workflow).not.toContain("scripts/build_macos.sh");
  });

  it("publishes the direct Windows installer release asset", () => {
    expect(workflow).toContain("dist-electron-packages/OrderQuickReadSetup.exe");
    expect(workflow).toContain("release-assets/OrderQuickReadSetup.exe#OrderQuickReadSetup.exe");
    expect(workflow).toContain("OrderQuickReadSetup.exe.sha256#OrderQuickReadSetup.exe.sha256");
    expect(workflow).not.toContain(".dmg");
  });

  it("mirrors source and publishes verified 4 MiB Gitee update parts", () => {
    expect(workflow).toContain("publish-gitee-release:");
    expect(workflow).toContain("GITEE_TOKEN: ${{ secrets.GITEE_TOKEN }}");
    expect(workflow).toContain("wei-dongyu_1_0/OrdeRead");
    expect(workflow).toContain("git -c http.version=HTTP/1.1 push gitee HEAD:main --tags --force");
    expect(workflow).toContain("timeout 180s");
    expect(workflow).toContain("split --bytes=4M");
    expect(workflow).toContain("OrderQuickReadSetup.exe.sha256");
    expect(workflow).toContain("scripts/publish-gitee-release.sh");

    expect(giteePublisher).toContain("prerelease: true");
    expect(giteePublisher).toContain("prerelease: false");
    expect(giteePublisher).toContain("asset_size >= 104857600");
    expect(giteePublisher).toContain('GITEE_UPLOAD_CONCURRENCY:-3');
    expect(giteePublisher).toContain("upload_pids+set");
  });

  it("uses the canonical repository and maximum installer compression", () => {
    expect(packageJson.repository?.url).toBe("git+https://github.com/1192081163/OrdeRead.git");
    expect(packageJson.build?.compression).toBe("maximum");
    expect(packageJson.build?.electronLanguages).toEqual(["en", "zh-CN"]);
  });
});
