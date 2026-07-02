/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { worklogApi } from "./lib/api";
import { type WorklogFile } from "./lib/worklog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settleEffects() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function typeIntoTextarea(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("worklog api", () => {
  it("removes a deleted entry from the mock API", async () => {
    await worklogApi.saveEntry("2026-01-14", "to be deleted");
    await worklogApi.deleteEntry("2026-01-14");

    const entries = await worklogApi.listEntries();
    const deleted = await worklogApi.readEntry("2026-01-14");

    expect(entries.find((entry) => entry.date === "2026-01-14")).toBeUndefined();
    expect(deleted.exists).toBe(false);
  });

  it("keeps an empty saved entry as an existing file in the mock API", async () => {
    await worklogApi.saveEntry("2026-01-15", "");

    const entry = await worklogApi.readEntry("2026-01-15");

    expect(entry.exists).toBe(true);
    expect(entry.content).toBe("");
  });
});

describe("sidebar presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T04:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
    container.remove();
    vi.useRealTimers();
  });

  it("uses a bordered day state instead of entry dots and keeps the recent header static", async () => {
    await worklogApi.createEntry("2026-06-24");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const entryDay = container.querySelector<HTMLButtonElement>(
      '.day-cell[aria-label="2026-06-24"]',
    );

    expect(entryDay?.classList.contains("has-entry")).toBe(true);
    expect(entryDay?.querySelector("i")).toBeNull();
    expect(
      container.querySelector('.entry-list-header button[aria-label="新建"]'),
    ).toBeNull();
  });

  it("shows today as a highlighted relative title and opens a component date picker", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const relativeLabel = container.querySelector<HTMLElement>(".entry-title-relative");
    const datePicker = container.querySelector<HTMLButtonElement>(".date-picker-trigger");

    expect(relativeLabel?.textContent).toBe("今天");
    expect(relativeLabel?.classList.contains("today")).toBe(true);
    expect(container.querySelector(".entry-date-title")?.textContent).toBe(
      "今天, 6月24日 周三",
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(datePicker?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(datePicker?.textContent).toContain("2026年6月24日");

    await act(async () => {
      datePicker!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleEffects();

    expect(document.body.querySelector(".date-picker-popover")).not.toBeNull();

    const nextDayButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(".rdp-day_button"),
    ).find((button) => button.textContent === "25");

    await act(async () => {
      nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleEffects();

    expect(container.querySelector(".entry-title-relative")?.textContent).toBe("明天");
    expect(container.querySelector(".entry-date-title")?.textContent).toBe(
      "明天, 6月25日 周四",
    );
  });

  it("does not render the recent header and anchors the sidebar list around the selected date", async () => {
    vi.spyOn(worklogApi, "listEntries").mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 5, 30 - index));
        const isoDate = date.toISOString().slice(0, 10);
        return {
          date: isoDate,
          content: `entry ${isoDate}`,
          exists: true,
        };
      }),
    );
    vi.spyOn(worklogApi, "readEntry").mockResolvedValue({
      date: "2026-06-24",
      content: "entry 2026-06-24",
      exists: true,
    });

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    expect(container.querySelector(".entry-list-header")).toBeNull();
    expect(container.querySelectorAll(".entry-card")).toHaveLength(24);
    expect(container.querySelector('.entry-card[aria-current="date"]')).not.toBeNull();
  });
});

