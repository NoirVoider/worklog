# Worklog Minimal Save Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom-left autosave text with a quiet icon-only indicator that uses English internal state identifiers, shows a micro spinner while background work is pending, and only surfaces a warning icon on save failure.

**Architecture:** Keep the existing autosave pipeline in `src/App.tsx`, but swap the Chinese string-union state values for stable English identifiers and route them through a tiny `getStatusIndicator` helper. Remove the success cooldown path so saves return directly to a silent `idle` state, and restyle the existing `.status-line` slot into a 12px icon container instead of a text footer.

**Tech Stack:** React 19, TypeScript, Lucide React, CSS, Vitest, jsdom

---

## Scope And Baseline

- This plan implements only the minimal save indicator spec in `docs/superpowers/specs/2026-07-02-minimal-save-indicator-design.md`.
- Do not expand scope to fix the unrelated date-switch/read-order autosave regressions that already exist in `src/App.test.tsx`; keep verification focused on the status-indicator tests added here plus the existing autosave smoke path.
- Preserve the current autosave debounce (`600ms`), dirty tracking, and save request flow. The work here is about state semantics and UI presentation, not new persistence behavior.

## File Map

- Modify: `src/App.tsx`
  Responsibility: convert status values to English identifiers, remove success cooldown handling, derive a single icon descriptor, and render the bottom status slot as icon-only UI with accessibility labels.
- Modify: `src/App.test.tsx`
  Responsibility: lock the new icon-only behavior in focused status-indicator tests, update the existing autosave smoke expectation to silent-success behavior, and add a CSS contract test for the micro-indicator slot.
- Modify: `src/styles.css`
  Responsibility: turn `.status-line` into a compact 12px indicator slot and add the spinner / warning icon rules and spin keyframes.

## Implementation Notes

- Keep `saved` in the `StatusMessage` union for semantic completeness, but do not visibly linger in that state after save success.
- Add a helper such as `getBaseStatus(file: WorklogFile | null): StatusMessage` so unchanged content on a missing entry returns to `empty`, while unchanged content on an existing entry returns to `idle`.
- Add a helper such as `getStatusIndicator(status: StatusMessage)` that returns either a spinner descriptor, a warning descriptor, or `null`.
- Use Lucide icons already in the codebase. `LoaderCircle` and `CircleAlert` are sufficient.

### Task 1: Convert Status Logic And Lock Icon-Only Behavior

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing status-indicator tests**

Add a focused `describe("status indicator", ...)` block inside `src/App.test.tsx` and update the existing autosave smoke test so the new behavior is explicit:

```tsx
it("autosaves after 600ms idle time and hides the footer indicator once save completes", async () => {
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
    typeIntoTextarea(textarea!, "今天写点最终内容");
  });

  expect(container.querySelector('[aria-label="Pending changes"]')).not.toBeNull();
  expect(container.querySelector(".status-line")?.textContent).toBe("");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settleEffects();

  expect(saveSpy).toHaveBeenCalledWith("2026-06-24", "今天写点最终内容");
  expect(container.querySelector('[aria-label="Pending changes"]')).toBeNull();
  expect(container.querySelector('[aria-label="Saving"]')).toBeNull();
  expect(container.querySelector('[aria-label="Save failed"]')).toBeNull();
});

describe("status indicator", () => {
  it("keeps the footer free of visible status text", async () => {
    vi.spyOn(worklogApi, "listEntries").mockResolvedValue([
      { date: "2026-06-24", content: "今天的预览文字", exists: true },
    ]);
    vi.spyOn(worklogApi, "readEntry").mockResolvedValue({
      date: "2026-06-24",
      content: "今天的预览文字",
      exists: true,
    });

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    expect(container.querySelector(".status-line")?.textContent).toBe("");
    expect(container.querySelector('[aria-label="Loading entry"]')).toBeNull();
  });

  it("shows a spinner while content is dirty before the debounce fires", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "正在等待自动保存");
    });

    expect(container.querySelector('[aria-label="Pending changes"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Saving"]')).toBeNull();
  });

  it("renders a warning icon when autosave fails", async () => {
    vi.spyOn(worklogApi, "saveEntry").mockRejectedValueOnce(new Error("disk full"));

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "失败后出现 warning");
      await vi.advanceTimersByTimeAsync(600);
    });
    await settleEffects();

    const warning = container.querySelector('[aria-label="Save failed"]');

    expect(warning).not.toBeNull();
    expect(warning?.getAttribute("title")).toBe("Save failed");
    expect(container.querySelector(".status-line")?.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail on the current text-based footer**

Run:

```bash
npm test -- src/App.test.tsx -t "status indicator"
```

Expected: FAIL because `src/App.tsx` still renders Chinese text inside `.status-line` and does not expose the new English icon labels.

- [ ] **Step 3: Implement the English status model and icon-only footer in `src/App.tsx`**

Replace the Chinese string-union values, remove the success cooldown timer path, and render the footer from a status descriptor:

```tsx
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
  Sparkles,
  UserRound,
} from "lucide-react";

