import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Electron tooling", () => {
  it("defines Electron development test commands", () => {
    expect(packageJson.scripts).toMatchObject({
      "electron:build:main": "tsc -p tsconfig.electron.json",
      "electron:dev":
        'npm run electron:build:main && concurrently -k "vite --host 127.0.0.1" "wait-on http://127.0.0.1:5173 && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron dist-electron/main/app.js"',
      "electron:test": "vitest run",
      "electron:build": "npm run electron:clean && npm run electron:build:app && electron-builder",
      "electron:typecheck": "tsc --noEmit",
    });
  });

  it("separates fast packaging from release packaging", () => {
    expect(packageJson.scripts).toMatchObject({
      "electron:clean": "node scripts/clean_electron_outputs.mjs",
      "electron:build:app": "vite build && npm run electron:build:main",
      "electron:pack": "npm run electron:clean && npm run electron:build:app && electron-builder --dir --publish never",
      "electron:dist": "npm run electron:clean && npm run electron:build:app && electron-builder --publish never",
      "electron:build": "npm run electron:clean && npm run electron:build:app && electron-builder",
    });
  });

  it("keeps renderer-only packages out of production dependencies", () => {
    expect(packageJson.dependencies).toMatchObject({
      "@e965/xlsx": expect.any(String),
      imapflow: expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty("xlsx");
    expect(packageJson.dependencies).not.toHaveProperty("react");
    expect(packageJson.dependencies).not.toHaveProperty("react-dom");
    expect(packageJson.dependencies).not.toHaveProperty("@fluentui/react-components");
    expect(packageJson.dependencies).not.toHaveProperty("@fluentui/react-datepicker-compat");
    expect(packageJson.devDependencies).toMatchObject({
      react: expect.any(String),
      "react-dom": expect.any(String),
      "@fluentui/react-components": expect.any(String),
      "@fluentui/react-datepicker-compat": expect.any(String),
    });
  });

  it("limits the packaged payload to compiled runtime files", () => {
    expect(packageJson.build.npmRebuild).toBe(false);
    expect(packageJson.build.files).toEqual(["dist-renderer/**/*", "dist-electron/**/*", "package.json"]);
    expect(packageJson.build.files).not.toContain("assets/**/*");
  });

  it("declares open source project metadata", () => {
    expect((packageJson as { private?: unknown }).private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository).toMatchObject({
      type: "git",
      url: "git+https://github.com/1192081163/OrdeRead.git",
    });
    expect(packageJson.bugs).toMatchObject({
      url: "https://github.com/1192081163/OrdeRead/issues",
    });
    expect(packageJson.homepage).toBe("https://github.com/1192081163/OrdeRead#readme");

    for (const requiredPath of ["LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]) {
      expect(existsSync(path.join(repoRoot, requiredPath))).toBe(true);
    }
  });

  it("documents open source security and CI expectations", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf-8");
    expect(readme).toContain("## 开源许可");
    expect(readme).toContain("## 安全说明");
    expect(readme).toContain("npm run electron:pack");
    expect(readme).toContain("GitHub Actions");
    expect(readme).not.toContain("CircleCI");
  });

  it("uses GitHub Actions as the only CI release workflow", () => {
    expect(existsSync(path.join(repoRoot, ".github", "workflows", "build.yml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, ".circleci", "config.yml"))).toBe(false);
  });

  it("keeps electron-builder packaging separate from release publishing", () => {
    expect((packageJson.build as { publish?: unknown }).publish).toBeUndefined();
    expect(packageJson.scripts["electron:pack"]).toContain("--publish never");
    expect(packageJson.scripts["electron:dist"]).toContain("--publish never");
  });

  it("keeps Electron source compiled entry paths aligned", () => {
    expect(packageJson.main).toBe("dist-electron/main/app.js");
    expect(packageJson.scripts["electron:dev"]).toContain("electron dist-electron/main/app.js");
    expect(packageJson.build.files).toContain("dist-electron/**/*");
  });

  it("declares app identity used by packaging", () => {
    expect(packageJson.name).toBe("order-quick-read");
    expect(packageJson.build.productName).toBe("Order Quick Read");
    expect(packageJson.build.appId).toBe("com.orderquickread.desktop");
    expect(packageJson.build.win.icon).toBe("assets/app_icon.ico");
    expect(packageJson.build.mac.icon).toBe("assets/app_icon.icns");
  });

  it("uses CommonJS preload entry that Electron can load in packaged apps", () => {
    expect(packageJson.build.files).toContain("dist-electron/**/*");
    expect(packageJson.scripts["electron:build:main"]).toBe("tsc -p tsconfig.electron.json");
    expect(existsSync(path.join(repoRoot, "electron/preload/index.cts"))).toBe(true);
  });

  it("does not keep the retired Python implementation or parity docs", () => {
    const retiredPaths = [
      "pyproject.toml",
      "src/email_order_reader",
      "scripts/generate_icons.py",
      "scripts/stamp_build_info.py",
      "docs/electron-parity-checklist.md",
      "docs/superpowers",
      "tests/test_email_client.py",
      "tests/test_excel_parser.py",
      "tests/test_github_actions_workflow.py",
      "tests/test_icon_assets.py",
      "tests/test_legacy_pyside_removed.py",
      "tests/test_models.py",
      "tests/test_package_import.py",
      "tests/test_scan_service.py",
      "tests/test_self_update.py",
      "tests/test_settings.py",
      "tests/test_updates.py",
    ];

    expect(retiredPaths.filter((retiredPath) => existsSync(path.join(repoRoot, retiredPath)))).toEqual([]);
  });
});