describe("editor autosave", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T04:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
    container.remove();
    vi.useRealTimers();
  });

  it("autosaves after 600ms idle time and hides the footer indicator once save completes", async () => {
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
      typeIntoTextarea(textarea!, "今天写点内容");
    });
    expect(container.querySelector('[aria-label="Pending changes"]')).not.toBeNull();
    expect(container.querySelector(".status-line")?.textContent).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      typeIntoTextarea(textarea!, "今天写点最终内容");
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
    expect(container.querySelector('[aria-label="Pending changes"]')).toBeNull();
    expect(container.querySelector('[aria-label="Saving"]')).toBeNull();
    expect(container.querySelector('[aria-label="Save failed"]')).toBeNull();
    expect(container.querySelector(".status-line")?.textContent).toBe("");
  });

  it("keeps the current entry as an empty file while staying on the same date", async () => {
    const originalSave = worklogApi.saveEntry.bind(worklogApi);
    const saveSpy = vi.spyOn(worklogApi, "saveEntry").mockImplementation(originalSave);
    const deleteSpy = vi.spyOn(worklogApi, "deleteEntry");

    await worklogApi.saveEntry("2026-06-24", "today");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "");
      await vi.advanceTimersByTimeAsync(600);
    });
    await settleEffects();

    expect(saveSpy).toHaveBeenCalledWith("2026-06-24", "");
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".empty-ribbon")).toBeNull();
  });

  it("keeps whitespace-only content as a saved entry", async () => {
    const originalSave = worklogApi.saveEntry.bind(worklogApi);
    const saveSpy = vi.spyOn(worklogApi, "saveEntry").mockImplementation(originalSave);
    const deleteSpy = vi.spyOn(worklogApi, "deleteEntry");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "   \n");
      await vi.advanceTimersByTimeAsync(600);
    });
    await settleEffects();

    expect(saveSpy).toHaveBeenCalledWith("2026-06-24", "   \n");
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".empty-ribbon")).toBeNull();
  });

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
      typeIntoTextarea(textarea!, "切日前的草稿");
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

  it("deletes an emptied entry only when switching dates", async () => {
    const originalDelete = worklogApi.deleteEntry.bind(worklogApi);
    const deleteSpy = vi.spyOn(worklogApi, "deleteEntry").mockImplementation(originalDelete);

    await worklogApi.saveEntry("2026-06-24", "today");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "");
      await vi.advanceTimersByTimeAsync(600);
    });
    await settleEffects();

    expect(deleteSpy).not.toHaveBeenCalled();

    const nextDayButton = container.querySelector<HTMLButtonElement>(
      '.date-control-button[aria-label="后一天"]',
    );
    await act(async () => {
      nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleEffects();

    expect(deleteSpy).toHaveBeenCalledWith("2026-06-24");
    expect(container.querySelector(".entry-date-title")?.textContent).toContain(
      "明天, 6月25日 周四",
    );
  });

  it("deletes an emptied entry when the window is unloading", async () => {
    const originalDelete = worklogApi.deleteEntry.bind(worklogApi);
    const deleteSpy = vi.spyOn(worklogApi, "deleteEntry").mockImplementation(originalDelete);

    await worklogApi.saveEntry("2026-06-24", "today");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown 日记"]',
    );

    await act(async () => {
      typeIntoTextarea(textarea!, "");
      await vi.advanceTimersByTimeAsync(600);
    });
    await settleEffects();

    expect(deleteSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    await settleEffects();

    expect(deleteSpy).toHaveBeenCalledWith("2026-06-24");
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
      typeIntoTextarea(textarea!, "失败时不能切走");
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
        const existing = deferredReads.get(date);
        if (existing) {
          return existing.promise;
        }

        let resolve!: (value: WorklogFile) => void;
        const promise = new Promise<WorklogFile>((fulfill) => {
          resolve = fulfill;
        });
        const next = { resolve, promise };
        deferredReads.set(date, next);
        return promise;
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
    });
    await settleEffects();

    await act(async () => {
      nextDayButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settleEffects();

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
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 日记"]')
        ?.value,
    ).toBe("最终展示的是最新日期");
    expect(container.querySelector(".entry-date-title")?.textContent).toContain(
      "6月26日 周五",
    );
  });
});

describe("status indicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T04:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
    container.remove();
    vi.useRealTimers();
  });

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
    expect(container.querySelector(".status-line")?.textContent).toBe("");
  });

  it("renders a warning icon when autosave fails", async () => {
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

describe("sidebar entry list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T04:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
    container.remove();
    vi.useRealTimers();
  });

  it("does not open a delete menu on right click", async () => {
    await worklogApi.saveEntry("2026-06-24", "today");

    await act(async () => {
      root.render(<App />);
    });
    await settleEffects();

    const currentCard = container.querySelector<HTMLButtonElement>(
      '.entry-card[aria-current="date"]',
    );

    await act(async () => {
      currentCard!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 120,
          clientY: 220,
        }),
      );
    });

    expect(container.querySelector('[aria-label="删除这一天"]')).toBeNull();
    expect(container.querySelector('[aria-label="确认删除这一天"]')).toBeNull();
  });
});

