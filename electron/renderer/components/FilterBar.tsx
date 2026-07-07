import { Button, Field, Input } from "@fluentui/react-components";
import { DatePicker, type CalendarStrings } from "@fluentui/react-datepicker-compat";

import type { DateFilter } from "../../shared/types";

type Props = {
  filter: DateFilter;
  onChange(filter: DateFilter): void;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CHINESE_CALENDAR_STRINGS: CalendarStrings = {
  months: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
  shortMonths: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
  days: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"],
  shortDays: ["日", "一", "二", "三", "四", "五", "六"],
  goToToday: "今天",
  prevMonthAriaLabel: "上个月",
  nextMonthAriaLabel: "下个月",
  prevYearAriaLabel: "上一年",
  nextYearAriaLabel: "下一年",
  closeButtonAriaLabel: "关闭日历",
};

function dateFromIso(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function isoFromDate(date: Date | null | undefined): string {
  if (!date) {
    return "";
  }

  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateFromString(value: string): Date | null {
  return dateFromIso(value.trim());
}

type DateFilterPickerProps = {
  className?: string;
  label: string;
  value: string;
  onChange(value: string): void;
};

function DateFilterPicker({ className, label, onChange, value }: DateFilterPickerProps) {
  const inputShellClassName = value ? "date-filter-input-shell has-value" : "date-filter-input-shell";

  return (
    <Field label={label} className={className}>
      <div className={inputShellClassName}>
        <DatePicker
          allowTextInput
          formatDate={isoFromDate}
          inlinePopup
          onSelectDate={(date) => onChange(isoFromDate(date))}
          parseDateFromString={parseDateFromString}
          placeholder="选择日期"
          strings={CHINESE_CALENDAR_STRINGS}
          value={dateFromIso(value)}
        />
        {value ? (
          <Button
            appearance="transparent"
            aria-label={`清空${label}`}
            className="date-filter-clear"
            onClick={() => onChange("")}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
          >
            ×
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

export function FilterBar({ filter, onChange }: Props) {
  const setSentDate = (value: string) => {
    onChange({
      ...filter,
      sentPreset: value ? "custom" : "all",
      sentStartDate: value,
      sentEndDate: value,
    });
  };

  const setDeadlineDate = (value: string) => {
    onChange({
      ...filter,
      deadlinePreset: value ? "custom" : "all",
      deadlineStartDate: value,
      deadlineEndDate: value,
    });
  };

  const clearDateFilters = () => {
    onChange({
      ...filter,
      sentPreset: "all",
      sentStartDate: "",
      sentEndDate: "",
      deadlinePreset: "all",
      deadlineStartDate: "",
      deadlineEndDate: "",
    });
  };

  return (
    <section className="panel filter-bar" role="region" aria-label="订单筛选">
      <div className="filter-row filter-row-primary">
        <Field label="订单号" className="filter-search">
          <Input
            placeholder="搜索订单号"
            value={filter.searchText}
            onChange={(_event, data) => onChange({ ...filter, searchText: data.value })}
          />
        </Field>
        <div className="date-filter-group">
          <DateFilterPicker
            className="date-filter-field"
            label="发送时间"
            value={filter.sentStartDate}
            onChange={setSentDate}
          />
        </div>
      </div>
      <div className="filter-row filter-row-secondary">
        <div className="date-filter-group">
          <DateFilterPicker
            className="date-filter-field"
            label="截止时间"
            value={filter.deadlineStartDate}
            onChange={setDeadlineDate}
          />
        </div>
        <Button className="clear-date-filters" onClick={clearDateFilters}>
          清空时间
        </Button>
      </div>
    </section>
  );
}