type StatusMessage =
  | "idle"
  | "loading"
  | "empty"
  | "pending"
  | "saving"
  | "saved"
  | "failed"
  | "creating";

type StatusIndicator =
  | { kind: "spinner"; label: "Loading entry" | "Creating entry" | "Pending changes" | "Saving" }
  | { kind: "warning"; label: "Save failed"; title: "Save failed" }
  | null;

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
```

Update the status transitions to use the new identifiers and remove `SAVE_STATUS_COOLDOWN_MS`, `statusCooldownTimerRef`, and `clearStatusCooldown` entirely:

```tsx
const [status, setStatus] = useState<StatusMessage>("idle");

const flushEntry = useCallback(async (_reason: FlushReason) => {
  if (latestContentRef.current === lastPersistedContentRef.current) {
    clearAutosaveTimer();
    setStatus(getBaseStatus(currentEntry));
    return true;
  }

  if (saveInFlightRef.current) {
    queuedFlushRef.current = true;
    return true;
  }

  clearAutosaveTimer();

  while (latestContentRef.current !== lastPersistedContentRef.current) {
    const snapshotDate = selectedDateRef.current;
    const snapshotContent = latestContentRef.current;

    saveInFlightRef.current = true;
    queuedFlushRef.current = false;
    setError(null);
    setIsSaving(true);
    setStatus("saving");

    try {
      const saved = await worklogApi.saveEntry(snapshotDate, snapshotContent);

      if (selectedDateRef.current === snapshotDate) {
        setCurrentEntry(saved);
      }
      lastPersistedContentRef.current = saved.content;
      await refreshEntries();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("failed");
      queuedFlushRef.current = false;
      saveInFlightRef.current = false;
      setIsSaving(false);
      return false;
    }

    const shouldReplay =
      queuedFlushRef.current ||
      latestContentRef.current !== lastPersistedContentRef.current;

    queuedFlushRef.current = false;
    saveInFlightRef.current = false;
    setIsSaving(false);

    if (!shouldReplay) {
      setStatus("idle");
      return true;
    }
  }

  return true;
}, [clearAutosaveTimer, currentEntry, refreshEntries]);

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

const handleCreate = async (date = selectedDate) => {
  setError(null);
  setStatus("creating");
  const file = await worklogApi.createEntry(date);
  setSelectedDate(date);
  setViewDate(date);
  setCurrentEntry(file);
  setContent(file.content);
  latestContentRef.current = file.content;
  lastPersistedContentRef.current = file.content;
  await refreshEntries();
  setStatus("idle");
};

const handleContentChange = useCallback((nextContent: string) => {
  latestContentRef.current = nextContent;
  setContent(nextContent);
  setStatus(
    nextContent === lastPersistedContentRef.current
      ? getBaseStatus(currentEntry)
      : "pending",
  );
}, [currentEntry]);
```

Render the footer as icon-only UI with an accessible status container:

```tsx
const statusIndicator = getStatusIndicator(status);

<div className="status-line" role="status" aria-live="polite">
  {statusIndicator?.kind === "spinner" ? (
    <LoaderCircle
      className="status-indicator status-indicator-spinning"
      size={12}
      aria-label={statusIndicator.label}
    />
  ) : statusIndicator?.kind === "warning" ? (
    <CircleAlert
      className="status-indicator status-indicator-failed"
      size={12}
      aria-label={statusIndicator.label}
      title={statusIndicator.title}
    />
  ) : null}
