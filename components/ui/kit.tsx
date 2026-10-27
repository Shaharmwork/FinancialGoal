"use client";

import Image, { type StaticImageData } from "next/image";
import type {
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { InfoHelp } from "@/components/info-help";

// Shared building blocks for the dark bronze look of the dashboard.

export function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="dashboard-gold-label text-[11px] font-semibold uppercase tracking-[0.18em]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="dashboard-gold-title mt-1 text-[28px] font-bold tracking-[0.01em]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[#b0947a]">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 self-start">{action}</div> : null}
    </header>
  );
}

export function Panel({
  children,
  className,
  icon,
  id,
  panelRef,
  subtitle,
  title,
  titleAction,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  icon?: StaticImageData;
  id?: string;
  panelRef?: Ref<HTMLElement>;
  subtitle?: ReactNode;
  title?: ReactNode;
  titleAction?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      ref={panelRef}
      id={id}
      className={cx(
        "relative scroll-mt-6 rounded-[22px] border p-4 shadow-[inset_0_1px_0_rgba(255,226,190,0.07),0_18px_40px_rgba(0,0,0,0.45)]",
        tone === "danger"
          ? "border-[#ff6b5b]/55 bg-[linear-gradient(180deg,rgba(52,20,16,0.97),rgba(24,11,9,0.98))]"
          : "border-[#a8744a]/45 bg-[linear-gradient(180deg,rgba(38,28,22,0.97),rgba(19,14,11,0.98))]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3px] rounded-[19px] border border-[#f1c78a]/[0.07]"
      />
      {title ? (
        <div className="relative mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon ? (
              <span className="relative h-8 w-8 shrink-0">
                <Image alt="" className="object-contain" fill sizes="32px" src={icon} />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="dashboard-gold-title text-[13px] font-semibold uppercase tracking-[0.14em]">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-1 text-xs text-[#a88c71]">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {titleAction ? <div className="shrink-0">{titleAction}</div> : null}
        </div>
      ) : null}
      <div className="relative">{children}</div>
    </section>
  );
}

export function FieldLabel({
  children,
  info,
  trailing,
}: {
  children: ReactNode;
  info?: { title: string; body: ReactNode };
  trailing?: ReactNode;
}) {
  return (
    <span className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9a57f]">
          {children}
        </span>
        {info ? <InfoHelp body={info.body} title={info.title} /> : null}
      </span>
      {trailing}
    </span>
  );
}

// Spinner arrows are hidden so short number fields show their whole value.
export function inputClassName(invalid = false, extra?: string) {
  return cx(
    "w-full min-w-0 rounded-[13px] border bg-[#0f0b08] px-3.5 py-3 text-[15px] text-[#f7ebda] outline-none transition placeholder:text-[#6f5a47] disabled:cursor-not-allowed disabled:opacity-50",
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    invalid
      ? "border-[#ff6b5b]/75 bg-[#260d0a] focus:border-[#ff8a7a]"
      : "border-[#8a603d]/55 focus:border-[#e7b277] focus:shadow-[0_0_0_3px_rgba(231,178,119,0.14)]",
    extra,
  );
}

function parseOptionalNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function NumberField({
  disabled,
  help,
  info,
  inputRef,
  invalid,
  label,
  onChange,
  placeholder,
  prefix,
  step = "any",
  suffix,
  trailing,
  value,
}: {
  disabled?: boolean;
  help?: ReactNode;
  info?: { title: string; body: ReactNode };
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  label: ReactNode;
  onChange: (value: number | null) => void;
  placeholder?: string;
  prefix?: string;
  step?: number | string;
  suffix?: string;
  trailing?: ReactNode;
  value: number | null;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel info={info} trailing={trailing}>
        {label}
      </FieldLabel>
      <span className="relative block">
        {prefix ? (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-[#a88c71]">
            {prefix}
          </span>
        ) : null}
        <input
          ref={inputRef}
          className={inputClassName(
            invalid,
            cx(prefix && "pl-8", suffix && "pr-12"),
          )}
          disabled={disabled}
          inputMode="decimal"
          min="0"
          placeholder={placeholder}
          step={step}
          type="number"
          value={value ?? ""}
          onChange={(event) => onChange(parseOptionalNumber(event.target.value))}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-[#a88c71]">
            {suffix}
          </span>
        ) : null}
      </span>
      {help ? <span className="mt-1.5 block text-xs leading-5 text-[#a88c71]">{help}</span> : null}
    </label>
  );
}

export interface SegmentOption<Value extends string> {
  value: Value;
  label: ReactNode;
  hint?: ReactNode;
}

export function Segmented<Value extends string>({
  disabled,
  firstButtonRef,
  invalid,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  firstButtonRef?: Ref<HTMLButtonElement>;
  invalid?: boolean;
  label: string;
  onChange: (value: Value) => void;
  options: Array<SegmentOption<Value>>;
  value: Value | null;
}) {
  return (
    <div
      aria-label={label}
      className={cx(
        "grid gap-1 rounded-[15px] border bg-[#0f0b08] p-1",
        invalid ? "border-[#ff6b5b]/75" : "border-[#8a603d]/55",
      )}
      role="group"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            ref={index === 0 ? firstButtonRef : undefined}
            aria-pressed={isActive}
            className={cx(
              "min-w-0 rounded-[11px] px-2 py-2.5 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
              isActive
                ? "bg-[linear-gradient(180deg,#ffe6a6_0%,#f0b65f_48%,#bf7a3c_100%)] text-[#1b0f05] shadow-[0_0_10px_rgba(255,190,90,0.28)]"
                : "text-[#d8bd9c] hover:bg-[#1d1510]",
            )}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span className="block truncate">{option.label}</span>
            {option.hint ? (
              <span
                className={cx(
                  "mt-0.5 block truncate text-[11px] font-medium",
                  isActive ? "text-[#4a2a10]" : "text-[#8f7559]",
                )}
              >
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  buttonRef?: Ref<HTMLButtonElement>;
  size?: "md" | "sm";
};

export function GoldButton({ buttonRef, className, size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap border border-[#fff1c4]/70 bg-[linear-gradient(180deg,#ffe9a8_0%,#f2b860_45%,#c27a3a_100%)] font-semibold text-[#1b0f05] shadow-[0_0_12px_rgba(255,190,90,0.32),0_8px_18px_rgba(0,0,0,0.35)] transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        size === "sm" ? "rounded-[11px] px-3 py-2 text-[13px]" : "rounded-[14px] px-4 py-3 text-[15px]",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function GhostButton({ buttonRef, className, size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap border border-[#a97849]/60 bg-[#1a1410] font-semibold text-[#e8cfae] transition hover:bg-[#241a14] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "rounded-[11px] px-3 py-2 text-[13px]" : "rounded-[14px] px-4 py-3 text-[15px]",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function TextButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "whitespace-nowrap text-[13px] font-semibold text-[#c9a57f] underline-offset-4 transition hover:text-[#f3e4cf] hover:underline disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function IconButton({
  className,
  label,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#a97849]/45 bg-[#15100c] text-[#d8bd9c] transition hover:bg-[#241a14] hover:text-[#fff3df] disabled:cursor-not-allowed disabled:opacity-35",
        className,
      )}
      title={label}
      type={type}
      {...props}
    />
  );
}

export function Stat({
  hint,
  label,
  onClick,
  tone = "default",
  value,
}: {
  hint?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  tone?: "default" | "good" | "warn";
  value: ReactNode;
}) {
  const content = (
    <>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a88c71]">
        {label}
      </p>
      <p
        className={cx(
          "mt-1 truncate text-[17px] font-semibold",
          tone === "good"
            ? "text-[#aaf0be]"
            : tone === "warn"
              ? "text-[#ffcf6e]"
              : "dashboard-gold-value",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-[#8f7559]">{hint}</p> : null}
    </>
  );
  const className =
    "min-w-0 rounded-[14px] border border-[#8a603d]/35 bg-[#120d0a]/80 px-3 py-2.5 text-left";

  if (onClick) {
    return (
      <button
        className={cx(className, "transition hover:border-[#e7b277]/60 hover:bg-[#1d1510]")}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

export function Notice({
  action,
  children,
  title,
  tone = "info",
}: {
  action?: ReactNode;
  children?: ReactNode;
  title: ReactNode;
  tone?: "info" | "warn" | "danger";
}) {
  return (
    <div
      className={cx(
        "rounded-[16px] border px-3.5 py-3 text-sm",
        tone === "danger"
          ? "border-[#ff6b5b]/50 bg-[#2a0f0c]/80 text-[#ffd9d2]"
          : tone === "warn"
            ? "border-[#ffcf6e]/40 bg-[#2a1d08]/70 text-[#ffe9bf]"
            : "border-[#a8744a]/40 bg-[#120d0a]/80 text-[#e8d4b8]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {children ? <div className="mt-1 text-[13px] leading-5 opacity-85">{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export function Toast({
  message,
  onDismiss,
  tone,
}: {
  message: string;
  onDismiss: () => void;
  tone: "success" | "error";
}) {
  if (!message) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[2147483000] px-3">
      <div
        aria-live="polite"
        className={cx(
          "pointer-events-auto mx-auto flex w-full max-w-[24rem] items-start gap-3 rounded-[16px] border px-4 py-3 text-sm shadow-[0_18px_36px_rgba(0,0,0,0.5)] backdrop-blur",
          tone === "success"
            ? "border-[#7fd99b]/45 bg-[#0f1c12]/95 text-[#d6f7df]"
            : "border-[#ff6b5b]/55 bg-[#240c09]/95 text-[#ffd9d2]",
        )}
        role={tone === "error" ? "alert" : "status"}
      >
        <span aria-hidden="true" className="mt-px text-base leading-none">
          {tone === "success" ? "✓" : "!"}
        </span>
        <p className="flex-1 leading-5">{message}</p>
        <button
          aria-label="Dismiss message"
          className="shrink-0 rounded-full px-1.5 text-base leading-none opacity-70 transition hover:opacity-100"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Sticky bar above the dock: the one place to save or discard changes on a screen.
export function SaveBar({
  detail,
  isSaving,
  onDiscard,
  onSave,
  saveLabel = "Save",
  title = "Unsaved changes",
  visible,
}: {
  detail?: ReactNode;
  isSaving?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  title?: string;
  visible: boolean;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cx(
        "fixed inset-x-0 bottom-[8.25rem] z-[170] px-3 transition duration-200",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <div className="flex w-full items-center gap-3 rounded-[18px] border border-[#e0a25a]/55 bg-[linear-gradient(180deg,rgba(40,29,21,0.98),rgba(20,14,10,0.98))] py-2 pl-4 pr-2 shadow-[0_0_24px_rgba(224,162,90,0.18),0_16px_32px_rgba(0,0,0,0.55)] backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#ffe6c2]">{title}</p>
          {detail ? <p className="truncate text-xs text-[#a88c71]">{detail}</p> : null}
        </div>
        <TextButton disabled={isSaving} onClick={onDiscard} tabIndex={visible ? 0 : -1}>
          Discard
        </TextButton>
        <GoldButton disabled={isSaving} onClick={onSave} size="sm" tabIndex={visible ? 0 : -1}>
          {isSaving ? "Saving…" : saveLabel}
        </GoldButton>
      </div>
    </div>
  );
}

export function StatusDot({
  onGold = false,
  tone,
}: {
  // On a gold (selected) background the dot gets a dark ring so its colour stays readable.
  onGold?: boolean;
  tone: "worked" | "no_work" | "vacation" | "missing";
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block rounded-full",
        onGold ? "h-2 w-2 ring-2 ring-[#1b0f05]" : "h-1.5 w-1.5",
        tone === "worked"
          ? "bg-[#8fe0a6] shadow-[0_0_6px_rgba(143,224,166,0.7)]"
          : tone === "no_work"
            ? "bg-[#8fc4e8]"
            : tone === "vacation"
              ? "bg-[#ffcf6e]"
              : "bg-[#ff7a6a] shadow-[0_0_6px_rgba(255,122,106,0.7)]",
      )}
    />
  );
}
