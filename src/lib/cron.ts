// Very small cron parser. Supports: "*", "*/N", "A,B,C", and "A-B".
export function matches(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[3], 10);
      const base = stepMatch[1] === "*" ? 0 : parseInt(stepMatch[1].split("-")[0], 10);
      if ((value - base) % step === 0 && value >= base) return true;
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
