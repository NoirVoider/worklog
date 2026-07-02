import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  subDays,
} from "date-fns";
import { zhCN } from "date-fns/locale";

export type WorklogFile = {
  date: string;
  content: string;
  exists: boolean;
};

export type WorklogEntry = WorklogFile & {
  title: string;
  weekdayLabel: string;
  preview: string;
};

export type EntryWindow = {
  start: number;
  end: number;
  anchorIndex: number;
};

export type CalendarDay = {
  date: string;
  day: number;
  weekday: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasEntry: boolean;
};

export type DateTitleParts = {
  dateLabel: string;
  isToday: boolean;
  relativeLabel?: "昨天" | "今天" | "明天";
};

const DATE_FORMAT = "yyyy-MM-dd";
const WEEK_START_OFFSET = 1;

type EntryWindowOptions = {
  initialCount: number;
};

export function todayIso(): string {
  return format(new Date(), DATE_FORMAT);
}

export function shiftDate(date: string, amount: number): string {
  return format(addDays(parseISO(date), amount), DATE_FORMAT);
}

export function shiftMonth(date: string, amount: number): string {
  return format(addMonths(parseISO(date), amount), DATE_FORMAT);
}

export function formatMonthLabel(date: string): string {
  return format(parseISO(date), "LLLL", { locale: zhCN });
}

export function formatDateTitle(date: string): string {
  return format(parseISO(date), "M月d日 EEE", { locale: zhCN });
}

export function formatDateTitleParts(
  date: string,
  referenceDate = todayIso(),
): DateTitleParts {
  const relativeDay = differenceInCalendarDays(parseISO(date), parseISO(referenceDate));
  const relativeLabel =
    relativeDay === 0
      ? "今天"
      : relativeDay === 1
        ? "明天"
        : relativeDay === -1
          ? "昨天"
          : undefined;

  return {
    dateLabel: formatDateTitle(date),
    isToday: relativeDay === 0,
    ...(relativeLabel ? { relativeLabel } : {}),
  };
}

export function formatFullDate(date: string): string {
  return format(parseISO(date), "yyyy年M月d日", { locale: zhCN });
}

export function getWeekdayLabel(date: string): string {
  return format(parseISO(date), "EEEE", { locale: zhCN });
}

export function buildMonthGrid(date: string, entryDates: string[] = []): CalendarDay[] {
  const monthStart = startOfMonth(parseISO(date));
  const monthEnd = endOfMonth(monthStart);
  const firstDayOffset = modulo(getDay(monthStart) - WEEK_START_OFFSET, 7);
  const gridStart = subDays(monthStart, firstDayOffset);
  const gridEnd = addDays(gridStart, 41);
  const entrySet = new Set(entryDates);
  const today = todayIso();

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((day) => ({
    date: format(day, DATE_FORMAT),
    day: Number(format(day, "d")),
    weekday: getDay(day),
    isCurrentMonth: isSameMonth(day, monthEnd),
    isToday: format(day, DATE_FORMAT) === today,
    hasEntry: entrySet.has(format(day, DATE_FORMAT)),
  }));
}

export function normalizeEntries(entries: WorklogFile[]): WorklogEntry[] {
  return [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => ({
      ...entry,
      title: formatDateTitle(entry.date),
      weekdayLabel: getWeekdayLabel(entry.date),
      preview: extractPreview(entry.content),
    }));
}

export function buildVisibleEntryWindow(
  entries: WorklogEntry[],
  selectedDate: string,
  options: EntryWindowOptions,
): EntryWindow {
  if (entries.length === 0) {
    return { start: 0, end: 0, anchorIndex: 0 };
  }

  const { initialCount } = options;
  const anchorIndex = findEntryAnchorIndex(entries, selectedDate);
  const half = Math.floor(initialCount / 2);
  let start = Math.max(0, anchorIndex - half);
  let end = Math.min(entries.length, start + initialCount);

  if (end - start < initialCount) {
    start = Math.max(0, end - initialCount);
  }

  return { start, end, anchorIndex };
}

export function expandVisibleEntryWindow(
  window: EntryWindow,
  direction: "forward" | "backward",
  chunkSize: number,
  totalCount: number,
): EntryWindow {
  if (direction === "forward") {
    return {
      ...window,
      start: Math.max(0, window.start - chunkSize),
    };
  }

  return {
    ...window,
    end: Math.min(totalCount, window.end + chunkSize),
  };
}

export function createDailyTemplate(date: string): string {
  void date;
  return "";
}

function extractPreview(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((lineText) => lineText && !lineText.startsWith("#"));

  return line ? line.replace(/^[-*]\s+/, "").slice(0, 64) : "";
}

function findEntryAnchorIndex(entries: WorklogEntry[], selectedDate: string): number {
  const existingIndex = entries.findIndex((entry) => entry.date === selectedDate);
  if (existingIndex >= 0) {
    return existingIndex;
  }

  const insertionIndex = entries.findIndex((entry) => entry.date < selectedDate);
  if (insertionIndex >= 0) {
    return insertionIndex;
  }

  return Math.max(entries.length - 1, 0);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