describe("sidebar styling", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("keeps the compact sidebar typography requested for the calendar and recent cards", () => {
    expect(styles).toMatch(/\.calendar-panel\s*\{[\s\S]*padding:\s*12px 22px 6px;/);
    expect(styles).toMatch(/\.month-toolbar\s*\{[\s\S]*margin-bottom:\s*12px;/);
    expect(styles).toMatch(/\.month-toolbar h2\s*\{[\s\S]*font-size:\s*17px;/);
    expect(styles).toMatch(/\.week-grid\s*\{[\s\S]*font-size:\s*11px;/);
    expect(styles).toMatch(/\.day-grid\s*\{[\s\S]*gap:\s*5px;/);
    expect(styles).toMatch(/\.day-cell\s*\{[\s\S]*width:\s*24px;/);
    expect(styles).toMatch(/\.day-cell\s*\{[\s\S]*height:\s*24px;/);
    expect(styles).toMatch(/\.day-cell\s*\{[\s\S]*font-size:\s*13px;/);
    expect(styles).toMatch(/\.entry-card strong\s*\{[\s\S]*font-size:\s*15px;/);
  });

  it("styles the main date picker like a quiet mac-style control", () => {
    expect(styles).toMatch(/\.entry-date-title\s*\{[\s\S]*font-size:\s*36px;/);
    expect(styles).toMatch(/\.entry-title-relative\.today\s*\{[\s\S]*color:\s*var\(--accent\);/);
    expect(styles).toMatch(/\.date-controls\s*\{[\s\S]*gap:\s*6px;/);
    expect(styles).toMatch(/\.date-control-button\s*\{[\s\S]*width:\s*30px;/);
    expect(styles).toMatch(/\.date-control-button\s*\{[\s\S]*height:\s*30px;/);
    expect(styles).toMatch(/\.date-picker-trigger\s*\{[\s\S]*height:\s*32px;/);
    expect(styles).toMatch(/\.date-picker-trigger\s*\{[\s\S]*min-width:\s*150px;/);
    expect(styles).toMatch(/\.date-picker-trigger\s*\{[\s\S]*font-size:\s*14px;/);
    expect(styles).not.toMatch(/\.date-chip/);
    expect(styles).not.toMatch(/\.date-picker-input/);
  });

  it("keeps recent previews to two clipped lines without decorative edge effects", () => {
    expect(styles).toMatch(/\.entry-card\s*\{[\s\S]*flex:\s*0 0 auto;/);
    expect(styles).toMatch(/\.entry-card\s*\{[\s\S]*position:\s*relative;/);
    expect(styles).toMatch(/\.entry-card\s*\{[\s\S]*min-height:\s*96px;/);
    expect(styles).toMatch(/\.entry-card span\s*\{[\s\S]*max-height:\s*calc\(13px \* 1\.45 \* 2\);/);
    expect(styles).not.toMatch(/\.entry-card::before/);
    expect(styles).not.toMatch(/mask-image:/);
    expect(styles).not.toMatch(/-webkit-mask-image:/);
    expect(styles).not.toMatch(/-webkit-line-clamp/);
  });

  it("keeps the sidebar material stable while opening and resizing the window", () => {
    const sidebarRule = styles.match(/\.sidebar\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const collapsedRule = styles.match(/\.sidebar-collapsed\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(sidebarRule).not.toMatch(/linear-gradient/);
    expect(sidebarRule).not.toMatch(/backdrop-filter/);
    expect(sidebarRule).not.toMatch(/-webkit-backdrop-filter/);
    expect(sidebarRule).not.toMatch(/background\s+160ms/);
    expect(sidebarRule).not.toMatch(/box-shadow\s+160ms/);
    expect(sidebarRule).not.toMatch(/border-right\s+160ms/);
    expect(collapsedRule).not.toMatch(/background:\s*transparent;/);
  });

  it("keeps the sidebar mounted and drives collapse with transform instead of width", () => {
    const appShellRule = styles.match(/\.app-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const sidebarRule = styles.match(/\.sidebar\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const closedRule =
      styles.match(/\.sidebar\[data-sidebar-state="closed"\]\s*\{([\s\S]*?)\n\}/)?.[1] ??
      "";

    expect(appSource).not.toMatch(/\{!sidebarOpen && \(/);
    expect(appSource).toMatch(
      /data-sidebar-state=\{sidebarOpen \? "open" : "closed"\}/,
    );
    expect(appSource).toMatch(/data-reveal-visible=\{String\(!sidebarOpen\)\}/);

    expect(appShellRule).toMatch(/position:\s*relative;/);
    expect(appShellRule).not.toMatch(/grid-template-columns:/);
    expect(sidebarRule).toMatch(/position:\s*absolute;/);
    expect(sidebarRule).toMatch(/transform:\s*translate3d\(0,\s*0,\s*0\);/);
    expect(closedRule).toMatch(/transform:\s*translate3d\(-100%,\s*0,\s*0\);/);
    expect(styles).not.toMatch(/\.sidebar-collapsed\s*\{[\s\S]*width:\s*0;/);
    expect(styles).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.sidebar[\s\S]*transition:\s*none;/,
    );
  });

  it("removes the sidebar delete menu and confirmation overlay styles", () => {
    expect(appSource).not.toMatch(/entry-context-menu/);
    expect(appSource).not.toMatch(/entry-delete-confirm/);
    expect(styles).not.toMatch(/\.entry-context-menu/);
    expect(styles).not.toMatch(/\.entry-delete-confirm/);
  });
});

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
    expect(spinnerRule).toMatch(
      /animation:\s*status-indicator-spin 1\.1s linear infinite;/,
    );
    expect(failedRule).toMatch(/color:\s*rgba\(168,\s*83,\s*71,\s*0\.86\);/);
    expect(styles).toMatch(/@keyframes status-indicator-spin/);
  });
});

describe("settings window", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const apiSource = readFileSync(resolve(process.cwd(), "src/lib/api.ts"), "utf8");
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.pushState({}, "", "/settings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.history.pushState({}, "", "/");
  });

  it("shows the application about details and owner contact", async () => {
    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector(".settings-window")).not.toBeNull();
    expect(container.querySelector(".settings-window")?.textContent).toContain("About");
    expect(container.querySelector(".settings-window")?.textContent).toContain("ttb");
    expect(container.querySelector(".settings-window")?.textContent).toContain(
      "x.ttb@icloud.com",
    );
    expect(container.querySelector(".settings-window")?.textContent).toContain(
      "com.ttb.worklog",
    );
    expect(container.querySelector(".settings-footer")?.textContent).toContain(
      "x.ttb@icloud.com",
    );
  });

  it("uses separated shadcn-style panels instead of plain rows", () => {
    expect(styles).toMatch(/\.settings-content\s*\{[\s\S]*display:\s*grid;/);
    expect(styles).toMatch(/\.settings-panel\s*\{[\s\S]*border-radius:\s*8px;/);
    expect(styles).toMatch(/\.settings-info-grid\s*\{[\s\S]*grid-template-columns:/);
    expect(styles).toMatch(/\.settings-footer\s*\{[\s\S]*margin-top:\s*auto;/);
    expect(styles).not.toMatch(/\.settings-window section\s*\{[\s\S]*border-top:/);
  });

  it("asks the backend to reveal the hidden window without relying on animation frames", () => {
    expect(apiSource).toMatch(/settingsWindowReady:\s*\(\)\s*=>\s*Promise<void>/);
    expect(apiSource).toMatch(/invoke<void>\("settings_window_ready"\)/);
    expect(appSource).toMatch(/window\.setTimeout/);
    expect(appSource).toMatch(/worklogApi\.settingsWindowReady\(\)/);
    expect(appSource).not.toMatch(/requestAnimationFrame/);
  });
});

describe("app metadata", () => {
  const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as {
    identifier: string;
    app: { windows: Array<{ label?: string; create?: boolean }> };
  };
  const cargoManifest = readFileSync(
    resolve(process.cwd(), "src-tauri/Cargo.toml"),
    "utf8",
  );
  const tauriSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

  it("uses ttb ownership metadata instead of the old banu identifier", () => {
    expect(tauriConfig.identifier).toBe("com.ttb.worklog");
    expect(cargoManifest).toContain('authors = ["ttb <x.ttb@icloud.com>"]');
    expect(JSON.stringify(tauriConfig)).not.toContain("banu");
  });

  it("keeps the settings window hidden until its native material is applied", () => {
    expect(tauriSource).toMatch(/\.visible\(false\)/);
    const openSettingsSource = tauriSource.match(
      /fn open_settings_window[\s\S]*?(?=\nfn settings_window_ready)/,
    )?.[0];

    expect(openSettingsSource).toBeDefined();
    expect(openSettingsSource).not.toMatch(
      /builder\.build\(\)[\s\S]*show_settings_window/,
    );
    expect(tauriSource).toMatch(
      /fn settings_window_ready[\s\S]*show_settings_window\(&window\)/,
    );
  });

  it("rescues an existing hidden settings window when settings is clicked again", () => {
    expect(tauriSource).toMatch(
      /if window\.is_visible\(\)[\s\S]*window\.set_focus\(\)[\s\S]*else[\s\S]*show_settings_window\(&window\)/,
    );
    expect(tauriSource).toMatch(
      /fn show_settings_window\(window: &WebviewWindow\)[\s\S]*window\.show\(\)[\s\S]*window\.set_focus\(\)/,
    );
  });

  it("opens settings at a larger default size and lets the user resize it", () => {
    expect(tauriSource).toMatch(/\.inner_size\(680\.0,\s*560\.0\)/);
    expect(tauriSource).toMatch(/\.min_inner_size\(600\.0,\s*500\.0\)/);
    expect(tauriSource).toMatch(/\.resizable\(true\)/);
    expect(tauriSource).not.toMatch(/\.resizable\(false\)/);
  });

  it("disables the WebView context menu only for packaged app windows", () => {
    const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");

    expect(mainWindow?.create).toBe(false);
    expect(tauriSource).toMatch(/DISABLE_WEBVIEW_CONTEXT_MENU_SCRIPT[\s\S]*contextmenu/);
    expect(tauriSource).toMatch(/#\[cfg\(not\(debug_assertions\)\)\]/);
    expect(tauriSource).toMatch(
      /\.initialization_script\(DISABLE_WEBVIEW_CONTEXT_MENU_SCRIPT\)/,
    );
    expect(tauriSource).toMatch(
      /WebviewWindowBuilder::from_config\(app\.handle\(\), main_window_config\)/,
    );
  });

  it("keeps the main window hidden until the frontend is ready", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const apiSource = readFileSync(resolve(process.cwd(), "src/lib/api.ts"), "utf8");

    expect(tauriSource).toMatch(
      /WebviewWindowBuilder::from_config\(app\.handle\(\), main_window_config\)\?[\s\S]*\.visible\(false\)[\s\S]*\.build\(\)\?/,
    );
    expect(tauriSource).toMatch(
      /fn main_window_ready\(app: AppHandle\)[\s\S]*show_window\(&window\)/,
    );
    expect(tauriSource).toMatch(/main_window_ready/);
    expect(apiSource).toMatch(/mainWindowReady:\s*\(\)\s*=>\s*Promise<void>/);
    expect(apiSource).toMatch(/invoke<void>\("main_window_ready"\)/);
    expect(appSource).toMatch(/worklogApi\.mainWindowReady\(\)/);
  });
});

describe("html boot styling", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  it("keeps the root surface opaque to avoid native material conflicts", () => {
    expect(html).toMatch(/html,\s*body,\s*#root/);
    expect(html).toMatch(/--app-boot-bg:\s*#fbfcfd;/);
    expect(html).toMatch(/background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/--app-boot-bg:\s*#fbfcfd;/);
    expect(styles).toMatch(/body\s*\{[\s\S]*background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/\.app-shell\s*\{[\s\S]*background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/\.main-surface\s*\{[\s\S]*background:\s*#fbfcfd;/);
  });
});