</div>
```

- [ ] **Step 4: Run the focused status-indicator tests to verify they pass**

Run:

```bash
npm test -- src/App.test.tsx -t "status indicator"
```

Expected: PASS with the new icon-only indicator tests green and no Chinese footer text assertions left in this test slice.

- [ ] **Step 5: Commit the behavior change**

Run:

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: switch autosave footer to icon indicator"
```

### Task 2: Restyle The Footer As A Quiet 12px Indicator Slot

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add a failing CSS contract test for the micro-indicator slot**

Extend the style assertions in `src/App.test.tsx` with a dedicated footer-indicator contract:

```tsx
describe("status indicator styling", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  it("keeps the footer indicator as a single 12px slot with a gentle spinner", () => {
    const statusRule = styles.match(/\.status-line\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const indicatorRule = styles.match(/\.status-indicator\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const spinnerRule =
      styles.match(/\.status-indicator-spinning\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const failedRule =
      styles.match(/\.status-indicator-failed\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(statusRule).toMatch(/width:\s*12px;/);
    expect(statusRule).toMatch(/height:\s*12px;/);
    expect(statusRule).toMatch(/justify-content:\s*center;/);
    expect(statusRule).not.toMatch(/font-size:/);
    expect(indicatorRule).toMatch(/width:\s*12px;/);
    expect(indicatorRule).toMatch(/height:\s*12px;/);
    expect(spinnerRule).toMatch(/animation:\s*status-indicator-spin 1\.1s linear infinite;/);
    expect(failedRule).toMatch(/color:\s*rgba\(168,\s*83,\s*71,\s*0\.86\);/);
    expect(styles).toMatch(/@keyframes status-indicator-spin/);
  });
});
```

- [ ] **Step 2: Run the styling test to verify it fails before the CSS exists**

Run:

```bash
npm test -- src/App.test.tsx -t "status indicator styling"
```

Expected: FAIL because `.status-line` is still a text footer and the new `.status-indicator*` CSS rules are missing.

- [ ] **Step 3: Replace the old text-footer CSS with a compact icon slot**

Update `src/styles.css` so the footer becomes a quiet single-icon position and add the icon classes referenced above:

```css
.status-line {
  position: absolute;
  right: 22px;
  bottom: 16px;
  display: flex;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  color: rgba(101, 108, 118, 0.54);
}

.status-indicator {
  width: 12px;
  height: 12px;
  flex: none;
}

.status-indicator-spinning {
  animation: status-indicator-spin 1.1s linear infinite;
}

.status-indicator-failed {
  color: rgba(168, 83, 71, 0.86);
}

@keyframes status-indicator-spin {
  to {
    transform: rotate(360deg);
  }
}
```

Delete the old `.status-line span` rule entirely, since the footer no longer renders visible text nodes.

- [ ] **Step 4: Run the focused status-indicator verification slice**

Run:

```bash
npm test -- src/App.test.tsx -t "status indicator"
```

Expected: PASS with both the behavior and styling assertions green for the new footer indicator.

- [ ] **Step 5: Commit the styling polish**

Run:

```bash
git add src/App.test.tsx src/styles.css
git commit -m "style: polish minimal save indicator"
```

## Final Verification Commands

Run these commands after both tasks are complete:

```bash
npm test -- src/App.test.tsx -t "status indicator"
npm test -- src/App.test.tsx -t "autosaves after 600ms idle time and hides the footer indicator once save completes"
```

Expected:

- The first command passes all focused status-indicator behavior and styling checks.
- The second command passes the autosave smoke path and confirms silent success after a save.

## Self-Review Checklist

- Every spec requirement in `docs/superpowers/specs/2026-07-02-minimal-save-indicator-design.md` maps to one of the two tasks above.
- No task introduces visible success copy or a second status icon.
- `saved` remains in the state model for semantic completeness, but the runtime path returns directly to `idle`.
- Verification stays scoped to the new indicator tests and the autosave smoke path, rather than pulling unrelated pre-existing red tests into this change.
