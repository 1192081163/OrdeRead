import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

describe("local-only mail invariant", () => {
  it("does not ship or reference the removed remote email API", () => {
    expect(existsSync(path.join(repoRoot, "electron/main/services/remoteEmailApi.ts"))).toBe(false);

    const runtimeSources = [
      "electron/main/ipc.ts",
      "electron/renderer/App.tsx",
      "electron/shared/types.ts",
      "README.md",
    ]
      .map((filePath) => readFileSync(path.join(repoRoot, filePath), "utf-8"))
      .join("\n");

    expect(runtimeSources).not.toMatch(/remoteEmailApi|ORDERFLOW_EMAIL_API|远端邮件服务/);
  });
});
