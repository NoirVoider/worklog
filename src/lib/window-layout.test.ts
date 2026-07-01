import { describe, expect, it } from "vitest";

import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("macOS window chrome layout", () => {
  it("aligns the native traffic lights with the sidebar toggle", () => {
    const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");

    expect(mainWindow?.hiddenTitle).toBe(true);
    expect(mainWindow?.titleBarStyle).toBe("Overlay");
    expect(mainWindow?.trafficLightPosition).toEqual({ x: 18, y: 30 });
  });
});
