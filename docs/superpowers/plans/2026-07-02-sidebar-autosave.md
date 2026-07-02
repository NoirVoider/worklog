# Sidebar Overlay And Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Worklog sidebar to a transform-driven overlay and replace the explicit save button with after-delay autosave plus flush-on-navigation lifecycle handling.

**Architecture:** Keep the editor surface layout stable by moving the sidebar to an absolutely positioned layer that toggles via data attributes and transform transitions. Centralize document persistence in `src/App.tsx` with a small autosave/flush state machine backed by request IDs so delayed saves, date switches, blur, and close events all share one consistent write path.

**Tech Stack:** React 19 + TypeScript, Vitest + JSDOM, Tauri window API, plain CSS in `src/styles.css`

---

## File Map

- Modify: `src/App.tsx`
  Purpose: sidebar DOM/state refactor, autosave state machine, guarded read/write flow, blur/close listeners, save button removal.
- Modify: `src/styles.css`
  Purpose: replace width-based sidebar motion with overlay transform transitions, keep reveal button mounted, remove dead save button styles, add reduced-motion branch.
- Modify: `src/App.test.tsx`
  Purpose: lock the sidebar motion contract, cover after-delay autosave, verify pre-navigation flush and blur-triggered flush behavior.

### Task 1: Lock The Sidebar Overlay Contract

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing sidebar motion regression test**

```tsx
describe("sidebar overlay motion", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("keeps the sidebar mounted and drives collapse with transform instead of width", () => {
    expect(appSource).not.toMatch(/\{!sidebarOpen && \(/);
    expect(appSource).toMatch(
      /data-sidebar-state=\{sidebarOpen \? "open" : "closed"\}/,
    );
    expect(appSource).toMatch(
      /data-reveal-visible=\{String\(!sidebarOpen\)\}/,
    );

    expect(styles).toMatch(/\.app-shell\s*\{[\s\S]*position:\s*relative;/);
    expect(styles).not.toMatch(/\.app-shell\s*\{[\s\S]*grid-template-columns:/);
    expect(styles).toMatch(/\.sidebar\s*\{[\s\S]*position:\s*absolute;/);
    expect(styles).toMatch(
      /\.sidebar\s*\{[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/,
    );
    expect(styles).toMatch(
      /\.sidebar\[data-sidebar-state="closed"\]\s*\{[\s\S]*transform:\s*translate3d\(-100%,\s*0,\s*0\);/,
    );
    expect(styles).not.toMatch(/\.sidebar-collapsed\s*\{[\s\S]*width:\s*0;/);
    expect(styles).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.sidebar[\s\S]*transition:\s*none;/,
    );
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails for the current implementation**

Run: `npm test -- src/App.test.tsx`

Expected: FAIL because `src/App.tsx` still conditionally renders the reveal button and `src/styles.css` still animates `width/min-width`.

- [ ] **Step 3: Implement the overlay sidebar markup and transform-based CSS**

`src/App.tsx`

```tsx
return (
  <div className="app-shell">
    <button
      className="sidebar-toggle-floating"
      data-reveal-visible={String(!sidebarOpen)}
      type="button"
      aria-label="展开侧栏"
      title="展开侧栏"
      onClick={() => setSidebarOpen(true)}
    >
      <PanelLeft size={18} />
    </button>

    <aside
      className="sidebar"
      data-sidebar-state={sidebarOpen ? "open" : "closed"}
    >
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

      <div className="sidebar-body">
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
  </div>
);
```

Keep the current `<main className="main-surface">...</main>` subtree immediately after the overlay `<aside>`; Task 2 will edit the header inside it.

`src/styles.css`

```css
.app-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--app-boot-bg);
  color: #24272b;
}

.sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  width: 288px;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(76, 84, 94, 0.1);
  background: rgba(246, 248, 251, 0.36);
  box-shadow:
    inset -1px 0 rgba(255, 255, 255, 0.24),
    inset 1px 0 rgba(255, 255, 255, 0.14);
  transform: translate3d(0, 0, 0);
  will-change: transform;
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 140ms ease;
}

