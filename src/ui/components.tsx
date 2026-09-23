import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { describe } from '../api/problems';

export function Card({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title !== undefined && (
        <header className="card__head">
          <h2>{title}</h2>
          <div style={{ flex: 1 }} />
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A verdict, said in a word as well as a colour.
 *
 * Never colour alone. A red dot and a green dot are the same dot to eight per
 * cent of the men who will read this screen, and the thing being said is
 * whether the company's money adds up.
 */
export function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'alarm' | 'quiet';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Note({
  tone = 'alarm',
  children,
}: {
  tone?: 'ok' | 'warn' | 'alarm';
  children: ReactNode;
}) {
  return (
    <p className={`note note--${tone}`} role={tone === 'alarm' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

/**
 * What went wrong, in words somebody can act on.
 *
 * The correlation id is shown whenever there is one: it is what ties a
 * screenshot taken in Havana to a line in the server's log, and asking for it
 * afterwards never works because by then the page has been reloaded.
 */
export function Failure({ error }: { error: unknown }) {
  const correlation =
    error !== null && typeof error === 'object' && 'correlationId' in error
      ? ((error as { correlationId: string | null }).correlationId ?? null)
      : null;

  return (
    <Note>
      {describe(error)}
      {correlation !== null && (
        <>
          {' '}
          <span className="num muted" style={{ fontSize: 12 }}>
            ({correlation})
          </span>
        </>
      )}
    </Note>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="empty" role="status">
      Cargando {what}…
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * A modal that is actually a modal.
 *
 * `<dialog>` rather than a div with a high z-index: it takes focus, traps it,
 * closes on Escape and hides the rest of the page from a screen reader without
 * any of that being written here. The form underneath moves money, so the
 * cheap version — a floating panel the keyboard walks straight out of — is not
 * good enough.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      <div className="dialog__head">
        <h2>{title}</h2>
        {subtitle !== undefined && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{subtitle}</p>}
      </div>
      {children}
    </dialog>
  );
}

/** What a control needs to be described without being renamed. */
export interface FieldParts {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': boolean | undefined;
}

/**
 * A labelled control, with its hint and its error attached properly.
 *
 * The children are a function so the field can hand down the ids. The obvious
 * shape — wrapping the input in the `<label>` — makes the hint and the error
 * part of the control's accessible *name*, so a screen reader announces
 * "Importe 1.005 has 3 decimal places and the currency has 2" as the name of
 * the box. `aria-describedby` is what says those separately, which is also
 * what lets an error be announced when it appears rather than only when the
 * field is next focused.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (parts: FieldParts) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = error !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {children({
        id,
        'aria-describedby': described,
        'aria-invalid': error !== undefined ? true : undefined,
      })}
      {error !== undefined ? (
        <small id={errorId} style={{ color: 'var(--alarm)' }} role="alert">
          {error}
        </small>
      ) : (
        hint !== undefined && <small id={hintId}>{hint}</small>
      )}
    </div>
  );
}

/**
 * A moment, in the reader's own time zone.
 *
 * The wire is UTC; a treasurer comparing this against a bank statement is in
 * Havana. Showing the server's clock would make every figure look an hour off
 * for half the year.
 */
export function Moment({ at }: { at: string }) {
  const when = new Date(at);

  return (
    <time dateTime={at} className="num">
      {when.toLocaleString('es-CU', { dateStyle: 'short', timeStyle: 'medium' })}
    </time>
  );
}
