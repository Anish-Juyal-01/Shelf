import clsx from "clsx";
import { memo } from "react";
import { PALETTES } from "../lib/art";
import { hash, normalize } from "../lib/library";

/**
 * Game art. Real box art when Shelf has it (Steam's cache, Xbox logos — later fetched art); otherwise a generated
 * key-art poster: a scene picked from the title (retro sun over mountains, a ringed planet, a light burst or a
 * synthwave grid) in one of a dozen palettes, with the game's own icon as the centrepiece when there is one and a
 * bold title. Same title → same poster, always.
 */



function ridge(seed: number, base: number, rough: number): string {
  const pts: string[] = ["0,100"];
  for (let i = 0; i <= 10; i++) {
    const h = base - (((seed >>> (i * 3)) & 7) / 7) * rough;
    pts.push(`${i * 10},${h.toFixed(1)}`);
  }
  pts.push("100,100");
  return pts.join(" ");
}

export const Cover = memo(function Cover({ title, url, iconUrl, className, large, bare }: {
  title: string;
  url: string | null;
  iconUrl?: string | null;
  className?: string;
  large?: boolean;
  /** Art only, no title (when the title is shown next to it anyway). */
  bare?: boolean;
}) {
  if (url) {
    return (
      <div className={clsx("relative aspect-[2/3] overflow-hidden bg-[#111] shadow-cover", className)}>
        <img src={url} alt="" draggable={false} loading="lazy" className="size-full object-cover" />
      </div>
    );
  }

  const h = hash(normalize(title));
  const [deep, mid, glow] = PALETTES[h % PALETTES.length];
  const scene = (h >>> 5) % 4;
  const words = title.trim().split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const size = large ? Math.min(44, Math.floor(360 / Math.max(6, longest))) : Math.min(22, Math.floor(150 / Math.max(5, longest)));

  return (
    <div aria-hidden className={clsx("relative aspect-[2/3] overflow-hidden shadow-cover", className)} style={{ background: deep }}>
      <svg viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={`sky${h}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={deep} />
            <stop offset="0.62" stopColor={mid} />
            <stop offset="1" stopColor={glow} stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id={`glow${h}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={glow} stopOpacity="0.9" />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="150" fill={`url(#sky${h})`} />

        {scene === 0 && (
          <>
            {/* retro sun with cut stripes, mountains in front */}
            <circle cx="50" cy="78" r="30" fill={glow} />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x="18" y={84 + i * 5.2} width="64" height={1 + i * 0.7} fill={mid} />
            ))}
            <polygon points={ridge(h, 96, 22)} transform="translate(0,12)" fill={deep} opacity="0.75" />
            <polygon points={ridge(h >>> 7, 104, 16)} transform="translate(0,20)" fill={deep} />
          </>
        )}
        {scene === 1 && (
          <>
            {/* ringed planet over a star field */}
            {Array.from({ length: 26 }, (_, i) => (
              <circle key={i} cx={((h >>> (i % 20)) * (i + 3)) % 100} cy={((h >>> ((i + 5) % 20)) * (i + 7)) % 90} r={i % 5 === 0 ? 0.7 : 0.35} fill="#fff" opacity={0.75} />
            ))}
            <circle cx="50" cy="66" r="42" fill={`url(#glow${h})`} opacity="0.55" />
            <circle cx="50" cy="66" r="22" fill={glow} />
            <circle cx="44" cy="60" r="22" fill={mid} opacity="0.45" />
            <ellipse cx="50" cy="66" rx="40" ry="8" fill="none" stroke={glow} strokeWidth="2.2" transform="rotate(-18 50 66)" />
          </>
        )}
        {scene === 2 && (
          <>
            {/* light burst */}
            {Array.from({ length: 14 }, (_, i) => (
              <polygon key={i} points="50,62 47,-20 53,-20" fill={glow} opacity={i % 2 ? 0.16 : 0.3} transform={`rotate(${i * (360 / 14) + (h % 20)} 50 62)`} />
            ))}
            <circle cx="50" cy="62" r="34" fill={`url(#glow${h})`} />
            <circle cx="50" cy="62" r="9" fill="#fff" opacity="0.9" />
          </>
        )}
        {scene === 3 && (
          <>
            {/* synthwave grid floor */}
            <circle cx="50" cy="72" r="26" fill={`url(#glow${h})`} />
            <rect y="84" width="100" height="66" fill={deep} />
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`h${i}`} x1="0" x2="100" y1={86 + Math.pow(i, 1.7) * 2.1} y2={86 + Math.pow(i, 1.7) * 2.1} stroke={glow} strokeWidth="0.5" opacity="0.8" />
            ))}
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`v${i}`} x1={50 + (i - 6) * 3} y1="84" x2={50 + (i - 6) * 26} y2="150" stroke={glow} strokeWidth="0.5" opacity="0.8" />
            ))}
          </>
        )}
      </svg>

      {/* The game's own icon, when Shelf could extract one, is the hero of the poster. */}
      {iconUrl && (
        <img
          src={iconUrl}
          alt=""
          draggable={false}
          className="absolute top-[24%] left-1/2 w-[46%] -translate-x-1/2"
          style={{ filter: `drop-shadow(0 0 18px ${glow}) drop-shadow(0 6px 10px rgb(0 0 0 / 0.5))` }}
        />
      )}

      {/* film grain */}
      <div className="absolute inset-0 opacity-[0.18] mix-blend-overlay" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / .9) 0.5px, transparent 0.6px)", backgroundSize: "3px 3px" }} />
      {!bare && <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/70 to-transparent" />}

      {!bare && <span
        className="absolute right-[9%] bottom-[7%] left-[9%] font-sans leading-[0.92] font-[800] tracking-[-0.03em] text-white uppercase"
        style={{ fontSize: size, textShadow: `0 2px 12px rgb(0 0 0 / 0.5), 0 0 24px ${glow}55` }}
      >
        {title}
      </span>}
    </div>
  );
});
