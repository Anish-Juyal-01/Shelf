import type { SourceKind } from "../bridge/protocol";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 100 * GB) return `${Math.round(n / GB)} GB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  if (n > 0) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return "0 B";
}

/** 0 → "—", 540 → "9m", 7200 → "2h", 9000 → "2.5h", 360000 → "100h". */
export function hours(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  const h = seconds / 3600;
  return h >= 100 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

/** "1h 05m", "42m", "30s". */
export function duration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.max(0, Math.round(seconds))}s`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Library date-stamp style: "12 OCT 2026" (year dropped when it's this year). */
export function stampDate(iso: string | null, now = new Date()): string {
  if (!iso) return "NEVER";
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() === now.getFullYear() ? `${day} ${MONTHS[d.getMonth()]}` : `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - Date.parse(iso);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30.4);
  if (m < 12) return `${m} month${m === 1 ? "" : "s"} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export const sourceName: Record<SourceKind, string> = {
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  ea: "EA",
  ubisoft: "Ubisoft",
  rockstar: "Rockstar",
  xbox: "Xbox",
  battleNet: "Battle.net",
  itch: "itch",
  amazon: "Amazon",
  riot: "Riot",
  hoYoPlay: "HoYoPlay",
  installedApps: "Windows",
  folder: "Loose",
  manual: "Added",
  runtime: "Spotted",
};

/** Short accession-style number for a game: "SH-0042". */
export const callNumber = (id: number) => `SH-${String(id).padStart(4, "0")}`;
