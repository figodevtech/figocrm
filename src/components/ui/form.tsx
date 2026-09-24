'use client';
// Campos de formulário: label sempre visível, texto 16px (iPhone não dá zoom), erro ligado por aria-describedby.
import { useId, type ComponentProps, type ReactNode } from 'react';

const inputBase =
  'w-full min-h-12 rounded-xl border border-white/10 bg-slate-900/80 px-4 text-base text-white placeholder-slate-500 ' +
  'transition-colors focus:border-emerald-400 aria-[invalid=true]:border-rose-400';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300">
        {label}
        {required ? <span className="text-emerald-400" aria-hidden> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="text-sm text-slate-500">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}

type TextProps = Omit<ComponentProps<'input'>, 'id'> & { label: string; hint?: ReactNode; error?: string | null };

export function TextField({ label, hint, error, required, className = '', ...props }: TextProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${inputBase} ${className}`}
        {...props}
      />
    </Field>
  );
}

/** Dinheiro: guarda o texto digitado; quem usa converte com parseMoneyInput. */
export function MoneyField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  autoFocus,
  placeholder = '0',
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  name?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400">
          R$
        </span>
        <input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${inputBase} tabular pl-12 text-lg font-semibold`}
        />
      </div>
    </Field>
  );
}

export function TextAreaField({ label, hint, error, className = '', ...props }: Omit<ComponentProps<'textarea'>, 'id'> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        className={`${inputBase} min-h-24 py-3 ${className}`}
        {...props}
      />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  className = '',
  ...props
}: Omit<ComponentProps<'select'>, 'id'> & { label: string; hint?: ReactNode; error?: string | null; options: Array<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <select id={id} className={`${inputBase} appearance-none ${className}`} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Escolha única em botões grandes (radio group acessível). */
export function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 2,
}: {
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; description?: string }>;
  columns?: 1 | 2 | 3 | 4;
}) {
  const id = useId();
  const cols = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[columns];
  return (
    <fieldset className="space-y-1.5">
      <legend id={id} className="mb-1.5 block text-sm font-medium text-slate-300">{label}</legend>
      <div role="radiogroup" aria-labelledby={id} className={`grid gap-2 ${cols}`}>
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`min-h-12 rounded-xl border px-3 py-2 text-left text-base transition-colors ${
                selected ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-white/10 bg-white/3 text-slate-300 hover:bg-white/6'
              }`}
            >
              <span className="block font-semibold">{o.label}</span>
              {o.description ? <span className="block text-sm text-slate-400">{o.description}</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
