import { describe, expect, it, vi } from "vitest";

import { MailboxClientCache } from "../../electron/main/services/mailClientCache";

describe("IMAP client cache", () => {
  it("reuses a connected mailbox client for the same credentials", () => {
    const close = vi.fn(async () => undefined);
    const createClient = vi.fn((email: string, authCode: string) => ({ email, authCode, close }));
    const cache = new MailboxClientCache(createClient);

    const first = cache.get({ email: "buyer@example.com", authCode: "secret" });
    const second = cache.get({ email: " buyer@example.com ", authCode: "secret" });

    expect(second).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the old mailbox client when credentials change", async () => {
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const createClient = vi
      .fn()
      .mockReturnValueOnce({ label: "first", close: firstClose })
      .mockReturnValueOnce({ label: "second", close: secondClose });
    const cache = new MailboxClientCache(createClient);

    const first = cache.get({ email: "buyer@example.com", authCode: "old" });
    const second = cache.get({ email: "buyer@example.com", authCode: "new" });

    expect(second).not.toBe(first);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();

    await cache.close();

    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected background close without leaking an unhandled rejection", async () => {
    const closeError = new Error("socket already closed");
    const firstClose = vi.fn(async () => Promise.reject(closeError));
    const reportBackgroundError = vi.fn();
    const createClient = vi
      .fn()
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: vi.fn(async () => undefined) });
    const cache = new MailboxClientCache(createClient, reportBackgroundError);

    cache.get({ email: "buyer@example.com", authCode: "old" });
    cache.get({ email: "buyer@example.com", authCode: "new" });

    await vi.waitFor(() => expect(reportBackgroundError).toHaveBeenCalledWith(closeError));
  });
});
