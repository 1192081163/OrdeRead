import { sentDateFromMessageDate } from "./date.js";
import type { DateFilter, OrderRow } from "./types.js";

export function filterOrderRows(rows: OrderRow[], filter: DateFilter): OrderRow[] {
  const search = filter.searchText.trim().toLowerCase();
  const hasDateFilter = Boolean(filter.startDate || filter.endDate);

  return rows.filter((row) => {
    if (search && !row.orderNumber.toLowerCase().includes(search)) {
      return false;
    }

    if (!hasDateFilter) {
      return true;
    }

    const sentDate = sentDateFromMessageDate(row.messageDate);
    if (!sentDate) {
      return false;
    }
    if (filter.startDate && sentDate < filter.startDate) {
      return false;
    }
    if (filter.endDate && sentDate > filter.endDate) {
      return false;
    }

    return true;
  });
}
