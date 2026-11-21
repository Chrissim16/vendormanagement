import clsx from "clsx";
import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ApiError, messageOf } from "../lib/api";
import { Button, ErrorState, Field, Select, TextInput } from "./ui";

/**
 * The form pattern (X-3). Holds what the person typed, sends it, and when saving fails
 * keeps every value, puts each problem next to its field and says what went wrong.
 * `check` may return problems found before sending, keyed by field.
 */
export function useForm<V extends Record<string, unknown>, R>(
  initial: V,
  save: (values: V) => Promise<R>,
  options: { check?: (values: V) => Record<string, string>; onSaved: (result: R) => void },
) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** `alsoClear` names server-side fields whose message belongs to this box (the box "budget" holds the server's "budgetMinor"). */
  const set = <K extends keyof V>(key: K, value: V[K], alsoClear: string[] = []) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ([key as string, ...alsoClear].some((k) => e[k]) ? { ...e, ...Object.fromEntries([key as string, ...alsoClear].map((k) => [k, ""])) } : e));
  };
  /** Replace several values at once, for example when one choice makes other fields irrelevant. */
  const patch = (changes: Partial<V>) => setValues((v) => ({ ...v, ...changes }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = options.check?.(values) ?? {};
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      setProblem("Some of what was entered is not valid.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      options.onSaved(await save(values));
    } catch (err) {
      setErrors(err instanceof ApiError ? (err.fields ?? {}) : {});
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return { values, set, patch, errors, problem, busy, submit };
}

type Form = { errors: Record<string, string> };
const invalid = (form: Form, name: string) => (form.errors[name] ? { "aria-invalid": true as const, "aria-describedby": `f-${name}-error` } : {});

export function TextField({
  form,
  name,
  label,
  hint,
  className,
  ...props
}: { form: Form; name: string; label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "form">) {
  return (
    <Field label={label} htmlFor={`f-${name}`} error={form.errors[name]}>
      <TextInput id={`f-${name}`} {...invalid(form, name)} {...props} className={clsx(form.errors[name] && "border-crit", className)} />
      {hint && !form.errors[name] && <p className="num text-[12.5px] text-ink-2">{hint}</p>}
    </Field>
  );
}

export function SelectField({
  form,
  name,
  label,
  children,
  className,
  ...props
}: { form: Form; name: string; label: string; children: ReactNode } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "form">) {
  return (
    <Field label={label} htmlFor={`f-${name}`} error={form.errors[name]}>
      <Select id={`f-${name}`} {...invalid(form, name)} {...props} className={clsx(form.errors[name] && "border-crit", className)}>
        {children}
      </Select>
    </Field>
  );
}

export function TextAreaField({ form, name, label, ...props }: { form: Form; name: string; label: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "form">) {
  return (
    <Field label={label} htmlFor={`f-${name}`} error={form.errors[name]}>
      <textarea
        id={`f-${name}`}
        rows={3}
        {...invalid(form, name)}
        {...props}
        className={clsx("min-w-0 rounded-2xl border border-line-2 bg-surface px-4 py-2.5 text-sm placeholder:text-ink-3 hover:border-ink-3", form.errors[name] && "border-crit")}
      />
    </Field>
  );
}

export function CheckField({ label, hint, checked, onChange, id }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] accent-[var(--primary)]" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-ink-2">{hint}</span>}
      </span>
    </label>
  );
}

/** The bottom of every form: what went wrong, then Cancel and the one primary action. */
export function FormFooter({ problem, busy, submitLabel, onCancel }: { problem: string | null; busy: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <>
      {problem && <ErrorState message={problem} />}
      <div className="flex justify-end gap-2.5">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" aria-disabled={busy || undefined}>
          {busy ? "Saving" : submitLabel}
        </Button>
      </div>
    </>
  );
}

export const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-4 gap-y-4">{children}</div>;
