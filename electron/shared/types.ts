export type OrderRow = {
  orderNumber: string;
  deadline: string;
  sourceFile: string;
  messageSubject: string;
  messageDate: string;
};

export type ScanResult = {
  rows: OrderRow[];
  warnings: string[];
  scannedMessages: number;
  parsedAttachments: number;
  scanMode: "full" | "incremental";
};

export type AppSettings = {
  email: string;
  authCode: string;
};

export type SentDatePreset = "all" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "custom";

export type DeadlineDatePreset = "all" | "today" | "tomorrow" | "thisWeek" | "overdue" | "custom";

export type DateFilter = {
  searchText: string;
  sentPreset: SentDatePreset;
  sentStartDate: string;
  sentEndDate: string;
  deadlinePreset: DeadlineDatePreset;
  deadlineStartDate: string;
  deadlineEndDate: string;
};

export type UpdateInfo = {
  tagName: string;
  releaseUrl: string;
  assetName: string;
  assetUrl: string;
};

export const IPC_CHANNELS = {
  loadSettings: "settings:load",
  saveSettings: "settings:save",
  scanOrders: "orders:scan",
  checkUpdates: "updates:check",
  downloadUpdate: "updates:download",
  installUpdate: "updates:install",
} as const;

export type ScanOrdersRequest = {
  fullScan: boolean;
};

export type RendererApi = {
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  scanOrders(options: ScanOrdersRequest): Promise<ScanResult>;
  checkUpdates(): Promise<UpdateInfo | null>;
  downloadUpdate(update: UpdateInfo): Promise<string>;
  installUpdate(path: string): Promise<void>;
};
