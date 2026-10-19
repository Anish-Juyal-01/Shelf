import clsx from "clsx";
import * as Switch from "@radix-ui/react-switch";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

type Tone = "primary" | "quiet" | "danger" | "outline";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: ReactNode; small?: boolean }>(
  function Button({ tone = "outline", icon, small, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        {...rest}
        className={clsx(
          "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[6px] font-medium transition-[background,color,box-shadow,transform] active:translate-y-px disabled:cursor-default disabled:opacity-45",
          small ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
          tone === "primary" && "bg-accent text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_2px_6px_-2px_rgb(0_0_0/0.35)] hover:brightness-110",
          tone === "outline" && "border border-rule-strong bg-surface text-ink hover:border-ink-3 hover:bg-surface-2",
          tone === "quiet" && "text-ink-2 hover:bg-sunken/70 hover:text-ink",
          tone === "danger" && "border border-stamp-red/50 text-stamp-red hover:bg-stamp-red/10",
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
      className={clsx("inline-flex size-8 cursor-pointer items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink", className)}
    >
      {children}
    </button>
  );
}

/** Rubber-stamp label. Slight rotation unless `straight`. */
export function Stamp({ children, tone = "ink", tilt = -2, className, size = "sm" }: {
  children: ReactNode;
  tone?: "ink" | "red" | "violet" | "green";
  tilt?: number;
  className?: string;
  size?: "xs" | "sm" | "lg";
}) {
  return (
    <span
      className={clsx(
        "stamp inline-block",
        size === "xs" && "text-[9px]",
        size === "sm" && "text-[10px]",
        size === "lg" && "px-2.5 text-[15px] tracking-[0.18em]",
        tone === "ink" && "text-ink-2",
        tone === "red" && "text-stamp-red",
        tone === "violet" && "text-stamp-violet",
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
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
        active
          ? tone === "red"
            ? "border-stamp-red bg-stamp-red text-[var(--surface)]"
            : "border-ink bg-ink text-[var(--surface)]"
          : "border-rule-strong text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
      {count !== undefined && <span className={clsx("typed text-[11px]", active ? "opacity-70" : "text-ink-4")}>{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[7px] border border-rule-strong bg-sunken/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-7 cursor-pointer rounded-[5px] px-3 text-[12.5px] transition-colors",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.15)]" : "text-ink-3 hover:text-ink",
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
      className="relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border border-rule-strong bg-sunken transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-4 translate-x-[2px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-transform data-[state=checked]:translate-x-[18px]" />
    </Switch.Root>
  );
}

export function MenuButton({ trigger, items }: { trigger: ReactNode; items: { label: string; icon?: ReactNode; onSelect(): void; danger?: boolean }[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="paper z-50 min-w-[180px] rounded-[8px] p-1">
          {items.map((it) => (
            <Menu.Item
              key={it.label}
              onSelect={it.onSelect}
              className={clsx(
                "flex h-8 cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-[13px] outline-none data-[highlighted]:bg-sunken",
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

/** Page heading: serif title, typed sub-line. */
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="font-display text-[60px] leading-[0.92] text-ink">{title}</h1>
        {sub && <p className="typed mt-1.5 text-[12px] text-ink-3">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-rule pb-1.5">
      <h2 className="caps text-ink-2">{children}</h2>
      {aside && <div className="typed text-[11.5px] text-ink-3">{aside}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="slip mx-auto my-10 max-w-[460px] rounded-[4px] px-8 pt-3 pb-7 text-center">
      <p className="caps h-[37px] pt-2 text-ink-3">Catalogue note</p>
      <p className="font-display mt-4 text-[22px] leading-[28px] text-ink">{title}</p>
      {children && <div className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
