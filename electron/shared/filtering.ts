import { normalizeDeadlineDate, sentDateFromMessageDate } from "./date.js";
import type { DateFilter, DeadlineDatePreset, OrderRow, SentDatePreset } from "./types.js";

type FilterOptions = {
  today?: string;
};

type DateRange = {
  startDate: string;
  endDate: string;
};

export function filterOrderRows(rows: OrderRow[], filter: DateFilter, options: FilterOptions = {}): OrderRow[] {
  const search = filter.searchText.trim().toLowerCase();
  const today = options.today ?? localToday();
  const sentRange = sentDateRange(filter, today);
  const deadlineRange = deadlineDateRange(filter, today);

  return rows.filter((row) => {
    if (search && !row.orderNumber.toLowerCase().includes(search)) {
      return false;
    }

    if (sentRange && !dateMatchesRange(sentDateFromMessageDate(row.messageDate), sentRange)) {
      return false;
    }

    if (deadlineRange && !dateMatchesRange(normalizeDeadlineDate(row.deadline), deadlineRange)) {
      return false;
    }
    return true;
  });
}

function sentDateRange(filter: DateFilter, today: string): DateRange | null {
  if (filter.sentPreset === "custom") {
    return customRange(filter.sentStartDate, filter.sentEndDate);
  }
  return presetRange(filter.sentPreset, today);
}

function deadlineDateRange(filter: DateFilter, today: string): DateRange | null {
  if (filter.deadlinePreset === "custom") {
    return customRange(filter.deadlineStartDate, filter.deadlineEndDate);
  }
  return presetRange(filter.deadlinePreset, today);
}

function customRange(startDate: string, endDate: string): DateRange | null {
  return startDate || endDate ? { startDate, endDate } : null;
}

function presetRange(preset: SentDatePreset | DeadlineDatePreset, today: string): DateRange | null {
  switch (preset) {
    case "today":
      return { startDate: today, endDate: today };
    case "yesterday": {
      const date = addDays(today, -1);
      return { startDate: date, endDate: date };
    }
    case "tomorrow": {
      const date = addDays(today, 1);
      return { startDate: date, endDate: date };
    }
    case "thisWeek":
      return weekRange(today, 0);
    case "lastWeek":
      return weekRange(today, -1);
    case "overdue":
      return { startDate: "", endDate: addDays(today, -1) };
    case "all":
    case "custom":
      return null;
  }
}

function dateMatchesRange(value: string | null, range: DateRange): boolean {
  if (!value) {
    return false;
  }
  if (range.startDate && value < range.startDate) {
    return false;
  }
  if (range.endDate && value > range.endDate) {
    return false;
  }
  return true;
}

function weekRange(today: string, weekOffset: number): DateRange {
  const date = parseIsoDate(today);
  const dayOfWeek = date.getUTCDay() || 7;
  const monday = addDays(today, 1 - dayOfWeek + weekOffset * 7);
  return { startDate: monday, endDate: addDays(monday, 6) };
}

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return isoDate(year, month, day);
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseIsoDate(value: string): Date {
  const [yearText, monthText, dayText] = value.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
