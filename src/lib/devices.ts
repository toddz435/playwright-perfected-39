// Mobile/tablet emulation: the curated device list shared by the UI, the engine, the recorder and
// Export TS. Each id maps to a Playwright device descriptor name (viewport, deviceScaleFactor,
// isMobile, hasTouch, userAgent). Client-safe — no Playwright import here; the engine resolves the
// descriptor server-side. "desktop" (or absent) means a plain desktop browser window.

export type DeviceId =
  | "desktop"
  | "iphone-15"
  | "iphone-se"
  | "pixel-7"
  | "galaxy-s9"
  | "ipad-pro-11"
  | "ipad-pro-11-landscape"
  | "ipad-mini"
  | "ipad-mini-landscape"
  | "galaxy-tab-s4";

export type DeviceInfo = {
  id: DeviceId;
  label: string;
  // Playwright `devices[...]` key; null for desktop.
  playwright: string | null;
  kind: "desktop" | "phone" | "tablet";
  // The engine that matches the real device's browser (Safari → WebKit, Chrome → Chromium).
  nativeBrowser: "chromium" | "webkit";
  // CSS-pixel viewport (mirrors the Playwright descriptor) — used to draw each device's screen at
  // its true shape in the UI. devices.test.ts keeps these in sync with Playwright.
  width: number;
  height: number;
};

const d = (
  id: DeviceId,
  label: string,
  playwright: string | null,
  kind: DeviceInfo["kind"],
  nativeBrowser: DeviceInfo["nativeBrowser"],
  width: number,
  height: number,
): DeviceInfo => ({ id, label, playwright, kind, nativeBrowser, width, height });

export const DEVICES: DeviceInfo[] = [
  d("desktop", "Desktop", null, "desktop", "chromium", 1280, 720),
  d("iphone-15", "iPhone 15", "iPhone 15", "phone", "webkit", 393, 659),
  d("iphone-se", "iPhone SE (small)", "iPhone SE", "phone", "webkit", 320, 568),
  d("pixel-7", "Pixel 7", "Pixel 7", "phone", "chromium", 412, 839),
  d("galaxy-s9", "Galaxy S9+", "Galaxy S9+", "phone", "chromium", 320, 658),
  d("ipad-pro-11", "iPad Pro 11", "iPad Pro 11", "tablet", "webkit", 834, 1194),
  d(
    "ipad-pro-11-landscape",
    "iPad Pro 11 (landscape)",
    "iPad Pro 11 landscape",
    "tablet",
    "webkit",
    1194,
    834,
  ),
  d("ipad-mini", "iPad Mini", "iPad Mini", "tablet", "webkit", 768, 1024),
  d(
    "ipad-mini-landscape",
    "iPad Mini (landscape)",
    "iPad Mini landscape",
    "tablet",
    "webkit",
    1024,
    768,
  ),
  d("galaxy-tab-s4", "Galaxy Tab S4", "Galaxy Tab S4", "tablet", "chromium", 712, 1138),
];

export function deviceInfo(id: unknown): DeviceInfo | undefined {
  return DEVICES.find((x) => x.id === id);
}

// Validate an untrusted device id; anything unknown (or desktop) → undefined = desktop.
export function cleanDeviceId(id: unknown): DeviceId | undefined {
  const info = deviceInfo(id);
  return info && info.id !== "desktop" ? info.id : undefined;
}

// Validate an untrusted per-run choice, keeping an explicit "desktop" (it overrides a test's saved
// device); unknown → undefined (= use the test's default).
export function parseDeviceChoice(id: unknown): DeviceId | undefined {
  return deviceInfo(id)?.id;
}

export function deviceLabel(id: unknown): string {
  return deviceInfo(id)?.label ?? "Desktop";
}

// The "Run on devices" presets: the combinations that matter most for real-world coverage.
export const DEVICE_MATRIX_PRESETS: { device: DeviceId; browser: string; label: string }[] = [
  { device: "desktop", browser: "chromium", label: "Desktop · Chromium" },
  { device: "desktop", browser: "firefox", label: "Desktop · Firefox" },
  { device: "desktop", browser: "webkit", label: "Desktop · WebKit (Safari)" },
  { device: "iphone-15", browser: "webkit", label: "iPhone 15 · Safari (WebKit)" },
  { device: "iphone-se", browser: "webkit", label: "iPhone SE · Safari (WebKit)" },
  { device: "pixel-7", browser: "chromium", label: "Pixel 7 · Chrome (Chromium)" },
  { device: "galaxy-s9", browser: "chromium", label: "Galaxy S9+ · Chrome (Chromium)" },
  { device: "ipad-pro-11", browser: "webkit", label: "iPad Pro 11 · Safari (WebKit)" },
  {
    device: "ipad-pro-11-landscape",
    browser: "webkit",
    label: "iPad Pro 11 landscape · Safari (WebKit)",
  },
  { device: "galaxy-tab-s4", browser: "chromium", label: "Galaxy Tab S4 · Chrome (Chromium)" },
];
