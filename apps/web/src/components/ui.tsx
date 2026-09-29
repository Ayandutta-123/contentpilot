'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useRef } from 'react';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import clsx from 'clsx';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('shrink-0 animate-spin', className)} aria-hidden="true" />;
}

export function BackButton({
  href,
  label = 'Back',
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={clsx('back-button', className)}>
      <span className="back-button-icon" aria-hidden="true">
        <ArrowLeft size={17} />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function WorkflowStepper({
  steps,
  current,
  className,
}: {
  steps: ReadonlyArray<{ id: number; label: string }>;
  current: number;
  className?: string;
}) {
  return (
    <ol className={clsx('workflow-stepper', className)} aria-label="Workflow progress">
      {steps.map((step, index) => {
        const complete = step.id < current;
        const active = step.id === current;
        return (
          <li
            key={step.id}
            className="workflow-step"
            data-active={active}
            data-complete={complete}
            aria-current={active ? 'step' : undefined}
          >
            <span className="workflow-step-marker">
              {complete ? <Check size={14} strokeWidth={3} /> : step.id}
            </span>
            <span className="workflow-step-label">{step.label}</span>
            {index < steps.length - 1 && <span className="workflow-step-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

type ProcessingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'danger-outline' | 'ghost' | 'sector' | 'sector-outline';
};

export function ProcessingButton({
  loading = false,
  loadingText = 'Processing…',
  icon,
  variant = 'primary',
  className,
  children,
  disabled,
  onPointerDown,
  ...props
}: ProcessingButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      data-loading={loading}
      onPointerDown={(event) => {
        const el = ref.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          el.style.setProperty('--x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
          el.style.setProperty('--y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
        }
        onPointerDown?.(event);
      }}
      className={clsx(
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'success' && 'btn-success',
        variant === 'danger' && 'btn-danger',
        variant === 'danger-outline' && 'btn-danger-outline',
        variant === 'ghost' && 'btn-ghost',
        variant === 'sector' && 'btn-sector',
        variant === 'sector-outline' && 'btn-sector-outline',
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {(loading ? loadingText : children) ? (
        <span className="relative z-[1]">{loading ? loadingText : children}</span>
      ) : null}
    </button>
  );
}

export function ProgressBar({
  label = 'Processing',
  value,
}: {
  label?: string;
  value?: number;
}) {
  const determinate = typeof value === 'number';
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        <span className="inline-flex items-center gap-2">
          <Spinner size={14} />
          {label}
        </span>
        {determinate && <span className="tabular-nums">{Math.round(value)}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
        <div
          className={clsx(
            'h-full rounded-full bg-brand-600 transition-[width] duration-300',
            !determinate && 'w-1/2 origin-left animate-progress',
          )}
          style={determinate ? { width: `${Math.max(0, Math.min(100, value))}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function LoadingState({
  title = 'Loading',
  description = 'Preparing everything for you…',
  fullScreen = false,
}: {
  title?: string;
  description?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-center justify-center px-6',
        fullScreen ? 'min-h-screen' : 'min-h-[280px]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-xs rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center shadow-sm animate-scale-in">
        <div className="relative mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
          <Sparkles size={22} className="animate-float" />
          <span className="absolute inset-0 rounded-2xl border border-brand-500/30 animate-ping" />
        </div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
        <div className="mx-auto mt-4 h-1.5 max-w-40 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          <div className="h-full w-1/2 rounded-full bg-brand-600 animate-progress" />
        </div>
      </div>
    </div>
  );
}

export function ProcessOverlay({
  open,
  title = 'Working…',
  description = 'Please wait while we finish this step.',
  onCancel,
  cancelLabel = 'Abort',
}: {
  open: boolean;
  title?: string;
  description?: string;
  /** Shown while generating — stops waiting and cancels the job when possible */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  if (!open) return null;
  return (
    <div className="process-overlay" role="alertdialog" aria-modal="true" aria-busy="true">
      <div className="process-panel">
        <div className="flex items-start gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
            <Spinner size={20} />
            <span className="absolute inset-0 rounded-2xl border border-brand-500/25 animate-pulse-soft" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          <div className="h-full w-1/2 rounded-full bg-brand-600 animate-progress" />
        </div>
        {onCancel ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-danger-outline min-h-[44px] !px-4 text-sm md:!min-h-[36px] md:text-xs"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('skeleton', className)} {...props} />;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={clsx('flex min-h-[52px] items-center justify-between gap-4 rounded-xl px-1', disabled && 'opacity-50')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="helper-text mt-0.5 block">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-checked={checked}
        className="switch"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </label>
  );
}

export function RangeSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  description,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  description?: string;
}) {
  const pct = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <label className="block space-y-2.5">
      <span className="flex items-center justify-between gap-3 text-sm font-medium">
        {label}
        <span className="min-w-12 rounded-lg bg-[hsl(var(--muted))] px-2 py-1 text-center text-xs tabular-nums font-semibold">
          {value}{suffix}
        </span>
      </span>
      <div className="relative">
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-brand-600/80"
          style={{ width: `${pct}%` }}
        />
        <input
          {...props}
          type="range"
          className={clsx('range relative z-[1]', props.className)}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      {description && <span className="helper-text block">{description}</span>}
    </label>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <div className={clsx('segmented', className)} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          data-active={value === opt.value}
          className="segmented-item"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function InlineNotice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'success' | 'error';
  children: ReactNode;
}) {
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'error' ? AlertCircle : Sparkles;
  return (
    <div
      className={clsx(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm animate-fade-in',
        kind === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        kind === 'error' && 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
        kind === 'info' && 'border-brand-500/25 bg-brand-500/5 text-[hsl(var(--foreground))]',
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