.sidebar[data-sidebar-state="closed"] {
  transform: translate3d(-100%, 0, 0);
  opacity: 0.98;
  pointer-events: none;
}

.sidebar-titlebar,
.sidebar-body {
  min-width: 0;
}

.sidebar-toggle-floating {
  position: absolute;
  top: 13px;
  left: 100px;
  z-index: 4;
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(-8px, 0, 0);
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sidebar-toggle-floating[data-reveal-visible="true"] {
  opacity: 1;
  pointer-events: auto;
  transform: translate3d(0, 0, 0);
}

@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .sidebar-toggle-floating {
    transition: none;
  }
}
```

- [ ] **Step 4: Re-run the targeted test and confirm the new motion contract passes**

Run: `npm test -- src/App.test.tsx`

Expected: PASS for the new `sidebar overlay motion` test and the pre-existing sidebar styling assertions.

- [ ] **Step 5: Commit the overlay refactor checkpoint**

```bash
git add src/App.tsx src/styles.css src/App.test.tsx
git commit -m "feat: switch sidebar to overlay motion"
```

### Task 2: Add After-Delay Autosave And Remove The Save Button

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing autosave regression test**

```tsx
it("autosaves after 600ms idle time and removes the explicit save button", async () => {
  const originalSave = worklogApi.saveEntry.bind(worklogApi);
  const saveSpy = vi.spyOn(worklogApi, "saveEntry").mockImplementation(originalSave);

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  expect(container.querySelector('[aria-label="保存日记"]')).toBeNull();

  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown 日记"]',
  );

  await act(async () => {
    textarea!.value = "今天写点内容";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    textarea!.value = "今天写点最终内容";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(saveSpy).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(599);
  });
  expect(saveSpy).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await settleEffects();

  expect(saveSpy).toHaveBeenCalledTimes(1);
  expect(saveSpy).toHaveBeenLastCalledWith("2026-06-24", "今天写点最终内容");
  expect(container.querySelector(".status-line")?.textContent).toContain("已自动保存");
});
```

- [ ] **Step 2: Run the autosave test and verify it fails on the current button-based flow**

Run: `npm test -- src/App.test.tsx -t "autosaves after 600ms idle time and removes the explicit save button"`

Expected: FAIL because the save button still renders and no delayed `saveEntry` call happens after the timer advances.

- [ ] **Step 3: Add autosave state, delayed flush, and remove the save button markup**

`src/App.tsx`

```tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

const AUTOSAVE_DELAY_MS = 600;
const SAVE_STATUS_COOLDOWN_MS = 1500;

type StatusMessage =
  | "就绪"
  | "读取中"
  | "未创建"
  | "未保存更改"
  | "自动保存中"
  | "已自动保存"
  | "自动保存失败";

type FlushReason = "autosave" | "shortcut" | "date-change" | "blur" | "window-close";

const autosaveTimerRef = useRef<number | null>(null);
const statusCooldownTimerRef = useRef<number | null>(null);
const saveRequestIdRef = useRef(0);
const saveInFlightRef = useRef(false);
const queuedFlushRef = useRef(false);
const selectedDateRef = useRef(selectedDate);
const latestContentRef = useRef("");
const lastPersistedContentRef = useRef("");

const [status, setStatus] = useState<StatusMessage>("就绪");

useEffect(() => {
  selectedDateRef.current = selectedDate;
}, [selectedDate]);

useEffect(() => {
  latestContentRef.current = content;
}, [content]);

const clearAutosaveTimer = useCallback(() => {
  if (autosaveTimerRef.current !== null) {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }
}, []);

const clearStatusCooldown = useCallback(() => {
  if (statusCooldownTimerRef.current !== null) {
    window.clearTimeout(statusCooldownTimerRef.current);
    statusCooldownTimerRef.current = null;
  }
}, []);

