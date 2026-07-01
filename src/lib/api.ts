import { invoke } from "@tauri-apps/api/core";

import { createDailyTemplate, type WorklogFile } from "./worklog";

type WorklogApi = {
  listEntries: () => Promise<WorklogFile[]>;
  readEntry: (date: string) => Promise<WorklogFile>;
  saveEntry: (date: string, content: string) => Promise<WorklogFile>;
  createEntry: (date: string) => Promise<WorklogFile>;
  openSettings: () => Promise<void>;
  mainWindowReady: () => Promise<void>;
  settingsWindowReady: () => Promise<void>;
};

const bundledFiles = import.meta.glob<string>("/daily/**/daily.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const mockEntries = new Map(
  Object.entries(bundledFiles)
    .map(([path, content]) => {
      const date = path.match(/\/daily\/(\d{4}-\d{2}-\d{2})\/daily\.md$/)?.[1];
      return date ? ([date, content] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry)),
);

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const mockApi: WorklogApi = {
  async listEntries() {
    return [...mockEntries.entries()].map(([date, content]) => ({
      date,
      content,
      exists: true,
    }));
  },
  async readEntry(date) {
    const content = mockEntries.get(date);
    return {
      date,
      content: content ?? createDailyTemplate(date),
      exists: Boolean(content),
    };
  },
  async saveEntry(date, content) {
    mockEntries.set(date, content);
    return { date, content, exists: true };
  },
  async createEntry(date) {
    const content = mockEntries.get(date) ?? createDailyTemplate(date);
    mockEntries.set(date, content);
    return { date, content, exists: true };
  },
  async openSettings() {
    window.open("/settings", "worklog-settings", "width=680,height=560,resizable=yes");
  },
  async mainWindowReady() {
    return undefined;
  },
  async settingsWindowReady() {
    return undefined;
  },
};

const tauriApi: WorklogApi = {
  listEntries: () => invoke<WorklogFile[]>("list_entries"),
  readEntry: (date) => invoke<WorklogFile>("read_entry", { date }),
  saveEntry: (date, content) => invoke<WorklogFile>("save_entry", { date, content }),
  createEntry: (date) => invoke<WorklogFile>("create_entry", { date }),
  openSettings: () => invoke<void>("open_settings_window"),
  mainWindowReady: () => invoke<void>("main_window_ready"),
  settingsWindowReady: () => invoke<void>("settings_window_ready"),
};

export const worklogApi: WorklogApi = isTauriRuntime() ? tauriApi : mockApi;
