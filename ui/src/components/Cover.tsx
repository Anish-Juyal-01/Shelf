import clsx from "clsx";
import { coverStyle } from "../lib/library";

/**
 * Box art, or — until art is fetched — a cloth-bound "book" generated from the title: a colour, a foil-framed
 * label and one of four band patterns, always the same for the same game.
 */
export function Cover({ title, url, className, large }: { title: string; url: string | null; className?: string; large?: boolean }) {
  if (url) {
    return (
      <div className={clsx("relative aspect-[2/3] overflow-hidden rounded-[3px] bg-sunken shadow-cover", className)}>
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
        <div className="pointer-events-none absolute inset-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" />
      </div>
    );
  }

  const { cloth, pattern, band } = coverStyle(title);
  const words = title.split(" ");
  const fontSize = large ? (title.length > 28 ? 26 : 32) : title.length > 28 ? 13 : title.length > 16 ? 15 : 18;

  return (
    <div
      aria-hidden
      className={clsx("cloth relative aspect-[2/3] overflow-hidden rounded-[3px] shadow-cover", className)}
      style={{ backgroundColor: cloth.bg, color: cloth.fg, containerType: "inline-size" }}
    >
      {pattern === 0 && (
        <>
          <div className="absolute inset-x-0 h-[3px] opacity-70" style={{ top: `${band}%`, background: cloth.fg }} />
          <div className="absolute inset-x-0 h-px opacity-70" style={{ top: `calc(${band}% + 6px)`, background: cloth.fg }} />
          <div className="absolute inset-x-0 h-px opacity-70" style={{ bottom: `${band - 8}%`, background: cloth.fg }} />
        </>
      )}
      {pattern === 1 && <div className="absolute inset-[7%] rounded-[2px] border opacity-55" style={{ borderColor: cloth.fg }} />}
      {pattern === 2 && (
        <div className="absolute inset-x-0 bottom-0 h-[30%] opacity-25" style={{ background: `repeating-linear-gradient(135deg, ${cloth.fg} 0 2px, transparent 2px 9px)` }} />
      )}
      {pattern === 3 && <div className="absolute top-0 bottom-0 left-[16%] w-[3px] opacity-50" style={{ background: cloth.fg }} />}

      {/* Foil label */}
      <div className="absolute inset-x-[12%] top-[30%] flex min-h-[28%] flex-col items-center justify-center rounded-[2px] border px-[8%] py-[6%] text-center"
        style={{ borderColor: `color-mix(in oklab, ${cloth.fg} 70%, transparent)`, background: "rgb(0 0 0 / 0.08)" }}>
        <span
          className="font-display leading-[1.08] font-[600]"
          style={{ fontSize, fontVariationSettings: '"SOFT" 100, "opsz" 72', overflowWrap: "anywhere" }}
        >
          {words.length > 6 ? words.slice(0, 6).join(" ") + "…" : title}
        </span>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(160deg,rgb(255_255_255/0.08),transparent_40%,rgb(0_0_0/0.18))]" />
    </div>
  );
}
