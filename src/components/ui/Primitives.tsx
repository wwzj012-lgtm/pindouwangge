import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-purple-600 text-white shadow-sm hover:bg-purple-700 focus-visible:ring-purple-300',
  success: 'border-transparent bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 focus-visible:ring-emerald-300',
  secondary: 'border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 focus-visible:ring-purple-200',
  ghost: 'border-transparent bg-transparent text-purple-700 hover:bg-purple-50 focus-visible:ring-purple-200',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-200',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 min-h-9 px-2.5 text-[10px]',
  md: 'h-9 min-h-9 px-3 text-xs',
};

function cx(...classes: Array<string | undefined | false>): string {
  return classes.filter(Boolean).join(' ');
}

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: (event: any) => void;
  [key: string]: any;
}

/** Shared action button with stable variants and keyboard-visible focus treatment. */
export function Button({ className, variant = 'secondary', size = 'sm', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-bold transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export interface CardProps {
  children: ReactNode;
  className?: string;
  [key: string]: any;
}

/** Shared surface primitive for panels that need one consistent border/radius/shadow. */
export function Card({ className, children, ...props }: CardProps) {
  return (
    <section className={cx('rounded-xl border border-purple-200/80 bg-white shadow-2xs', className)} {...props}>
      {children}
    </section>
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  [key: string]: any;
}

/** Label wrapper shared by form controls; keeps helper/error text accessible and predictable. */
export function Field({ className, label, hint, error, children, ...props }: FieldProps) {
  return (
    <label className={cx('block', className)} {...props}>
      <span className="flex items-baseline justify-between gap-2 text-[11px] font-black text-purple-900">
        <span>{label}</span>
        {hint && <span className="text-[10px] font-bold text-purple-400">{hint}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? <span className="mt-1 block text-[10px] font-bold text-rose-700" role="alert">{error}</span> : null}
    </label>
  );
}

const INPUT_CLASSES = [
  'min-h-8 w-full rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-[11px] text-purple-950',
  'outline-none placeholder:text-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-70',
].join(' ');

/** Shared text input primitive with the same height, radius, focus, and disabled states as Button. */
export interface InputProps {
  className?: string;
  type?: string;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  placeholder?: string;
  disabled?: boolean;
  onChange?: (event: any) => void;
  [key: string]: any;
}

export function Input({ className, type = 'text', ...props }: InputProps) {
  return <input type={type} className={cx(INPUT_CLASSES, className)} {...props} />;
}
