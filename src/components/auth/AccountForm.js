'use client';

import { useId, useState, useSyncExternalStore } from 'react';

const inputClass =
  'mt-2 block h-11 w-full rounded-app-xs border border-ink-soft bg-canvas px-4 text-body text-on-primary placeholder:text-mute ' +
  'focus:border-link-blue-soft focus:outline-2 focus:outline-offset-2 focus:outline-link-blue-soft';

/**
 * One form for every email/password page. It posts JSON to an /api/auth/account/* route and shows the answer. Errors are announced
 * (`role="alert"`), the button is disabled while a request is running, and the answers are the server's generic ones.
 *
 * @param {{
 *   endpoint: string,
 *   fields: { name: string, label: string, type?: string, autoComplete?: string, hint?: string }[],
 *   submitLabel: string,
 *   fixed?: Record<string, string>,   values sent with the form but not shown (for example a token)
 *   redirectTo?: string,              where to go on success (a safe, same-site path); otherwise the message is shown
 * }} props
 */
export default function AccountForm({ endpoint, fields, submitLabel, fixed = {}, redirectTo }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Until React has hydrated, a click would submit the form natively. The button stays disabled until then.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, ...fixed }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        if (redirectTo) {
          window.location.assign(redirectTo);
          return;
        }
        setDone(body.message ?? 'Done.');
      } else {
        setError(body.message ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setBusy(false);
  }

  if (done) {
    return (
      <p role="status" className="rounded-app-lg bg-surface-blue-bg p-4 text-body-sm text-ink">
        {done}
      </p>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={`${id}-${f.name}`} className="text-caption-tight text-on-primary">
            {f.label}
          </label>
          <input
            id={`${id}-${f.name}`}
            name={f.name}
            type={f.type ?? 'text'}
            autoComplete={f.autoComplete}
            required
            aria-describedby={f.hint ? `${id}-${f.name}-hint` : undefined}
            className={inputClass}
          />
          {f.hint ? (
            <p id={`${id}-${f.name}-hint`} className="mt-2 text-meta text-mute">
              {f.hint}
            </p>
          ) : null}
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-body-sm text-brand">
          <span className="font-medium">Problem: </span>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !ready}
        className="h-11 rounded-full bg-canvas-light px-6 text-button-lg font-medium text-ink hover:bg-canvas-paper disabled:opacity-60"
      >
        {busy ? 'Please wait…' : submitLabel}
      </button>
    </form>
  );
}
