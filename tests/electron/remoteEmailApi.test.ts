import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadOrderCache } from "../../electron/main/services/orderCache";
import {
  loadRemoteEmailApiConfig,
  RemoteEmailApiClient,
  scanRemoteOrders,
} from "../../electron/main/services/remoteEmailApi";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "remote-email-api-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

function extractionRow(values: Array<string | number | null>, sourceFile = "/server/downloads/order.xlsx") {
  return {
    values,
    notes: [],
    manualCheck: [],
    sourceFile,
  };
}

describe("remote email API client", () => {
  it("loads remote API config from environment before JSON files", async () => {
    const configPath = path.join(tempDir, "email_api_client.json");
    await writeFile(configPath, JSON.stringify({ baseUrl: "https://json.example", token: "json-token" }), "utf-8");

    await expect(
      loadRemoteEmailApiConfig(
        { ORDERFLOW_EMAIL_API_URL: " https://env.example/ ", ORDERFLOW_EMAIL_API_TOKEN: " env-token " },
        [configPath],
      ),
    ).resolves.toEqual({
      baseUrl: "https://env.example/",
      token: "env-token",
    });
  });

  it("scans server messages and maps extracted rows into order rows", async () => {
    const cachePath = path.join(tempDir, "order_cache.json");
    const values = Array<string | number | null>(24).fill("");
    values[0] = "2026-07-02";
    values[1] = "PO-123";
    values[14] = "2026-07-05";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.example/api/email/messages") {
        return new Response(
          JSON.stringify({
            messages: [
              {
                uid: "101",
                subject: "new order",
                date: "2026-06-18T02:00:00.000Z",
                attachmentCount: 1,
                excelAttachmentNames: ["order.xlsx"],
                hasExcelAttachments: true,
              },
            ],
            scannedMessages: 1,
            days: 7,
          }),
          { status: 200 },
        );
      }

      if (url === "https://api.example/api/email/extract") {
        return new Response(
          JSON.stringify({
            emailFetch: {
              files: ["/server/downloads/order.xlsx"],
              scannedMessages: 1,
              attachmentCount: 1,
              downloadDir: "/server/downloads",
            },
            extraction: {
              inputFiles: ["/server/downloads/order.xlsx"],
              rows: [extractionRow(values)],
              skippedFiles: [],
              failures: [],
              outputs: {
                outputDir: "",
                csvOutput: "",
                xlsxOutput: "",
                auditOutput: "",
              },
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanRemoteOrders({
      client: new RemoteEmailApiClient({ baseUrl: "https://api.example/", token: "secret-token" }),
      request: {
        fullScan: true,
        sentStartDate: "2026-06-12",
        sentEndDate: "2026-06-18",
      },
      cachePath,
      accountEmail: "remote@example.com",
      now: () => new Date("2026-06-18T12:00:00.000Z"),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example/api/email/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
        body: JSON.stringify({ days: 7 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example/api/email/extract",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
        body: JSON.stringify({ messageUids: ["101"], hours: 168, inferManual: true }),
      }),
    );
    expect(result).toMatchObject({
      rows: [
        {
          orderNumber: "PO-123",
          deadline: "2026-07-05",
          sourceFile: "order.xlsx",
          messageSubject: "new order",
          messageDate: "2026-06-18T02:00:00.000Z",
        },
      ],
      scannedMessages: 1,
      parsedAttachments: 1,
      scanMode: "full",
    });
    await expect(loadOrderCache(cachePath)).resolves.toMatchObject({
      email: "remote@example.com",
      lastUid: 101,
      rows: result.rows,
    });
  });
});
