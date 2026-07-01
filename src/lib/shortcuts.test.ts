import { describe, expect, it } from "vitest";

import { isSettingsShortcut, isToggleSidebarShortcut } from "./shortcuts";

describe("keyboard shortcuts", () => {
  it("opens settings with the standard macOS comma shortcut", () => {
    expect(isSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSettingsShortcut({ key: ",", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("does not treat plain comma or command-p as settings", () => {
    expect(isSettingsShortcut({ key: ",", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSettingsShortcut({ key: "p", metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("toggles sidebar with Cmd/Ctrl+B", () => {
    expect(isToggleSidebarShortcut({ key: "b", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isToggleSidebarShortcut({ key: "B", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isToggleSidebarShortcut({ key: "b", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("does not toggle sidebar on plain b or other shortcuts", () => {
    expect(isToggleSidebarShortcut({ key: "b", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isToggleSidebarShortcut({ key: "s", metaKey: true, ctrlKey: false })).toBe(false);
  });
});
