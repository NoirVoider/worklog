# Worklog Sidebar Entry List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant sidebar list title, replace the fixed recent slice with an anchor-based lazy-loaded date window, and add a right-click delete flow that keeps the editor on the same day when the current entry is deleted.

**Architecture:** Keep the canonical source of truth as the existing date-sorted `entries` array, then derive a visible window around a computed anchor index instead of introducing a new data model. Add deletion as a small API extension end-to-end (`src/lib/api.ts` + Tauri command), and keep the UI lightweight by using a custom context menu plus a simple confirmation popover rendered inside `src/App.tsx`.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom, Tauri 2, Rust

---

## File Map

- Modify: `src/lib/worklog.ts`
  Responsibility: add pure helper functions for anchoring the visible sidebar window and expanding it during lazy loading.
- Modify: `src/lib/worklog.test.ts`
  Responsibility: lock the helper behavior with fast unit tests so the window math does not live only in UI tests.
- Modify: `src/lib/api.ts`
  Responsibility: add `deleteEntry(date)` to both mock and Tauri runtimes.
- Modify: `src-tauri/src/lib.rs`
  Responsibility: implement `delete_entry` and register it in the invoke handler.
- Modify: `src/App.tsx`
  Responsibility: remove the sidebar header, integrate the window helpers, render the custom context menu / confirmation UI, and refresh the editor correctly after deletion.
- Modify: `src/App.test.tsx`
  Responsibility: cover the lightweight end-to-end behavior in the rendered app.
- Modify: `src/styles.css`
  Responsibility: remove the sidebar header spacing and style the context menu / confirmation UI.

## Scope Notes

- Keep the list sorted by date. Do not add `created_at`, `updated_at`, or filesystem-metadata ordering.
- Do not build a virtual list.
- Keep tests focused on helper math, delete behavior, and one lazy-load path. Avoid large scrolling/performance suites.

### Task 1: Add Pure Sidebar Window Helpers

**Files:**
- Modify: `src/lib/worklog.ts`
- Test: `src/lib/worklog.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add these tests to `src/lib/worklog.test.ts`:

```ts
import {
  buildMonthGrid,
  buildVisibleEntryWindow,
  createDailyTemplate,
  expandVisibleEntryWindow,
  formatDateTitle,
  formatDateTitleParts,
  formatMonthLabel,
  normalizeEntries,
  shiftMonth,
} from "./worklog";

it("builds an initial window around the selected date anchor", () => {
  const entries = normalizeEntries(
    Array.from({ length: 40 }, (_, index) => {
      const day = String(40 - index).padStart(2, "0");
      return {
        date: `2026-06-${day}`,
        content: `entry ${day}`,
        exists: true,
      };
    }),
  );

  expect(
    buildVisibleEntryWindow(entries, "2026-06-20", { initialCount: 6 }),
  ).toEqual({ start: 17, end: 23, anchorIndex: 20 });
});

it("uses the insertion point when the selected date does not exist yet", () => {
  const entries = normalizeEntries([
    { date: "2026-06-25", content: "a", exists: true },
    { date: "2026-06-23", content: "b", exists: true },
    { date: "2026-06-20", content: "c", exists: true },
  ]);

  expect(
    buildVisibleEntryWindow(entries, "2026-06-24", { initialCount: 4 }),
  ).toEqual({ start: 0, end: 3, anchorIndex: 1 });
});

it("expands the window upward and downward in fixed chunks", () => {
  expect(
    expandVisibleEntryWindow(
      { start: 10, end: 20, anchorIndex: 15 },
      "forward",
      12,
      40,
    ),
  ).toEqual({ start: 0, end: 20, anchorIndex: 15 });

  expect(
    expandVisibleEntryWindow(
      { start: 10, end: 20, anchorIndex: 15 },
      "backward",
      12,
      40,
    ),
  ).toEqual({ start: 10, end: 32, anchorIndex: 15 });
});
```

- [ ] **Step 2: Run the helper tests to verify red**

Run:

```bash
npm test -- src/lib/worklog.test.ts -t "window"
```

Expected: FAIL because `buildVisibleEntryWindow` and `expandVisibleEntryWindow` do not exist yet.

- [ ] **Step 3: Implement the minimal helper functions**

Add these exports to `src/lib/worklog.ts`:

```ts
export type EntryWindow = {
  start: number;
  end: number;
  anchorIndex: number;
};

type EntryWindowOptions = {
  initialCount: number;
};

