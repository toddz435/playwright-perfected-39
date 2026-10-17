// @vitest-environment node
// Keeps the curated device list honest: every device must exist in Playwright, and the screen
// sizes the UI draws must match Playwright's real descriptors.
import { describe, it, expect } from "vitest";
import { devices } from "@playwright/test";
import { DEVICES, DEVICE_MATRIX_PRESETS, deviceInfo } from "./devices";

describe("device list", () => {
  it("maps every device to a real Playwright descriptor with matching viewport", () => {
    for (const info of DEVICES) {
      if (!info.playwright) continue;
      const desc = devices[info.playwright];
      expect(desc, info.playwright).toBeDefined();
      expect(desc.viewport, info.id).toEqual({ width: info.width, height: info.height });
    }
  });

  it("only offers presets for known devices", () => {
    for (const p of DEVICE_MATRIX_PRESETS) expect(deviceInfo(p.device), p.device).toBeDefined();
  });
});
