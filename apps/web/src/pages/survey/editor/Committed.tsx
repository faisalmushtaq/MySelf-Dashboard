import { useEffect, useState } from "react";

/**
 * A text box that makes its edit when the researcher leaves it (or presses
 * Enter in a one-line box), not on every keystroke — so a changed word is one
 * change in the draft's list, and a half-typed word never reaches it.
 */
export function Committed({
  value,
  onCommit,
  multiline = false,
  label,
  disabled = false,
  rows = 2,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => string | null | void;
  multiline?: boolean;
  label: string;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return;
    const problem = onCommit(text);
    if (problem) {
      setError(problem);
      setText(value);
    } else setError(null);
  };
  return (
    <label>
      {label}
      {multiline ? (
        <textarea value={text} rows={rows} disabled={disabled} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