export function buildVisibleEntryWindow(
  entries: WorklogEntry[],
  selectedDate: string,
  options: EntryWindowOptions,
): EntryWindow {
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

function findEntryAnchorIndex(entries: WorklogEntry[], selectedDate: string): number {
  const existingIndex = entries.findIndex((entry) => entry.date === selectedDate);
  if (existingIndex >= 0) {
    return existingIndex;
  }

  const insertionIndex = entries.findIndex((entry) => entry.date < selectedDate);
  return insertionIndex >= 0 ? insertionIndex : Math.max(entries.length - 1, 0);
}
```

- [ ] **Step 4: Run the helper tests to verify green**

Run:

```bash
npm test -- src/lib/worklog.test.ts -t "window"
```

Expected: PASS with the new helper tests green.

### Task 2: Add Delete Entry API End-To-End

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing delete API tests**

Add this test to `src/App.test.tsx` near the other app behavior tests:

```tsx
it("removes a deleted entry from the mock API", async () => {
  await worklogApi.saveEntry("2026-06-24", "to be deleted");
  await worklogApi.deleteEntry("2026-06-24");

  const entries = await worklogApi.listEntries();
  const deleted = await worklogApi.readEntry("2026-06-24");

  expect(entries.find((entry) => entry.date === "2026-06-24")).toBeUndefined();
  expect(deleted.exists).toBe(false);
});
```

Add this Rust unit test to `src-tauri/src/lib.rs`:

```rust
#[test]
fn delete_entry_ignores_missing_file() {
    let root = tempfile::tempdir().unwrap();
    let file_path = entry_path(root.path(), "2026-07-02").unwrap();

    let result = delete_entry_file(&file_path);

    assert!(result.is_ok());
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/App.test.tsx -t "removes a deleted entry from the mock API"
cargo test delete_entry_ignores_missing_file
```

Expected:
- The Vitest slice fails because `deleteEntry` does not exist yet.
- The Rust test fails because `delete_entry_file` does not exist yet.

- [ ] **Step 3: Implement the minimal API and Rust deletion path**

Update `src/lib/api.ts`:

```ts
type WorklogApi = {
  listEntries: () => Promise<WorklogFile[]>;
  readEntry: (date: string) => Promise<WorklogFile>;
  saveEntry: (date: string, content: string) => Promise<WorklogFile>;
  createEntry: (date: string) => Promise<WorklogFile>;
  deleteEntry: (date: string) => Promise<void>;
  openSettings: () => Promise<void>;
  mainWindowReady: () => Promise<void>;
  settingsWindowReady: () => Promise<void>;
};

async deleteEntry(date) {
  mockEntries.delete(date);
}

deleteEntry: (date) => invoke<void>("delete_entry", { date }),
```

Update `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn delete_entry(app: AppHandle, date: String) -> Result<(), String> {
    let root = resolve_worklog_root(&app)?;
    let file_path = entry_path(&root, &date)?;
    delete_entry_file(&file_path)
}

fn delete_entry_file(file_path: &Path) -> Result<(), String> {
    if file_path.exists() {
        fs::remove_file(file_path).map_err(|error| error.to_string())?;
    }

    if let Some(parent) = file_path.parent() {
        match fs::remove_dir(parent) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(())
}
```

Register `delete_entry` in the invoke handler.

- [ ] **Step 4: Run the delete API tests to verify green**

Run:

```bash
npm test -- src/App.test.tsx -t "removes a deleted entry from the mock API"
cargo test delete_entry_ignores_missing_file
```

Expected: both commands PASS.

### Task 3: Implement Sidebar Windowing, Right-Click Menu, And Delete Flow

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing app behavior tests**

Add these tests to `src/App.test.tsx`:

```tsx
it("does not render the recent header and anchors the sidebar list around the selected date", async () => {
  vi.spyOn(worklogApi, "listEntries").mockResolvedValue(
    Array.from({ length: 40 }, (_, index) => {
      const day = String(40 - index).padStart(2, "0");
      return {
        date: `2026-06-${day}`,
        content: `entry ${day}`,
        exists: true,
      };
    }),
  );

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  expect(container.querySelector(".entry-list-header")).toBeNull();
  expect(container.querySelectorAll(".entry-card").length).toBe(24);
  expect(container.querySelector('.entry-card[aria-current="date"]')).not.toBeNull();
});

it("opens a delete menu on right click and keeps the editor on the same empty date after deletion", async () => {
  const deleteSpy = vi.spyOn(worklogApi, "deleteEntry");

  await worklogApi.saveEntry("2026-06-24", "today");

  await act(async () => {
    root.render(<App />);
  });
  await settleEffects();

  const currentCard = container.querySelector<HTMLButtonElement>('.entry-card[aria-current="date"]');

  await act(async () => {
    currentCard!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 220 }));
  });

  const deleteAction = container.querySelector<HTMLButtonElement>('[aria-label="删除这一天"]');
  expect(deleteAction).not.toBeNull();

  await act(async () => {
    deleteAction!.click();
  });

  const confirmDelete = container.querySelector<HTMLButtonElement>('[aria-label="确认删除这一天"]');

  await act(async () => {
    confirmDelete!.click();
  });
  await settleEffects();

  expect(deleteSpy).toHaveBeenCalledWith("2026-06-24");
  expect(container.querySelector(".empty-ribbon")?.textContent).toContain("这一天还没有日记");
  expect(container.querySelector(".entry-date-title")?.textContent).toContain("今天, 6月24日 周三");
});
```

- [ ] **Step 2: Run the focused app tests to verify red**

Run:

```bash
npm test -- src/App.test.tsx -t "delete menu"
npm test -- src/App.test.tsx -t "does not render the recent header"
```

Expected: FAIL because the header still renders, no context menu exists, and the list is still hard-coded to 8 items.

- [ ] **Step 3: Implement the minimal app state and UI**

In `src/App.tsx`, add lightweight state for the visible window and menu:

```tsx
const INITIAL_ENTRY_WINDOW = 24;
const ENTRY_WINDOW_CHUNK = 12;
const ENTRY_SCROLL_THRESHOLD = 120;

