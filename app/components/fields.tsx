import type { ReactNode } from "react";
import { isHexColor } from "../../contract/rules";
import { toSixDigitHex } from "../sections/colors";

type FieldShellProps = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Current length and maximum; a counter appears once the value gets close to the limit. */
  count?: { length: number; limit: number };
  children: ReactNode;
};

/**
 * Label, control, hint, counter and error message laid out consistently. The error and hint
 * are linked to the control through `aria-describedby` (see {@link describedBy}).
 *
 * @param props - Field metadata and the control itself.
 * @returns The field markup.
 */
function FieldShell({ id, label, error, hint, count, children }: FieldShellProps) {
  // The counter only appears near the limit, where it is actually useful.
  const showCount = count !== undefined && count.length >= count.limit * 0.8;
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {showCount && (
          <span className={`text-xs tabular-nums ${count.length > count.limit ? "font-semibold text-red-600" : "text-slate-500"}`}>
            {count.length}/{count.limit}
          </span>
        )}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Builds the `aria-describedby` value for a control.
 *
 * @param id - Control id.
 * @param error - Current error, if any.
 * @param hint - Hint content, if any.
 * @returns Space-separated element ids, or undefined.
 */
function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
  // The hint is hidden while an error is shown, so reference whichever is visible.
  if (error) {
    return `${id}-error`;
  }
  return hint ? `${id}-hint` : undefined;
}

const inputClass =
  "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

/**
 * Picks border colors for valid and invalid controls.
 *
 * @param error - Current error, if any.
 * @returns Tailwind classes.
 */
function stateClass(error?: string): string {
  // Red border makes the invalid field easy to find in a long list.
  return error ? "border-red-400 bg-red-50/40" : "border-slate-300";
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  limit?: number;
  placeholder?: string;
  type?: "text" | "url";
  /** Strip leading/trailing whitespace when the field loses focus (for URLs pasted with spaces). */
  trimOnBlur?: boolean;
};

/**
 * Single-line text input. The value is stored exactly as typed; limits are reported as
 * validation errors rather than enforced with `maxLength`, which would silently cut pasted text.
 *
 * @param props - Field props.
 * @returns The field.
 */
export function TextField({ id, label, value, onChange, error, hint, limit, placeholder, type = "text", trimOnBlur }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} count={limit ? { length: value.length, limit } : undefined}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={type === "text"}
        onChange={(event) => onChange(event.target.value)}
        // Trimming on blur (not on every keystroke) lets the user type spaces mid-edit.
        onBlur={trimOnBlur ? () => value !== value.trim() && onChange(value.trim()) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${inputClass} ${stateClass(error)}`}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<TextFieldProps, "type" | "trimOnBlur"> & { rows?: number };

/**
 * Multi-line text input; line breaks are preserved and rendered in the preview.
 *
 * @param props - Field props.
 * @returns The field.
 */
export function TextAreaField({ id, label, value, onChange, error, hint, limit, placeholder, rows = 3 }: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} count={limit ? { length: value.length, limit } : undefined}>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${inputClass} ${stateClass(error)} resize-y`}
      />
    </FieldShell>
  );
}

type ColorFieldProps = { id: string; label: string; value: string; onChange: (value: string) => void; error?: string };

/**
 * Hex color input: a native color picker for convenience plus a text box for exact values.
 * Both edit the same draft value, so typing "#12" shows an error until it is a valid color.
 *
 * @param props - Field props.
 * @returns The field.
 */
export function ColorField({ id, label, value, onChange, error }: ColorFieldProps) {
  // The native picker only understands #rrggbb; show black while the text is not a valid color.
  const pickerValue = isHexColor(value) ? toSixDigitHex(value) : "#000000";
  return (
    <FieldShell id={id} label={label} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} picker`}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
        />
        <input
          id={id}
          type="text"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error)}
          className={`${inputClass} ${stateClass(error)} font-mono`}
        />
      </div>
    </FieldShell>
  );
}

type SegmentedOption<T extends string> = { value: T; label: string; detail?: string };

type SegmentedControlProps<T extends string> = {
  name: string;
  legend: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
};

/**
 * A row of radio buttons styled as a segmented control. Real radio inputs give keyboard
 * arrow-key navigation and screen reader support for free.
 *
 * @param props - Group name, legend, options and the selected value.
 * @returns The fieldset.
 */
export function SegmentedControl<T extends string>({ name, legend, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="relative flex cursor-pointer flex-col items-center rounded-md px-2 py-1.5 text-center text-sm text-slate-600 transition has-[:checked]:bg-white has-[:checked]:font-medium has-[:checked]:text-slate-900 has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500"
          >
            {/* sr-only is absolutely positioned; the label's `relative` keeps it here, not at the page top. */}
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span>{option.label}</span>
            {option.detail && <span className="text-xs text-slate-500">{option.detail}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
