/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { worklogApi } from "./lib/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settleEffects() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

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
});

describe("sidebar styling", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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

  it("keeps the root surface transparent so native macOS material can show through", () => {
    expect(html).toMatch(/html,\s*body,\s*#root/);
    expect(html).toMatch(/--app-boot-bg:\s*transparent;/);
    expect(html).toMatch(/background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/--app-boot-bg:\s*transparent;/);
    expect(styles).toMatch(/body\s*\{[\s\S]*background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/\.app-shell\s*\{[\s\S]*background:\s*var\(--app-boot-bg\);/);
    expect(styles).toMatch(/\.main-surface\s*\{[\s\S]*background:\s*#fbfcfd;/);
  });
});