type EntryContextMenuState = {
  date: string;
  x: number;
  y: number;
} | null;

const [entryWindow, setEntryWindow] = useState<EntryWindow>({ start: 0, end: 0, anchorIndex: 0 });
const [contextMenu, setContextMenu] = useState<EntryContextMenuState>(null);
const [pendingDeleteDate, setPendingDeleteDate] = useState<string | null>(null);

const visibleEntries = normalizedEntries.slice(entryWindow.start, entryWindow.end);
```

Add effects and handlers:

```tsx
useEffect(() => {
  setEntryWindow(
    buildVisibleEntryWindow(normalizedEntries, selectedDate, {
      initialCount: INITIAL_ENTRY_WINDOW,
    }),
  );
}, [normalizedEntries, selectedDate]);

const handleEntriesScroll = (event: UIEvent<HTMLDivElement>) => {
  const element = event.currentTarget;
  if (element.scrollTop <= ENTRY_SCROLL_THRESHOLD && entryWindow.start > 0) {
    const previousHeight = element.scrollHeight;
    setEntryWindow((current) =>
      expandVisibleEntryWindow(current, "forward", ENTRY_WINDOW_CHUNK, normalizedEntries.length),
    );
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - previousHeight;
    });
  }

  if (
    element.scrollHeight - element.scrollTop - element.clientHeight <= ENTRY_SCROLL_THRESHOLD &&
    entryWindow.end < normalizedEntries.length
  ) {
    setEntryWindow((current) =>
      expandVisibleEntryWindow(current, "backward", ENTRY_WINDOW_CHUNK, normalizedEntries.length),
    );
  }
};

const handleEntryContextMenu = (entry: WorklogEntry, event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
  setContextMenu({ date: entry.date, x: event.clientX, y: event.clientY });
};

const handleDeleteEntry = async () => {
  if (!pendingDeleteDate) return;
  setContextMenu(null);
  setPendingDeleteDate(null);
  await worklogApi.deleteEntry(pendingDeleteDate);
  await refreshEntries();

  if (pendingDeleteDate === selectedDate) {
    await loadEntry(selectedDate);
  }
};
```

Render the list without the header and add menu / confirmation markup:

```tsx
<section className="entry-list" aria-label="日期列表">
  <div className="entries-scroll" onScroll={handleEntriesScroll}>
    {visibleEntries.map((entry) => (
      <EntryCard
        entry={entry}
        isSelected={entry.date === selectedDate}
        key={entry.date}
        onContextMenu={handleEntryContextMenu}
        onSelect={() => handleSelectDate(entry.date)}
      />
    ))}
  </div>
</section>

{contextMenu ? (
  <div className="entry-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
    <button
      type="button"
      aria-label="删除这一天"
      onClick={() => setPendingDeleteDate(contextMenu.date)}
    >
      删除这一天
    </button>
  </div>
) : null}

{pendingDeleteDate ? (
  <div className="entry-delete-confirm">
    <p>{`删除 ${pendingDeleteDate}？此操作不可恢复`}</p>
    <button type="button" onClick={() => setPendingDeleteDate(null)}>
      取消
    </button>
    <button
      type="button"
      aria-label="确认删除这一天"
      onClick={() => void handleDeleteEntry()}
    >
      删除
    </button>
  </div>
) : null}
```

Update `EntryCard` to accept `onContextMenu`.

In `src/styles.css`, remove the `.entry-list-header` block and add only the minimal menu / confirm styles:

```css
.entry-list {
  padding: 12px 18px 12px;
}

.entries-scroll {
  padding: 4px 7px 12px 6px;
}

.entry-context-menu {
  position: fixed;
  z-index: 30;
  min-width: 132px;
  border: 1px solid rgba(207, 213, 220, 0.88);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 28px rgba(30, 36, 42, 0.18);
  padding: 6px;
}

.entry-delete-confirm {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
}
```

- [ ] **Step 4: Run the focused app tests to verify green**

Run:

```bash
npm test -- src/App.test.tsx -t "delete menu"
npm test -- src/App.test.tsx -t "does not render the recent header"
```

Expected: PASS with the new list-window and delete-flow behavior covered.

## Final Verification Commands

Run:

```bash
npm test -- src/lib/worklog.test.ts -t "window"
npm test -- src/App.test.tsx -t "delete menu"
npm test -- src/App.test.tsx -t "does not render the recent header"
npm test -- src/App.test.tsx -t "removes a deleted entry from the mock API"
cargo test delete_entry_ignores_missing_file
```

Expected: all commands PASS.
