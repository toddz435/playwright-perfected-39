// Very small cron parser. Supports: "*", "*/N", "A,B,C", and "A-B".
export function matches(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[3], 10);
      const rangePart = stepMatch[1];
      let base = 0;
      let end = Infinity; // "A/N" and "*/N" have no upper bound; "A-B/N" does.
      if (rangePart !== "*") {
        const [a, b] = rangePart.split("-");
        base = parseInt(a, 10);
        if (b !== undefined) end = parseInt(b, 10);
      }
      if (value >= base && value <= end && (value - base) % step === 0) return true;
      continue;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((n) => parseInt(n, 10));
      if (value >= a && value <= b) return true;
      continue;
    }
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

// Builds a 5-field UTC cron from a LOCAL 24h time + chosen weekdays. isDue() evaluates in
// UTC, so we convert here. offsetMin is Date.prototype.getTimezoneOffset() (minutes to ADD
// to local to reach UTC; e.g. UTC-5 → +300). days are local weekday numbers (0=Sun..6=Sat);
// an empty list means every day. Day-rollover from the conversion shifts the weekdays too.
export function buildCronFromLocal(timeHHMM: string, days: number[], offsetMin: number): string {
  const [h, m] = timeHHMM.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59)
    return "0 9 * * *";
  const utcTotal = h * 60 + m + offsetMin;
  const dayShift = Math.floor(utcTotal / 1440); // -1, 0, or +1
  const utcMin = ((utcTotal % 1440) + 1440) % 1440;
  const HH = Math.floor(utcMin / 60);
  const MM = utcMin % 60;
  if (!days.length) return `${MM} ${HH} * * *`;
  const utcDays = [...new Set(days.map((d) => (((d + dayShift) % 7) + 7) % 7))].sort(
    (a, b) => a - b,
  );
  return `${MM} ${HH} * * ${utcDays.join(",")}`;
}

export function isDue(cron: string, now: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hr, dom, mon, dow] = parts;
  return (
    matches(min, now.getUTCMinutes()) &&
    matches(hr, now.getUTCHours()) &&
    matches(dom, now.getUTCDate()) &&
    matches(mon, now.getUTCMonth() + 1) &&
    matches(dow, now.getUTCDay())
  );
}
