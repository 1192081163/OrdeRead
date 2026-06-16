import { describe, expect, it } from "vitest";

import { IPC_CHANNELS } from "../../electron/shared/types";

describe("IPC contract", () => {
  it("defines stable channels for renderer calls", () => {
    expect(IPC_CHANNELS).toEqual({
      loadSettings: "settings:load",
      saveSettings: "settings:save",
      scanOrders: "orders:scan",
      checkUpdates: "updates:check",
      downloadUpdate: "updates:download",
      installUpdate: "updates:install",
    });
  });
});
