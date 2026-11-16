"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixSlider from "@radix-ui/react-slider";
import * as RadixSwitch from "@radix-ui/react-switch";
import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "ghost" | "danger"; size?: "sm" | "md" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "soft", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-button font-semibold transition-[background-color,transform,opacity] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        size === "md" ? "min-h-11 px-4 text-[15px]" : "min-h-9 px-3 text-sm",
        variant === "primary" && "bg-accent-strong text-on-accent shadow-soft hover:brightness-110",
        variant === "soft" && "bg-accent-soft/70 text-ink hover:bg-accent-soft",
        variant === "ghost" && "text-ink hover:bg-accent-soft/50",
        variant === "danger" && "bg-danger text-white hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" | "lg"; active?: boolean };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full transition-[background-color,color,transform] active:scale-90 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "size-9 [&_svg]:size-[18px]",
        size === "md" && "size-11 [&_svg]:size-[22px]",
        size === "lg" && "size-14 [&_svg]:size-7",
        active ? "text-accent-strong" : "text-ink hover:bg-accent-soft/50",
        className,
      )}
      {...props}
    >
      {children}
      {active && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-accent-strong" />}
    </button>
  );
});

export function Chip({
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
        selected ? "border-transparent bg-accent-strong text-on-accent" : "border-line bg-surface-solid/60 text-ink hover:bg-accent-soft/60",
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("animate-spin", className)} />;
}

export function Switch({ label, ...props }: ComponentProps<typeof RadixSwitch.Root> & { label: string }) {
  return (
    <RadixSwitch.Root
      aria-label={label}
      className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors data-[state=checked]:bg-accent-strong"
      {...props}
    >
      <RadixSwitch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  );
}

export function Slider({ label, className, ...props }: ComponentProps<typeof RadixSlider.Root> & { label: string }) {
  const vertical = props.orientation === "vertical";
  return (
    <RadixSlider.Root
      className={cn(
        "relative flex touch-none select-none items-center",
        vertical ? "w-6 flex-col" : "h-6 w-full",
        className,
      )}
      {...props}
    >
      <RadixSlider.Track className={cn("relative grow overflow-hidden rounded-full bg-line", vertical ? "w-1.5" : "h-1.5")}>
        <RadixSlider.Range className={cn("absolute rounded-full bg-tint", vertical ? "w-full" : "h-full")} />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block size-4 rounded-full border-2 border-tint bg-surface-solid shadow-soft"
      />
    </RadixSlider.Root>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-surface-solid/60 p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-9 rounded-full px-4 text-sm font-semibold transition-colors",
            value === v ? "bg-accent-strong text-on-accent" : "text-ink hover:bg-accent-soft/60",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuSub = DropdownMenu.Sub;

export function MenuContent({ children, className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "glass z-[70] min-w-56 max-w-[calc(100vw-24px)] rounded-[20px] p-1.5 shadow-soft outline-none [background:var(--surface-solid)]",
          "data-[state=open]:animate-[menu-in_140ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const itemClass =
  "flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-chip px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-accent-soft/70 data-[disabled]:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted";

export function MenuItem({ icon, children, className, ...props }: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode }) {
  return (
    <DropdownMenu.Item className={cn(itemClass, className)} {...props}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenu.Item>
  );
}

export function MenuSubTrigger({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.SubTrigger className={cn(itemClass, "data-[state=open]:bg-accent-soft/50")}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenu.SubTrigger>
  );
}

export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        sideOffset={4}
        collisionPadding={12}
        className="z-[71] min-w-48 rounded-[20px] border border-line p-1.5 shadow-soft [background:var(--surface-solid)]"
      >
        {children}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="mx-2 my-1 h-px bg-line" />;

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-xl font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-dashed border-line px-4 py-8 text-center font-semibold text-muted">{children}</p>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-[30px] font-semibold leading-tight lg:text-[36px]">{children}</h1>
      {sub && <p className="mt-1 font-semibold text-muted">{sub}</p>}
    </header>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-button border border-line bg-surface-solid px-4 text-[16px] font-semibold text-ink outline-none placeholder:text-muted/80 focus:border-accent";
