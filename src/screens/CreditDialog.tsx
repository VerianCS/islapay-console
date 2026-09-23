import { useEffect, useId, useState } from 'react';
import { Failure, Field, Modal, Note } from '../ui/components';
import { Money, formatMoney, parseMinorUnits } from '../money/money';
import { useCatalogue, useCredit, useScales } from '../api/queries';
import type { CreditReceipt } from '../api/queries';

const DESTINATIONS = [
  {
    value: 'float',
    label: 'Float — efectivo en banco o custodio',
  },
  {
    value: 'settlement_fund',
    label: 'Fondo de liquidación — de donde salen los pagos',
  },
] as const;

/**
 * The only door money enters by, as a form.
 *
 * Everything else in IslaPay moves money that is already there. This raises
 * the total, so it asks for more than the amount: where it came from, and why.
 * Both are required by the server and both are required here, early, because a
 * form that lets somebody type an amount and then refuses on submit has wasted
 * the one moment they were paying attention.
 */
export function CreditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalogue = useCatalogue();
  const scales = useScales();
  const credit = useCredit();
  const formId = useId();

  const [destination, setDestination] = useState<string>('float');
  const [currency, setCurrency] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<CreditReceipt | null>(null);

  // Whatever the catalogue lists first and a customer can hold. Chosen rather
  // than left blank so the common case is one field shorter, and re-chosen
  // only when the list itself arrives.
  useEffect(() => {
    if (currency === '' && catalogue.data && catalogue.data.length > 0) {
      setCurrency(catalogue.data[0]!.code);
    }
  }, [catalogue.data, currency]);

  useEffect(() => {
    if (!open) {
      setReceipt(null);
      credit.reset();
    }
    // `credit` is a stable mutation object; listing it would reset on every
    // render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = scales.find(currency);
  const amountError = validateAmount(amount, chosen?.scale);
  const sourceError = validateSource(source);
  const reasonError = reason.trim().length > 0 && reason.trim().length < 4
    ? 'Cuatro caracteres al menos: un ingreso sin explicación no se distingue de un error.'
    : undefined;

  const complete =
    chosen !== undefined &&
    amount.trim() !== '' &&
    amountError === undefined &&
    source.trim() !== '' &&
    sourceError === undefined &&
    reason.trim().length >= 4;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || chosen === undefined) return;

    credit.mutate(
      {
        destination,
        amount: Money.parseAmount(amount.trim(), chosen).toWire(),
        source: source.trim().toLowerCase(),
        reason: reason.trim(),
      },
      {
        onSuccess: (done) => {
          setReceipt(done);
          setAmount('');
          setReason('');
        },
      },
    );
  }

  if (receipt !== null) {
    const credited = scales.find(receipt.amount.currency);
    const after = scales.find(receipt.balanceAfter.currency);

    return (
      <Modal open={open} onClose={onClose} title="Ingreso registrado">
        <div className="dialog__body">
          <Note tone="ok">
            {receipt.applied
              ? 'El asiento se escribió.'
              : 'Ya estaba registrado con esa clave: no se movió dinero por segunda vez.'}
          </Note>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
            <dt className="muted">Importe</dt>
            <dd className="num" style={{ margin: 0 }}>
              {credited
                ? formatMoney(Money.parse(receipt.amount, scales))
                : `${receipt.amount.amount} ${receipt.amount.currency}`}
            </dd>
            <dt className="muted">Destino</dt>
            <dd style={{ margin: 0 }}>{receipt.destination}</dd>
            <dt className="muted">Saldo después</dt>
            <dd className="num" style={{ margin: 0 }}>
              {after
                ? formatMoney(Money.parse(receipt.balanceAfter, scales))
                : `${receipt.balanceAfter.amount} ${receipt.balanceAfter.currency}`}
            </dd>
            <dt className="muted">Origen</dt>
            <dd className="num" style={{ margin: 0 }}>
              {receipt.source}
            </dd>
            <dt className="muted">Asiento</dt>
            <dd className="num" style={{ margin: 0, fontSize: 12 }}>
              {receipt.postingId}
            </dd>
          </dl>
        </div>
        <div className="dialog__foot">
          <button type="button" className="primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ingresar dinero"
      subtitle="Doble entrada contra el espejo de donde vino. Queda firmado con tu cuenta."
    >
      <form id={formId} onSubmit={submit}>
        <div className="dialog__body">
          {credit.isError && <Failure error={credit.error} />}

          <Field label="Destino">
            {(parts) => (
              <select
                {...parts}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {DESTINATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <Field
              label="Importe"
              error={amountError}
              hint={
                chosen
                  ? `${chosen.scale} decimales, como lo cuenta el libro.`
                  : 'Elige una moneda.'
              }
            >
              {(parts) => (
                <input
                  {...parts}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="num"
                />
              )}
            </Field>

            <Field label="Moneda">
              {(parts) => (
                <select
                  {...parts}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {(catalogue.data ?? []).map((c) => (
                    <option key={c.code} value={c.code} disabled={!c.enabled}>
                      {c.code}
                      {c.enabled ? '' : ' (apagada)'}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field
            label="Origen"
            error={sourceError}
            hint="El espejo de donde salió: bank:bandec, capital. Es contra lo que se concilia un extracto."
          >
            {(parts) => (
              <input
                {...parts}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="bank:bandec"
                className="num"
              />
            )}
          </Field>

          <Field
            label="Motivo"
            error={reasonError}
            hint="Para quien lea el libro dentro de seis meses."
          >
            {(parts) => (
              <input
                {...parts}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Aporte de capital de septiembre"
              />
            )}
          </Field>
        </div>

        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={credit.isPending}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!complete || credit.isPending}>
            {credit.isPending ? 'Registrando…' : 'Registrar ingreso'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function validateAmount(amount: string, scale: number | undefined): string | undefined {
  const trimmed = amount.trim();
  if (trimmed === '' || scale === undefined) return undefined;

  let minor: bigint;
  try {
    minor = parseMinorUnits(trimmed, scale);
  } catch (error) {
    return error instanceof Error ? error.message : 'No es un importe.';
  }

  // Checked here as well as on the server, because the server's refusal costs
  // a round trip and arrives after the person has stopped looking at the field.
  if (minor <= 0n) return 'Un ingreso mete dinero. Para sacarlo, se asienta el inverso.';

  return undefined;
}

const MIRROR = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

function validateSource(source: string): string | undefined {
  const trimmed = source.trim().toLowerCase();
  if (trimmed === '') return undefined;

  return MIRROR.test(trimmed)
    ? undefined
    : 'Minúsculas, cifras y . _ - : — es parte del nombre de una cuenta.';
}
