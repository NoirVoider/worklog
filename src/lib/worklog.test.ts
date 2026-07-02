import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  createDailyTemplate,
  formatDateTitle,
  formatDateTitleParts,
  formatMonthLabel,
  normalizeEntries,
  shiftMonth,
} from "./worklog";

describe("worklog date helpers", () => {
  it("formats Chinese mac-style date labels", () => {
    expect(formatMonthLabel("2026-06-20")).toBe("六月");
    expect(formatDateTitle("2026-06-20")).toBe("6月20日 周六");
  });

  it("adds relative labels for yesterday, today, and tomorrow titles", () => {
    expect(formatDateTitleParts("2026-07-01", "2026-07-01")).toEqual({
      dateLabel: "7月1日 周三",
      isToday: true,
      relativeLabel: "今天",
    });
    expect(formatDateTitleParts("2026-07-02", "2026-07-01")).toEqual({
      dateLabel: "7月2日 周四",
      isToday: false,
      relativeLabel: "明天",
    });
    expect(formatDateTitleParts("2026-06-30", "2026-07-01")).toEqual({
      dateLabel: "6月30日 周二",
      isToday: false,
      relativeLabel: "昨天",
    });
    expect(formatDateTitleParts("2026-07-03", "2026-07-01")).toEqual({
      dateLabel: "7月3日 周五",
      isToday: false,
    });
  });

  it("shifts end-of-month dates into the requested month", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("builds a Monday-first 6-week calendar grid with entry markers", () => {
    const grid = buildMonthGrid("2026-06-20", ["2026-06-20", "2026-07-01"]);

    expect(grid).toHaveLength(42);
    expect(grid[0]).toMatchObject({
      date: "2026-06-01",
      day: 1,
      isCurrentMonth: true,
      weekday: 1,
    });
    expect(grid[34]).toMatchObject({
      date: "2026-07-05",
      day: 5,
      isCurrentMonth: false,
    });
    expect(grid.find((day) => day.date === "2026-06-20")?.hasEntry).toBe(true);
    expect(grid.find((day) => day.date === "2026-07-01")?.hasEntry).toBe(true);
  });

  it("normalizes entries newest-first and keeps preview text compact", () => {
    const entries = normalizeEntries([
      {
        date: "2026-06-16",
        content: "# 2026-06-16\n\n## Today\n\nfirst note",
        exists: true,
      },
      {
        date: "2026-06-29",
        content: "# 2026-06-29\n\n## Done\n\n线上质检小料台数据导出5000张验证yolo准确率",
        exists: true,
      },
    ]);

    expect(entries.map((entry) => entry.date)).toEqual([
      "2026-06-29",
      "2026-06-16",
    ]);
    expect(entries[0].preview).toBe("线上质检小料台数据导出5000张验证yolo准确率");
    expect(entries[0].title).toBe("6月29日 周一");
  });

  it("starts new daily entries without a default markdown template", () => {
    expect(createDailyTemplate("2026-07-02")).toBe("");
  });
});
