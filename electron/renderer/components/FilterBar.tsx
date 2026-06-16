import type { DateFilter } from "../../shared/types";

type Props = {
  filter: DateFilter;
  onChange(filter: DateFilter): void;
};

export function FilterBar({ filter, onChange }: Props) {
  return (
    <section className="panel filter-bar">
      <label>
        订单号
        <input
          placeholder="搜索订单号"
          value={filter.searchText}
          onChange={(event) => onChange({ ...filter, searchText: event.target.value })}
        />
      </label>
      <label>
        发送时间
        <select
          value={filter.sentPreset}
          onChange={(event) => onChange({ ...filter, sentPreset: event.target.value as DateFilter["sentPreset"] })}
        >
          <option value="all">全部</option>
          <option value="today">今天发来</option>
          <option value="yesterday">昨天发来</option>
          <option value="thisWeek">本周发来</option>
          <option value="lastWeek">上周发来</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      {filter.sentPreset === "custom" ? (
        <>
          <label>
            发送开始
            <input
              type="date"
              value={filter.sentStartDate}
              onChange={(event) => onChange({ ...filter, sentStartDate: event.target.value })}
            />
          </label>
          <label>
            发送结束
            <input
              type="date"
              value={filter.sentEndDate}
              onChange={(event) => onChange({ ...filter, sentEndDate: event.target.value })}
            />
          </label>
        </>
      ) : null}
      <label>
        截止时间
        <select
          value={filter.deadlinePreset}
          onChange={(event) =>
            onChange({ ...filter, deadlinePreset: event.target.value as DateFilter["deadlinePreset"] })
          }
        >
          <option value="all">全部</option>
          <option value="today">今天到期</option>
          <option value="tomorrow">明天到期</option>
          <option value="thisWeek">本周到期</option>
          <option value="overdue">已过期</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      {filter.deadlinePreset === "custom" ? (
        <>
          <label>
            截止开始
            <input
              type="date"
              value={filter.deadlineStartDate}
              onChange={(event) => onChange({ ...filter, deadlineStartDate: event.target.value })}
            />
          </label>
          <label>
            截止结束
            <input
              type="date"
              value={filter.deadlineEndDate}
              onChange={(event) => onChange({ ...filter, deadlineEndDate: event.target.value })}
            />
          </label>
        </>
      ) : null}
    </section>
  );
}
