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
  | "ipad-mini";

export type DeviceInfo = {
  id: DeviceId;
  label: string;
  // Playwright `devices[...]` key; null for desktop.
  playwright: string | null;
  kind: "desktop" | "phone" | "tablet";
  // The engine that matches the real device's browser (Safari → WebKit, Chrome → Chromium).
  nativeBrowser: "chromium" | "webkit";
};

export const DEVICES: DeviceInfo[] = [
  { id: "desktop", label: "Desktop", playwright: null, kind: "desktop", nativeBrowser: "chromium" },
  {
    id: "iphone-15",
    label: "iPhone 15",
    playwright: "iPhone 15",
    kind: "phone",
    nativeBrowser: "webkit",
  },
  {
    id: "iphone-se",
    label: "iPhone SE (small)",
    playwright: "iPhone SE",
    kind: "phone",
    nativeBrowser: "webkit",
  },
  {
    id: "pixel-7",
    label: "Pixel 7",
    playwright: "Pixel 7",
    kind: "phone",
    nativeBrowser: "chromium",
  },
  {
    id: "galaxy-s9",
    label: "Galaxy S9+",
    playwright: "Galaxy S9+",
    kind: "phone",
    nativeBrowser: "chromium",
  },
  {
    id: "ipad-pro-11",
    label: "iPad Pro 11",
    playwright: "iPad Pro 11",
    kind: "tablet",
    nativeBrowser: "webkit",
  },
  {
    id: "ipad-mini",
    label: "iPad Mini",
    playwright: "iPad Mini",
    kind: "tablet",
    nativeBrowser: "webkit",
  },
];

export function deviceInfo(id: unknown): DeviceInfo | undefined {
  return DEVICES.find((d) => d.id === id);
}

// Validate an untrusted device id; anything unknown (or desktop) → undefined = desktop.
export function cleanDeviceId(id: unknown): DeviceId | undefined {
  const d = deviceInfo(id);
  return d && d.id !== "desktop" ? d.id : undefined;
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
];
