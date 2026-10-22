import clsx from "clsx";
import * as Switch from "@radix-ui/react-switch";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

type Tone = "primary" | "quiet" | "danger" | "outline";

/** Pill buttons: solid for the one main action, glass for the rest. */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: ReactNode; small?: boolean; big?: boolean }>(
  function Button({ tone = "outline", icon, small, big, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        {...rest}
        className={clsx(
          "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition-[background,color,box-shadow,transform,filter] active:scale-[0.98] disabled:cursor-default disabled:opacity-45",
          small ? "h-8 px-3.5 text-[12.5px]" : big ? "h-12 px-7 text-[15px] font-semibold" : "h-10 px-5 text-[13.5px]",
          tone === "primary" && "bg-accent text-accent-ink shadow-[0_10px_28px_-10px_rgb(0_0_0/0.55)] hover:brightness-110",
          tone === "outline" && "glass-flat text-ink hover:bg-[var(--surface-2)]",
          tone === "quiet" && "text-ink-2 hover:bg-[var(--surface)] hover:text-ink",
          tone === "danger" && "glass-flat text-stamp-red hover:bg-stamp-red/15",
          className,
        )}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface)] hover:text-ink", className)}
    >
      {children}
    </button>
  );
}

/** A small pill label. */
export function Tag({ children, tone = "ink", tilt = 0, className, size = "sm" }: {
  children: ReactNode;
  tone?: "ink" | "red" | "violet" | "green";
  tilt?: number;
  className?: string;
  size?: "xs" | "sm" | "lg";
}) {
  return (
    <span
      className={clsx(
        "stamp inline-block uppercase",
        size === "xs" && "text-[9.5px] tracking-[0.1em]",
        size === "sm" && "text-[10.5px] tracking-[0.1em]",
        size === "lg" && "px-3 text-[12px] tracking-[0.12em]",
        tone === "ink" && "text-ink-2",
        tone === "red" && "text-stamp-red",
        tone === "violet" && "text-accent",
        tone === "green" && "text-ok",
        className,
      )}
      style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined }}
    >
      {children}
    </span>
  );
}

export function Chip({ active, onClick, children, count, tone }: { active: boolean; onClick(): void; children: ReactNode; count?: number; tone?: "red" }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors",
        active
          ? tone === "red"
            ? "bg-stamp-red text-white"
            : "bg-accent text-accent-ink"
          : "text-ink-2 hover:bg-[var(--surface)] hover:text-ink",
      )}
    >
      {children}
      {count !== undefined && <span className={clsx("num text-[11.5px]", active ? "opacity-70" : "text-ink-3")}>{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="glass-flat inline-flex rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-8 cursor-pointer rounded-full px-4 text-[12.5px] font-medium transition-colors",
            value === o.value ? "bg-accent text-accent-ink shadow-[0_4px_12px_-4px_rgb(0_0_0/0.4)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border border-[var(--edge)] bg-[var(--sunken)] transition-colors data-[state=checked]:border-transparent data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-5 translate-x-[2px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.35)] transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  );
}

export function MenuButton({ trigger, items }: { trigger: ReactNode; items: { label: string; icon?: ReactNode; onSelect(): void; danger?: boolean }[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="glass z-50 min-w-[200px] !rounded-[16px] p-1.5">
          {items.map((it) => (
            <Menu.Item
              key={it.label}
              onSelect={it.onSelect}
              className={clsx(
                "flex h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-[13px] outline-none data-[highlighted]:bg-[var(--surface-2)]",
                it.danger ? "text-stamp-red" : "text-ink",
              )}
            >
              {it.icon}
              {it.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Page heading: big, heavy and tight, with a quiet line under it. */
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-7">
      <div className="min-w-0">
        <h1 className="font-display text-[56px] leading-[0.95] text-ink">{title}</h1>
        {sub && <p className="mt-2.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-4 px-1">
      <h2 className="caps text-ink-3">{children}</h2>
      {aside && <div className="text-[12px] text-ink-3">{aside}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass mx-auto my-10 max-w-[480px] px-8 pt-7 pb-8 text-center">
      <p className="font-display text-[26px] leading-[1.1] text-ink">{title}</p>
      {children && <div className="mt-2.5 text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
