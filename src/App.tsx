import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  Eye,
  Fingerprint,
  FolderOpen,
  Info,
  LoaderCircle,
  Mail,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Settings,
  UserRound
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format, parseISO } from "date-fns";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type UIEvent
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { worklogApi } from "./lib/api";
import { cn } from "./lib/cn";
import { isSettingsShortcut, isToggleSidebarShortcut } from "./lib/shortcuts";
import {
  buildVisibleEntryWindow,
  buildMonthGrid,
  createDailyTemplate,
  expandVisibleEntryWindow,
  formatDateTitleParts,
  formatFullDate,
  formatMonthLabel,
  normalizeEntries,
  shiftDate,
  shiftMonth,
  todayIso,
  type EntryWindow,
  type WorklogEntry,
  type WorklogFile
} from "./lib/worklog";

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

type EditorMode = "edit" | "preview";

const AUTOSAVE_DELAY_MS = 600;
const INITIAL_ENTRY_WINDOW = 24;
const ENTRY_WINDOW_CHUNK = 12;
const ENTRY_SCROLL_THRESHOLD = 120;

type StatusMessage =
  | "idle"
  | "loading"
  | "empty"
  | "pending"
  | "saving"
  | "saved"
  | "failed"
  | "creating";

type SpinnerStatusLabel = "Loading entry" | "Creating entry" | "Pending changes" | "Saving";

type StatusIndicator =
  | { kind: "spinner"; label: SpinnerStatusLabel }
  | { kind: "warning"; label: "Save failed"; title: "Save failed" }
  | null;

type FlushReason = "autosave" | "shortcut" | "date-change" | "blur" | "window-close";

const appInfo = {
  name: "Worklog",
  author: "ttb",
  email: "x.ttb@icloud.com",
  identifier: "com.ttb.worklog"
};

const dragIgnoreSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[contenteditable='true']",
  ".editor-stage",
  ".markdown-preview"
].join(",");

function getBaseStatus(file: WorklogFile | null): StatusMessage {
  return file?.exists ? "idle" : "empty";
}

function getStatusIndicator(status: StatusMessage): StatusIndicator {
  switch (status) {
    case "loading":
      return { kind: "spinner", label: "Loading entry" };
    case "creating":
      return { kind: "spinner", label: "Creating entry" };
    case "pending":
      return { kind: "spinner", label: "Pending changes" };
    case "saving":
      return { kind: "spinner", label: "Saving" };
    case "failed":
      return { kind: "warning", label: "Save failed", title: "Save failed" };
    default:
      return null;
  }
}

function handleWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(dragIgnoreSelector)) {
    return;
  }

  event.preventDefault();
  void getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}

export default function App() {
  if (window.location.pathname === "/settings") {
    return <SettingsWindow />;
  }

  return <WorklogApp />;
}

