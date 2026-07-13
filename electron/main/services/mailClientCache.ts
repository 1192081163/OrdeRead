import type { AppSettings } from "../../shared/types.js";

type ClosableClient = {
  close?(): Promise<void>;
};

type MailboxClientFactory<TClient extends ClosableClient> = (email: string, authCode: string) => TClient;

export class MailboxClientCache<TClient extends ClosableClient> {
  private client: TClient | null = null;
  private clientKey = "";

  constructor(
    private readonly createClient: MailboxClientFactory<TClient>,
    private readonly reportBackgroundError: (error: unknown) => void = (error) =>
      console.warn("关闭旧邮箱连接失败：", error),
  ) {}

  get(settings: AppSettings): TClient {
    const email = settings.email.trim();
    const nextKey = cacheKey(email, settings.authCode);
    if (this.client && this.clientKey === nextKey) {
      return this.client;
    }

    void this.client?.close?.().catch(this.reportBackgroundError);
    this.client = this.createClient(email, settings.authCode);
    this.clientKey = nextKey;
    return this.client;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.clientKey = "";
    await client?.close?.();
  }
}

function cacheKey(email: string, authCode: string): string {
  return `${email}\u0000${authCode}`;
}