const flushEntry = useCallback(async (_reason: FlushReason) => {
  const nextContent = latestContentRef.current;
  if (nextContent === lastPersistedContentRef.current) {
    return true;
  }

  if (saveInFlightRef.current) {
    queuedFlushRef.current = true;
    return true;
  }

  const requestId = ++saveRequestIdRef.current;
  saveInFlightRef.current = true;
  queuedFlushRef.current = false;
  setError(null);
  setIsSaving(true);
  clearAutosaveTimer();
  clearStatusCooldown();
  setStatus("自动保存中");

  try {
    const saved = await worklogApi.saveEntry(selectedDateRef.current, nextContent);
    if (requestId !== saveRequestIdRef.current) {
      return true;
    }

    setCurrentEntry(saved);
    lastPersistedContentRef.current = saved.content;
    latestContentRef.current = saved.content;
    await refreshEntries();
    setStatus("已自动保存");
    statusCooldownTimerRef.current = window.setTimeout(() => {
      setStatus("就绪");
    }, SAVE_STATUS_COOLDOWN_MS);
    const shouldReplay =
      queuedFlushRef.current &&
      latestContentRef.current !== lastPersistedContentRef.current;
    queuedFlushRef.current = false;
    saveInFlightRef.current = false;
    setIsSaving(false);

    if (shouldReplay) {
      return flushEntry("autosave");
    }

    return true;
  } catch (reason) {
    if (requestId === saveRequestIdRef.current) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("自动保存失败");
    }
    queuedFlushRef.current = false;
    saveInFlightRef.current = false;
    setIsSaving(false);
    return false;
  }
}, [clearAutosaveTimer, clearStatusCooldown, refreshEntries]);

const handleContentChange = useCallback((nextContent: string) => {
  clearStatusCooldown();
  latestContentRef.current = nextContent;
  setContent(nextContent);
  setStatus(
    nextContent === lastPersistedContentRef.current ? "就绪" : "未保存更改",
  );
}, [clearStatusCooldown]);

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
```

Update the editor header to remove the save button and wire the textarea into `handleContentChange`:

```tsx
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
</div>

<textarea
  aria-label="Markdown 日记"
  value={content}
  spellCheck={false}
  onChange={(event) => handleContentChange(event.target.value)}
  placeholder={createDailyTemplate(selectedDate)}
/>
```

`src/styles.css`

```css
.icon-button.ghost:active,
.icon-button.soft:active,
.date-control-button:active,
.date-picker-trigger:active,
.pill-button:active {
  background: rgba(225, 229, 234, 0.72);
}

