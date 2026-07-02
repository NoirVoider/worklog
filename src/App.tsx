import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eye,
  Fingerprint,
  FolderOpen,
  Info,
  Mail,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Save,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format, parseISO } from "date-fns";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { worklogApi } from "./lib/api";
import { cn } from "./lib/cn";
import { isSettingsShortcut, isToggleSidebarShortcut } from "./lib/shortcuts";
import {
  buildMonthGrid,
  createDailyTemplate,
  formatDateTitleParts,
  formatFullDate,
  formatMonthLabel,
  normalizeEntries,
  shiftDate,
  shiftMonth,
  todayIso,
  type WorklogEntry,
  type WorklogFile,
} from "./lib/worklog";

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

type EditorMode = "edit" | "preview";

const appInfo = {
  name: "Worklog",
  author: "ttb",
  email: "x.ttb@icloud.com",
  identifier: "com.ttb.worklog",
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
  ".markdown-preview",
].join(",");

function handleWindowDrag(event: MouseEvent<HTMLElement>) {
  if (
    event.button !== 0 ||
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(dragIgnoreSelector)) {
    return;
  }

  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => undefined);
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
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [error, setError] = useState<string | null>(null);

  const normalizedEntries = useMemo(() => normalizeEntries(entries), [entries]);
  const entryDates = useMemo(() => entries.map((entry) => entry.date), [entries]);
  const calendarDays = useMemo(
    () => buildMonthGrid(viewDate, entryDates),
    [entryDates, viewDate],
  );
  const dateTitleParts = useMemo(() => formatDateTitleParts(selectedDate), [selectedDate]);
  const selectedDateValue = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const selectedEntry = normalizedEntries.find((entry) => entry.date === selectedDate);
  const hasUnsavedChanges = Boolean(currentEntry && content !== currentEntry.content);

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

  const loadEntry = useCallback(async (date: string) => {
    setError(null);
    setStatus("读取中");
    const file = await worklogApi.readEntry(date);
    setCurrentEntry(file);
    setContent(file.content);
    setStatus(file.exists ? "已读取" : "未创建");
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

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setViewDate(date);
  };

  const handleCreate = async (date = selectedDate) => {
    setError(null);
    setStatus("创建中");
    const file = await worklogApi.createEntry(date);
    setSelectedDate(date);
    setViewDate(date);
    setCurrentEntry(file);
    setContent(file.content);
    await refreshEntries();
    setStatus("已创建");
  };

  const handleSave = useCallback(async () => {
    if (!currentEntry || isSaving) {
      return;
    }

    setError(null);
    setIsSaving(true);
    setStatus("保存中");
    try {
      const saved = await worklogApi.saveEntry(selectedDate, content);
      setCurrentEntry(saved);
      await refreshEntries();
      setStatus("已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [content, currentEntry, isSaving, refreshEntries, selectedDate]);

  const moveDate = (amount: number) => {
    const next = shiftDate(selectedDate, amount);
    setSelectedDate(next);
    setViewDate(next);
  };

  const handleCalendarSelect = (date?: Date) => {
    if (!date) {
      return;
    }

    handleSelectDate(format(date, "yyyy-MM-dd"));
    setDatePickerOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setMode((value) => (value === "edit" ? "preview" : "edit"));
      }
      if (isSettingsShortcut(event)) {
        event.preventDefault();
        void worklogApi.openSettings();
      }
      if (isToggleSidebarShortcut(event)) {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <div className="app-shell">
      {!sidebarOpen && (
        <button
          className="sidebar-toggle-floating"
          type="button"
          aria-label="展开侧栏"
          title="展开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <PanelLeft size={18} />
        </button>
      )}

      <aside className={cn("sidebar", !sidebarOpen && "sidebar-collapsed")}>
        <div
          className="sidebar-titlebar"
          data-tauri-drag-region
          onMouseDown={handleWindowDrag}
        >
          <button
            className="icon-button ghost"
            type="button"
            aria-label="折叠侧栏"
            title="折叠侧栏"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className="icon-button ghost"
            type="button"
            aria-label="设置"
            title="设置"
            onClick={() => void worklogApi.openSettings()}
          >
            <Settings size={17} />
          </button>
        </div>

        <div className={cn("sidebar-body", !sidebarOpen && "sidebar-body-hidden")}>
          <section className="calendar-panel" aria-label="月历">
              <div className="month-toolbar">
                <h2>{formatMonthLabel(viewDate)}</h2>
                <div className="month-actions">
                  <button
                    className="icon-button ghost"
                    type="button"
                    aria-label="上个月"
                    onClick={() => setViewDate((date) => shiftMonth(date, -1))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className="today-dot"
                    type="button"
                    aria-label="今天"
                    onClick={() => handleSelectDate(todayIso())}
                  >
                    <Circle size={11} fill="currentColor" />
                  </button>
                  <button
                    className="icon-button ghost"
                    type="button"
                    aria-label="下个月"
                    onClick={() => setViewDate((date) => shiftMonth(date, 1))}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>

              <div className="week-grid" aria-hidden="true">
                {weekLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div className="day-grid">
                {calendarDays.map((day) => (
                  <button
                    className={cn(
                      "day-cell",
                      !day.isCurrentMonth && "muted",
                      day.hasEntry && "has-entry",
                      day.date === selectedDate && "selected",
                      day.isToday && day.date !== selectedDate && "today",
                    )}
                    key={day.date}
                    type="button"
                    aria-label={day.date}
                    onClick={() => handleSelectDate(day.date)}
                  >
                    <span>{day.day}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="entry-list" aria-label="最近日记">
              <div className="entry-list-header">
                <span>最近</span>
              </div>

              <div className="entries-scroll">
                {normalizedEntries.slice(0, 8).map((entry) => (
                  <EntryCard
                    entry={entry}
                    isSelected={entry.date === selectedDate}
                    key={entry.date}
                    onSelect={() => handleSelectDate(entry.date)}
                  />
                ))}
              </div>
            </section>
        </div>
      </aside>

      <main className="main-surface">
        <div
          className="main-titlebar"
          data-tauri-drag-region
          onMouseDown={handleWindowDrag}
        />

        <section className="editor-wrap">
          <header className="entry-header">
            <div>
              <h1 className="entry-date-title">
                {dateTitleParts.relativeLabel ? (
                  <>
                    <span
                      className={cn(
                        "entry-title-relative",
                        dateTitleParts.isToday && "today",
                      )}
                    >
                      {dateTitleParts.relativeLabel}
                    </span>
                    {`, ${dateTitleParts.dateLabel}`}
                  </>
                ) : (
                  dateTitleParts.dateLabel
                )}
              </h1>
              <div className="date-controls">
                <button
                  className="date-control-button"
                  type="button"
                  aria-label="前一天"
                  onClick={() => moveDate(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="date-picker-trigger"
                      type="button"
                      aria-label="选择日期"
                    >
                      <CalendarDays size={14} aria-hidden="true" />
                      <span>{formatFullDate(selectedDate)}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="date-picker-popover" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDateValue}
                      defaultMonth={selectedDateValue}
                      showOutsideDays
                      autoFocus
                      onSelect={handleCalendarSelect}
                    />
                  </PopoverContent>
                </Popover>
                <button
                  className="date-control-button"
                  type="button"
                  aria-label="后一天"
                  onClick={() => moveDate(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="editor-actions">
              <div className="mode-switch" role="tablist" aria-label="编辑模式">
                <button
                  className={cn(mode === "edit" && "active")}
                  type="button"
                  role="tab"
                  aria-label="编辑"
                  aria-selected={mode === "edit"}
                  title="编辑"
                  onClick={() => setMode("edit")}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className={cn(mode === "preview" && "active")}
                  type="button"
                  role="tab"
                  aria-label="预览"
                  aria-selected={mode === "preview"}
                  title="预览"
                  onClick={() => setMode("preview")}
                >
                  <Eye size={15} />
                </button>
              </div>
              <button
                className={cn("save-button", hasUnsavedChanges && "dirty")}
                type="button"
                disabled={!hasUnsavedChanges || isSaving}
                aria-label="保存日记"
                onClick={() => void handleSave()}
              >
                <Save size={16} />
                {isSaving ? "保存中" : "保存"}
              </button>
            </div>
          </header>

          <div className="editor-divider" />

          {!currentEntry?.exists && (
            <div className="empty-ribbon">
              <Sparkles size={16} />
              <span>这一天还没有日记</span>
              <button type="button" onClick={() => void handleCreate(selectedDate)}>
                创建
              </button>
            </div>
          )}

          {error && <div className="error-ribbon">{error}</div>}

          <div className="editor-stage">
            {mode === "edit" ? (
              <textarea
                aria-label="Markdown 日记"
                value={content}
                spellCheck={false}
                onChange={(event) => setContent(event.target.value)}
                placeholder={createDailyTemplate(selectedDate)}
              />
            ) : (
              <article className="markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </article>
            )}
          </div>
        </section>

        <div className="status-line">
          <span>{status}</span>
          {selectedEntry?.preview && <span>{selectedEntry.preview}</span>}
        </div>
      </main>
    </div>
  );
}

function EntryCard({
  entry,
  isSelected,
  onSelect,
}: {
  entry: WorklogEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn("entry-card", isSelected && "selected")}
      type="button"
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
    <main className="settings-window">
      <header
        className="settings-titlebar"
        data-tauri-drag-region
        onMouseDown={handleWindowDrag}
      >
        <div>
          <h1>设置</h1>
          <p>Worklog 偏好设置与应用信息</p>
        </div>
        <span className="settings-header-badge">
          <Settings size={15} />
          {appInfo.name}
        </span>
      </header>

      <div className="settings-content">
        <section className="settings-panel" aria-labelledby="settings-storage-title">
          <div className="settings-panel-heading">
            <span className="settings-icon">
              <FolderOpen size={18} />
            </span>
            <div>
              <h2 id="settings-storage-title">存储位置</h2>
              <p>daily 文件夹</p>
            </div>
          </div>
          <span className="settings-badge">本地</span>
        </section>

        <section className="settings-panel" aria-labelledby="settings-editor-title">
          <div className="settings-panel-heading">
            <span className="settings-icon">
              <BookOpen size={18} />
            </span>
            <div>
              <h2 id="settings-editor-title">编辑器</h2>
              <p>Markdown</p>
            </div>
          </div>
          <span className="settings-badge">预览</span>
        </section>

        <section
          className="settings-panel settings-about-panel"
          aria-labelledby="settings-about-title"
        >
          <div className="settings-panel-heading">
            <span className="settings-icon">
              <Info size={18} />
            </span>
            <div>
              <h2 id="settings-about-title">应用 About</h2>
              <p>{appInfo.name} 0.1.1</p>
            </div>
          </div>

          <div className="settings-info-grid">
            <div className="settings-info-item">
              <UserRound size={16} />
              <span>作者</span>
              <strong>{appInfo.author}</strong>
            </div>
            <div className="settings-info-item">
              <Mail size={16} />
              <span>邮箱</span>
              <strong>{appInfo.email}</strong>
            </div>
            <div className="settings-info-item wide">
              <Fingerprint size={16} />
              <span>Identifier</span>
              <strong>{appInfo.identifier}</strong>
            </div>
          </div>
        </section>
      </div>

      <footer className="settings-footer">
        <span>我的信息</span>
        <strong>{appInfo.author}</strong>
        <a href={`mailto:${appInfo.email}`}>
          <Mail size={14} />
          {appInfo.email}
        </a>
      </footer>
    </main>
  );
}
