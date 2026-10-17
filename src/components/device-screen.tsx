import type { ReactNode } from "react";
import { deviceInfo } from "@/lib/devices";

// Draws a device's screen at its TRUE shape (aspect ratio from the viewport) inside a bezel that
// reads as the device type, so a phone, an upright iPad, a landscape tablet and a desktop are
// recognisable at a glance. Tablets are drawn larger than phones, as they are in real life.
const SCREEN_HEIGHT_REM = {
  phone: 20,
  tabletPortrait: 26,
  tabletLandscape: 17,
  desktop: 14,
};

export function DeviceScreen({
  device,
  frame,
  alt,
  placeholder,
}: {
  device: string;
  frame?: string;
  alt: string;
  placeholder?: ReactNode;
}) {
  const info = deviceInfo(device) ?? deviceInfo("desktop")!;
  const landscape = info.width > info.height;
  const height =
    info.kind === "phone"
      ? SCREEN_HEIGHT_REM.phone
      : info.kind === "tablet"
        ? landscape
          ? SCREEN_HEIGHT_REM.tabletLandscape
          : SCREEN_HEIGHT_REM.tabletPortrait
        : SCREEN_HEIGHT_REM.desktop;

  const screen = (
    <div
      className="bg-black overflow-hidden flex items-center justify-center"
      style={{ height: `${height}rem`, aspectRatio: `${info.width} / ${info.height}` }}
    >
      {frame ? (
        <img
          src={`data:image/jpeg;base64,${frame}`}
          alt={alt}
          className="w-full h-full object-fill select-none"
          draggable={false}
        />
      ) : (
        <span className="text-xs text-white/50 px-2 text-center">{placeholder}</span>
      )}
    </div>
  );

  if (info.kind === "desktop") {
    return (
      <div className="rounded-md border border-neutral-700 bg-neutral-800 overflow-hidden">
        <div className="flex items-center gap-1 px-2 py-1">
          <span className="h-2 w-2 rounded-full bg-red-400/80" />
          <span className="h-2 w-2 rounded-full bg-amber-400/80" />
          <span className="h-2 w-2 rounded-full bg-green-400/80" />
        </div>
        {screen}
      </div>
    );
  }
  // Phones: thin, very rounded bezel; tablets: thicker, squarer bezel.
  const bezel =
    info.kind === "phone"
      ? "rounded-[1.75rem] border-[7px] p-0"
      : "rounded-[1.25rem] border-[12px] p-0";
  return (
    <div className={`${bezel} border-neutral-800 bg-neutral-800 overflow-hidden shadow-lg`}>
      <div className="rounded-[0.9rem] overflow-hidden">{screen}</div>
    </div>
  );
}