.pill-button {
  display: inline-flex;
  min-width: 0;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(195, 202, 210, 0.44);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
  padding: 0 18px;
  color: #343941;
  font-size: 15px;
  font-weight: 720;
  box-shadow: 0 4px 12px rgba(40, 48, 56, 0.05);
}
```

- [ ] **Step 4: Re-run the autosave test to verify the red-green cycle**

Run: `npm test -- src/App.test.tsx -t "autosaves after 600ms idle time and removes the explicit save button"`

Expected: PASS with one delayed `saveEntry` call after `600ms`, no save button in the DOM, and the status line showing `已自动保存`.

- [ ] **Step 5: Commit the autosave core**

```bash
git add src/App.tsx src/styles.css src/App.test.tsx
git commit -m "feat: autosave editor drafts after idle delay"
```

### Task 3: Flush Before Navigation And Guard Reads/Writes

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing date-switch flush tests**

At the top of `src/App.test.tsx`, extend the imports with:

```tsx
import { type WorklogFile } from "./lib/worklog";
```

```tsx
it("flushes the current draft before switching dates", async () => {
  const originalSave = worklogApi.saveEntry.bind(worklogApi);
  const saveSpy = vi.spyOn(worklogApi, "saveEntry").mockImplementation(originalSave);

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown 日记"]',
  );
  await act(async () => {
    textarea!.value = "切日前的草稿";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const nextDayButton = container.querySelector<HTMLButtonElement>(
    '.date-control-button[aria-label="后一天"]',
  );
  await act(async () => {
    nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settleEffects();

  expect(saveSpy).toHaveBeenCalledWith("2026-06-24", "切日前的草稿");
  expect(container.querySelector(".entry-date-title")?.textContent).toContain(
    "明天, 6月25日 周四",
  );
});

it("stays on the current date when the pre-switch flush fails", async () => {
  const originalSave = worklogApi.saveEntry.bind(worklogApi);
  vi.spyOn(worklogApi, "saveEntry")
    .mockRejectedValueOnce(new Error("disk full"))
    .mockImplementation(originalSave);

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown 日记"]',
  );
  await act(async () => {
    textarea!.value = "失败时不能切走";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const nextDayButton = container.querySelector<HTMLButtonElement>(
    '.date-control-button[aria-label="后一天"]',
  );
  await act(async () => {
    nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settleEffects();

  expect(container.querySelector(".entry-date-title")?.textContent).toContain(
    "今天, 6月24日 周三",
  );
  expect(container.querySelector(".error-ribbon")?.textContent).toContain("disk full");
});

it("ignores stale read results when an older request resolves after a newer selection", async () => {
  type DeferredRead = {
    resolve: (value: WorklogFile) => void;
    promise: Promise<WorklogFile>;
  };

  const originalRead = worklogApi.readEntry.bind(worklogApi);
  const deferredReads = new Map<string, DeferredRead>();

  vi.spyOn(worklogApi, "readEntry").mockImplementation((date) => {
    if (date === "2026-06-25" || date === "2026-06-26") {
      const deferred = deferredReads.get(date) ?? (() => {
        let resolve!: (value: WorklogFile) => void;
        const promise = new Promise<WorklogFile>((fulfill) => {
          resolve = fulfill;
        });
        const next = { resolve, promise };
        deferredReads.set(date, next);
        return next;
      })();

      return deferred.promise;
    }

    return originalRead(date);
  });

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  const nextDayButton = container.querySelector<HTMLButtonElement>(
    '.date-control-button[aria-label="后一天"]',
  );

  await act(async () => {
    nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await act(async () => {
    deferredReads.get("2026-06-26")!.resolve({
      date: "2026-06-26",
      content: "最终展示的是最新日期",
      exists: true,
    });
    await Promise.resolve();
    deferredReads.get("2026-06-25")!.resolve({
      date: "2026-06-25",
      content: "这个旧结果不应该覆盖新结果",
      exists: true,
    });
    await Promise.resolve();
  });
  await settleEffects();

  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 日记"]')?.value,
  ).toBe("最终展示的是最新日期");
  expect(container.querySelector(".entry-date-title")?.textContent).toContain(
    "6月26日 周五",
  );
});
```

- [ ] **Step 2: Run the navigation tests and verify they fail before the guarded flow exists**

Run: `npm test -- src/App.test.tsx -t "flushes the current draft before switching dates|stays on the current date when the pre-switch flush fails|ignores stale read results when an older request resolves after a newer selection"`

Expected: FAIL because date changes currently happen synchronously without awaiting any flush and stale read responses can still overwrite newer selections.

- [ ] **Step 3: Add guarded reads, guarded saves, and async date selection**

`src/App.tsx`

```tsx
const loadRequestIdRef = useRef(0);

const applyLoadedEntry = useCallback((file: WorklogFile) => {
  clearAutosaveTimer();
  clearStatusCooldown();
  setCurrentEntry(file);
  setContent(file.content);
  latestContentRef.current = file.content;
  lastPersistedContentRef.current = file.content;
  setStatus(file.exists ? "就绪" : "未创建");
}, [clearAutosaveTimer, clearStatusCooldown]);

const loadEntry = useCallback(async (date: string) => {
  const requestId = ++loadRequestIdRef.current;
  setError(null);
  setStatus("读取中");
  const file = await worklogApi.readEntry(date);
  if (requestId !== loadRequestIdRef.current) {
    return;
  }
  applyLoadedEntry(file);
}, [applyLoadedEntry]);

const selectDate = useCallback(async (date: string) => {
  const ok = await flushEntry("date-change");
  if (!ok) {
    return;
  }
  setSelectedDate(date);
  setViewDate(date);
}, [flushEntry]);

const moveDate = (amount: number) => {
  void selectDate(shiftDate(selectedDate, amount));
};

const handleCalendarSelect = (date?: Date) => {
  if (!date) {
    return;
  }
  void selectDate(format(date, "yyyy-MM-dd"));
  setDatePickerOpen(false);
};

const handleCreate = async (date = selectedDate) => {
  setError(null);
  setStatus("创建中");
  const file = await worklogApi.createEntry(date);
  setSelectedDate(date);
  setViewDate(date);
  applyLoadedEntry(file);
  await refreshEntries();
};
```

Update every sidebar and recent-entry click target to use the async selector:

```tsx
onClick={() => void selectDate(day.date)}
onSelect={() => void selectDate(entry.date)}
onClick={() => void selectDate(todayIso())}
```

- [ ] **Step 4: Re-run the navigation tests to verify the guarded flow passes**

Run: `npm test -- src/App.test.tsx -t "flushes the current draft before switching dates|stays on the current date when the pre-switch flush fails|ignores stale read results when an older request resolves after a newer selection"`

Expected: PASS with one `saveEntry` call before navigation, failed flushes keeping the current date visible, and stale reads ignored in favor of the newest selection.

- [ ] **Step 5: Commit the guarded navigation flow**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: flush drafts before switching dates"
```

### Task 4: Flush On Blur And Verify The Whole Slice

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing blur-triggered flush regression test**

```tsx
it("flushes pending content when the window loses focus", async () => {
  const originalSave = worklogApi.saveEntry.bind(worklogApi);
  const saveSpy = vi.spyOn(worklogApi, "saveEntry").mockImplementation(originalSave);

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown 日记"]',
  );
  await act(async () => {
    textarea!.value = "失焦也要写盘";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    window.dispatchEvent(new Event("blur"));
  });
  await settleEffects();

  expect(saveSpy).toHaveBeenCalledWith("2026-06-24", "失焦也要写盘");
});
```

- [ ] **Step 2: Run the blur test and verify it fails without the lifecycle hook**

Run: `npm test -- src/App.test.tsx -t "flushes pending content when the window loses focus"`

Expected: FAIL because there is no blur handler invoking the shared flush path yet.

- [ ] **Step 3: Add blur and close-request lifecycle hooks that reuse `flushEntry`**

`src/App.tsx`

```tsx
useEffect(() => {
  const handleWindowBlur = () => {
    void flushEntry("blur");
  };

  window.addEventListener("blur", handleWindowBlur);

  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
    };
  }

  const currentWindow = getCurrentWindow();
  let unlistenClose: (() => void) | undefined;

  void currentWindow.onCloseRequested(async (event) => {
    const ok = await flushEntry("window-close");
    if (!ok) {
      event.preventDefault();
    }
  }).then((dispose) => {
    unlistenClose = dispose;
  });

  return () => {
    window.removeEventListener("blur", handleWindowBlur);
    unlistenClose?.();
  };
}, [flushEntry]);

useEffect(() => {
  return () => {
    clearAutosaveTimer();
    clearStatusCooldown();
  };
}, [clearAutosaveTimer, clearStatusCooldown]);
```

- [ ] **Step 4: Run the full test and build verification suite**

Run: `npm test`
Expected: PASS with all Vitest suites green.

Run: `npm run build`
Expected: PASS with TypeScript and Vite build completing without errors.

- [ ] **Step 5: Commit the lifecycle flush and verification checkpoint**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: flush autosave on blur and close"
```

## Self-Review

### Spec Coverage

- Sidebar must feel like a sliding layer: covered by Task 1 overlay DOM + transform CSS.
- Sidebar and reveal control stay mounted: covered by Task 1 markup and test assertions.
- Save button removed and `afterDelay` autosave added: covered by Task 2.
- Flush before date changes and on focus loss / close: covered by Tasks 3 and 4.
- Failed saves must keep content and block navigation: covered by Task 3 tests and guarded `flushEntry`.
- Reduced motion support: covered by Task 1 CSS.

### Placeholder Scan

- No placeholder markers remain in the implementation steps.
- Every code-changing step includes concrete code blocks.
- Every verification step includes an exact command and expected result.

### Type Consistency

- `StatusMessage` is the only status union referenced by later tasks.
- `flushEntry`, `selectDate`, `applyLoadedEntry`, and `loadEntry` keep the same names across all tasks.
- The same `AUTOSAVE_DELAY_MS = 600` and `SAVE_STATUS_COOLDOWN_MS = 1500` constants are used throughout the plan.
