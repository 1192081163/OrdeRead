import { normalizeDeadlineDate } from "./date.js";
import type { OrderRow } from "./types.js";

export function sortOrderRows(rows: OrderRow[]): OrderRow[] {
  return [...rows].sort((left, right) => {
    const leftDeadline = normalizeDeadlineDate(left.deadline);
    const rightDeadline = normalizeDeadlineDate(right.deadline);

    if (leftDeadline && rightDeadline && leftDeadline !== rightDeadline) {
      return leftDeadline.localeCompare(rightDeadline);
    }
    if (leftDeadline && !rightDeadline) {
      return -1;
    }
    if (!leftDeadline && rightDeadline) {
      return 1;
    }

    return left.orderNumber.localeCompare(right.orderNumber);
  });
}
