const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The team's time zone, set once from the server. Times are shown in it and day filters use it. */
let zone: string | undefined;
export const setTimeZone = (tz: string) => (zone = tz);

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: p.hour!, mm: p.minute!, weekday: p.weekday! };
}

/** 21 Nov 2026. Date-only strings (YYYY-MM-DD) are shown as written, never shifted by time zone. */
export function formatDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    return `${d} ${months[m - 1]} ${y}`;
  }
  const p = parts(new Date(value));
  return `${p.d} ${months[p.m - 1]} ${p.y}`;
}

export function formatDateTime(value: string | Date): string {
  const d = new Date(value);
  const p = parts(d);
  return `${formatDate(d)}, ${p.hh}:${p.mm}`;
}

export const longDate = (d: Date) => `${parts(d).weekday} ${formatDate(d)}`;
export const hourNow = () => Number(parts(new Date()).hh);