function WorklogApp() {
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [viewDate, setViewDate] = useState(todayIso());
  const [entries, setEntries] = useState<WorklogFile[]>([]);
  const [currentEntry, setCurrentEntry] = useState<WorklogFile | null>(null);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("edit");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [status, setStatus] = useState<StatusMessage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [entryWindow, setEntryWindow] = useState<EntryWindow>({
    start: 0,
    end: 0,
    anchorIndex: 0
  });
  const autosaveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const queuedFlushRef = useRef(false);
  const selectedDateRef = useRef(selectedDate);
  const currentEntryRef = useRef<WorklogFile | null>(currentEntry);
  const latestContentRef = useRef("");
  const lastPersistedContentRef = useRef("");
  const entriesScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingPrependScrollHeightRef = useRef<number | null>(null);

  const normalizedEntries = useMemo(() => normalizeEntries(entries), [entries]);
  const entryDates = useMemo(() => entries.map(entry => entry.date), [entries]);
  const calendarDays = useMemo(() => buildMonthGrid(viewDate, entryDates), [entryDates, viewDate]);
  const dateTitleParts = useMemo(() => formatDateTitleParts(selectedDate), [selectedDate]);
  const selectedDateValue = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const statusIndicator = useMemo(() => getStatusIndicator(status), [status]);
  const visibleEntries = useMemo(
    () => normalizedEntries.slice(entryWindow.start, entryWindow.end),
    [entryWindow.end, entryWindow.start, normalizedEntries]
  );

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    currentEntryRef.current = currentEntry;
  }, [currentEntry]);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    pendingPrependScrollHeightRef.current = null;
    setEntryWindow(
      buildVisibleEntryWindow(normalizedEntries, selectedDate, {
        initialCount: INITIAL_ENTRY_WINDOW
      })
    );
  }, [normalizedEntries, selectedDate]);

  useLayoutEffect(() => {
    const previousHeight = pendingPrependScrollHeightRef.current;
    const element = entriesScrollRef.current;

    if (previousHeight === null || !element) {
      return;
    }

    pendingPrependScrollHeightRef.current = null;
    element.scrollTop += element.scrollHeight - previousHeight;
  }, [visibleEntries.length]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void worklogApi.mainWindowReady().catch(() => undefined);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const refreshEntries = useCallback(async () => {
    const files = await worklogApi.listEntries();
    setEntries(files);
  }, []);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const flushEntry = useCallback(
    async (reason: FlushReason) => {
      const snapshotDate = selectedDateRef.current;
      const snapshotContent = latestContentRef.current;
      const shouldDeleteOnLeave =
        (reason === "date-change" || reason === "window-close") &&
        snapshotContent === "" &&
        Boolean(currentEntryRef.current?.exists);

      if (latestContentRef.current === lastPersistedContentRef.current && !shouldDeleteOnLeave) {
        clearAutosaveTimer();
        setStatus(getBaseStatus(currentEntryRef.current));
        return true;
      }

      if (saveInFlightRef.current) {
        queuedFlushRef.current = true;
        return true;
      }

      clearAutosaveTimer();

      if (shouldDeleteOnLeave) {
        saveInFlightRef.current = true;
        queuedFlushRef.current = false;
        setError(null);
        setStatus("saving");

        try {
          await worklogApi.deleteEntry(snapshotDate);
          lastPersistedContentRef.current = createDailyTemplate(snapshotDate);

          if (selectedDateRef.current === snapshotDate) {
            setCurrentEntry({
              date: snapshotDate,
              content: createDailyTemplate(snapshotDate),
              exists: false
            });
          }
          await refreshEntries();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setStatus("failed");
          queuedFlushRef.current = false;
          saveInFlightRef.current = false;
          return false;
        }

        queuedFlushRef.current = false;
        saveInFlightRef.current = false;
        setStatus("idle");
        return true;
      }

      while (latestContentRef.current !== lastPersistedContentRef.current) {
        const nextSnapshotDate = selectedDateRef.current;
        const nextSnapshotContent = latestContentRef.current;

        saveInFlightRef.current = true;
        queuedFlushRef.current = false;
        setError(null);
        setStatus("saving");

        try {
          const saved = await worklogApi.saveEntry(nextSnapshotDate, nextSnapshotContent);

          if (selectedDateRef.current === nextSnapshotDate) {
            setCurrentEntry(saved);
          }
          lastPersistedContentRef.current = saved.content;
          await refreshEntries();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setStatus("failed");
          queuedFlushRef.current = false;
          saveInFlightRef.current = false;
          return false;
        }

        const shouldReplay =
          queuedFlushRef.current || latestContentRef.current !== lastPersistedContentRef.current;

        queuedFlushRef.current = false;
        saveInFlightRef.current = false;

        if (!shouldReplay) {
          setStatus("idle");
          return true;
        }
      }

      return true;
    },
    [clearAutosaveTimer, refreshEntries]
  );

  const loadEntry = useCallback(async (date: string) => {
    setError(null);
    setStatus("loading");
    const file = await worklogApi.readEntry(date);
    setCurrentEntry(file);
    setContent(file.content);
    latestContentRef.current = file.content;
    lastPersistedContentRef.current = file.content;
    setStatus(getBaseStatus(file));
  }, []);

  useEffect(() => {
    refreshEntries().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [refreshEntries]);

  useEffect(() => {
    loadEntry(selectedDate).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [loadEntry, selectedDate]);

  useEffect(() => {
    if (currentEntry && !currentEntry.exists) {
      setMode("edit");
    }
  }, [currentEntry]);

  const handleSelectDate = useCallback(
    async (date: string) => {
      if (date === selectedDateRef.current) {
        setViewDate(date);
        return true;
      }

      const didFlush = await flushEntry("date-change");
      if (!didFlush) {
        return false;
      }

      setSelectedDate(date);
      setViewDate(date);
      return true;
    },
    [flushEntry]
  );

  const handleContentChange = useCallback(
    (nextContent: string) => {
      latestContentRef.current = nextContent;
      setContent(nextContent);
      setStatus(
        nextContent === lastPersistedContentRef.current ? getBaseStatus(currentEntry) : "pending"
      );
    },
    [currentEntry]
  );

  const handleEntriesScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;

      if (element.scrollTop <= ENTRY_SCROLL_THRESHOLD && entryWindow.start > 0) {
        pendingPrependScrollHeightRef.current = element.scrollHeight;
        setEntryWindow(current =>
          expandVisibleEntryWindow(current, "forward", ENTRY_WINDOW_CHUNK, normalizedEntries.length)
        );
        return;
      }

      if (
        element.scrollHeight - element.scrollTop - element.clientHeight <= ENTRY_SCROLL_THRESHOLD &&
        entryWindow.end < normalizedEntries.length
      ) {
        setEntryWindow(current =>
          expandVisibleEntryWindow(
            current,
            "backward",
            ENTRY_WINDOW_CHUNK,
            normalizedEntries.length
          )
        );
      }
    },
    [entryWindow.end, entryWindow.start, normalizedEntries.length]
  );

  useEffect(() => {
    if (content === lastPersistedContentRef.current) {
      clearAutosaveTimer();
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushEntry("autosave");
    }, AUTOSAVE_DELAY_MS);

    return clearAutosaveTimer;
  }, [clearAutosaveTimer, content, flushEntry, selectedDate]);

  const moveDate = (amount: number) => {
    const next = shiftDate(selectedDateRef.current, amount);
    void handleSelectDate(next);
  };

  const handleCalendarSelect = async (date?: Date) => {
    if (!date) {
      return;
    }

    const didChange = await handleSelectDate(format(date, "yyyy-MM-dd"));
    if (didChange) {
      setDatePickerOpen(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushEntry("shortcut");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setMode(value => (value === "edit" ? "preview" : "edit"));
      }
      if (isSettingsShortcut(event)) {
        event.preventDefault();
        void worklogApi.openSettings();
      }
      if (isToggleSidebarShortcut(event)) {
        event.preventDefault();
        setSidebarOpen(open => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flushEntry]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushEntry("window-close");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushEntry]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onCloseRequested(async event => {
        const didFlush = await flushEntry("window-close");
        if (!didFlush) {
          event.preventDefault();
        }
      })
      .then(cleanup => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flushEntry]);

  return (
    <div className='app-shell'>
      <button
        className='sidebar-toggle-floating'
        data-reveal-visible={String(!sidebarOpen)}
        type='button'
        aria-label='展开侧栏'
        title='展开侧栏'
        onClick={() => setSidebarOpen(true)}
      >
        <PanelLeft size={18} />
      </button>

      <aside className='sidebar' data-sidebar-state={sidebarOpen ? "open" : "closed"}>
        <div className='sidebar-titlebar' data-tauri-drag-region onMouseDown={handleWindowDrag}>
          <button
            className='icon-button ghost'
            type='button'
            aria-label='折叠侧栏'
            title='折叠侧栏'
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className='icon-button ghost'
            type='button'
            aria-label='设置'
            title='设置'
            onClick={() => void worklogApi.openSettings()}
          >
            <Settings size={17} />
          </button>
        </div>

        <div className='sidebar-body'>
          <section className='calendar-panel' aria-label='月历'>
            <div className='month-toolbar'>
              <h2>{formatMonthLabel(viewDate)}</h2>
              <div className='month-actions'>
                <button
                  className='icon-button ghost'
                  type='button'
                  aria-label='上个月'
                  onClick={() => setViewDate(date => shiftMonth(date, -1))}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  className='today-dot'
                  type='button'
                  aria-label='今天'
                  onClick={() => void handleSelectDate(todayIso())}
                >
                  <Circle size={11} fill='currentColor' />
                </button>
                <button
                  className='icon-button ghost'
                  type='button'
                  aria-label='下个月'
                  onClick={() => setViewDate(date => shiftMonth(date, 1))}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>

            <div className='week-grid' aria-hidden='true'>
              {weekLabels.map(label => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className='day-grid'>
              {calendarDays.map(day => (
                <button
                  className={cn(
                    "day-cell",
                    !day.isCurrentMonth && "muted",
                    day.hasEntry && "has-entry",
                    day.date === selectedDate && "selected",
                    day.isToday && day.date !== selectedDate && "today"
                  )}
                  key={day.date}
                  type='button'
                  aria-label={day.date}
                  onClick={() => void handleSelectDate(day.date)}
                >
                  <span>{day.day}</span>
                </button>
              ))}
            </div>
          </section>

          <section className='entry-list' aria-label='日期列表'>
            <div className='entries-scroll' onScroll={handleEntriesScroll} ref={entriesScrollRef}>
              {visibleEntries.length === 0 && <p className='entry-list-empty'>暂无记录</p>}
              {visibleEntries.map(entry => (
                <EntryCard
                  entry={entry}
                  isSelected={entry.date === selectedDate}
                  key={entry.date}
                  onSelect={() => void handleSelectDate(entry.date)}
                />
              ))}
            </div>
          </section>
        </div>
      </aside>

      <main className='main-surface' data-sidebar-state={sidebarOpen ? "open" : "closed"}>
        <div className='main-titlebar' data-tauri-drag-region onMouseDown={handleWindowDrag} />

        <section className='editor-wrap'>
          <header className='entry-header'>
            <div>
              <h1 className='entry-date-title'>
                {dateTitleParts.relativeLabel ? (
                  <>
                    <span className={cn("entry-title-relative", dateTitleParts.isToday && "today")}>
                      {dateTitleParts.relativeLabel}
                    </span>
                    {`, ${dateTitleParts.dateLabel}`}
                  </>
                ) : (
                  dateTitleParts.dateLabel
                )}
              </h1>
              <div className='date-controls'>
                <button
                  className='date-control-button'
                  type='button'
                  aria-label='前一天'
                  onClick={() => moveDate(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button className='date-picker-trigger' type='button' aria-label='选择日期'>
                      <CalendarDays size={14} aria-hidden='true' />
                      <span>{formatFullDate(selectedDate)}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className='date-picker-popover' align='start'>
                    <Calendar
                      mode='single'
                      selected={selectedDateValue}
                      defaultMonth={selectedDateValue}
                      showOutsideDays
                      autoFocus
                      onSelect={handleCalendarSelect}
                    />
                  </PopoverContent>
                </Popover>
                <button
                  className='date-control-button'
                  type='button'
                  aria-label='后一天'
                  onClick={() => moveDate(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className='editor-actions'>
              <div className='mode-switch' role='tablist' aria-label='编辑模式'>
                <button
                  className={cn(mode === "edit" && "active")}
                  type='button'
                  role='tab'
                  aria-label='编辑'
                  aria-selected={mode === "edit"}
                  title='编辑'
                  onClick={() => setMode("edit")}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className={cn(mode === "preview" && "active")}
                  type='button'
                  role='tab'
                  aria-label='预览'
                  aria-selected={mode === "preview"}
                  title='预览'
                  onClick={() => setMode("preview")}
                >
                  <Eye size={15} />
                </button>
              </div>
            </div>
          </header>

          <div className='editor-divider' />

          {error && <div className='error-ribbon'>{error}</div>}

          <div className='editor-stage'>
            {mode === "edit" ? (
              <textarea
                aria-label='Markdown 日记'
                value={content}
                spellCheck={false}
                onChange={event => handleContentChange(event.target.value)}
              />
            ) : (
              <article className='markdown-preview'>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </article>
            )}
          </div>
        </section>

        <div className='status-line' role='status' aria-live='polite'>
          {statusIndicator?.kind === "spinner" ? (
            <LoaderCircle
              className='status-indicator status-indicator-spinning'
              size={12}
              aria-label={statusIndicator.label}
            />
          ) : statusIndicator?.kind === "warning" ? (
            <CircleAlert
              className='status-indicator status-indicator-failed'
              size={12}
              aria-label={statusIndicator.label}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function EntryCard({
  entry,
  isSelected,
  onSelect
}: {
  entry: WorklogEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn("entry-card", isSelected && "selected")}
      type='button'
      aria-current={isSelected ? "date" : undefined}
      aria-label={`${entry.title} ${entry.preview}`}
      onClick={onSelect}
    >
      <strong>{entry.title}</strong>
      <span>{entry.preview}</span>
    </button>
  );
}

function SettingsWindow() {
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void worklogApi.settingsWindowReady().catch(() => undefined);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <main className='settings-window'>
      <header className='settings-titlebar' data-tauri-drag-region onMouseDown={handleWindowDrag}>
        <h1>设置</h1>
        <span className='settings-version'>v0.1.1</span>
      </header>

      <div className='settings-content'>
        <section className='settings-about' aria-labelledby='settings-about-title'>
          <h2 id='settings-about-title'>{appInfo.name}</h2>
          <p className='settings-desc'>Markdown 日记 · 本地存储</p>

          <div className='settings-about-info'>
            <span>作者</span>
            <strong>{appInfo.author}</strong>
            <span>邮箱</span>
            <a href={`mailto:${appInfo.email}`}>{appInfo.email}</a>
            <span>ID</span>
            <code>{appInfo.identifier}</code>
          </div>
        </section>
      </div>
    </main>
  );
}
