import { useEffect, useId, useState } from 'react';
import {
  readMoney,
  useCatalogue,
  useCreateP2PMethod,
  useP2PMethods,
  useScales,
  useSetP2PAvailable,
  useSetP2PInstructions,
  useSetP2PRate,
  useUpdateP2PMethod,
} from '../api/queries';
import type { CurrencyDto, P2PAdminMethod, P2PSide } from '../api/queries';
import { Money, formatMoney, parseMinorUnits } from '../money/money';
import type { Currency } from '../money/money';
import { Can, useCan } from '../auth/AuthProvider';
import { Badge, Card, Empty, Failure, Field, Loading, Modal, Moment, Note } from '../ui/components';

/**
 * The desk's rails, edited without touching the database.
 *
 * A rail is a currency, not a channel: one CUP, whichever app the pesos move
 * through, priced separately against each currency a customer holds. Until
 * this screen a new rail or a new limit was an INSERT somebody ran by hand.
 */
export function P2PMethods() {
  const methods = useP2PMethods();
  const [creating, setCreating] = useState(false);
  const manage = useCan(Can.p2pManage);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Métodos P2P</h1>
          <p>
            Un método por moneda local. Cada uno tiene su precio contra E-ISLA, USDT y USDC,
            en los dos sentidos o en uno solo; los límites van en la moneda local, que es lo
            que la mesa mueve.
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {manage && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            Nuevo método
          </button>
        )}
      </div>

      {!manage && (
        <Note tone="warn">
          Sólo lectura. Precios, límites e instrucciones los cambia quien tenga el rol
          p2p-manager; quien liquida operaciones no fija el precio al que liquida.
        </Note>
      )}

      {methods.isError ? (
        <Card>
          <div className="card__body">
            <Failure error={methods.error} />
          </div>
        </Card>
      ) : methods.data === undefined ? (
        <Card>
          <Loading what="los métodos" />
        </Card>
      ) : methods.data.length === 0 ? (
        <Card>
          <Empty>No hay ningún método todavía.</Empty>
        </Card>
      ) : (
        methods.data.map((m) => <MethodCard key={m.id} method={m} />)
      )}

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        taken={new Set((methods.data ?? []).map((m) => m.code))}
      />
    </>
  );
}

// ------------------------------------------------------------------- a rail

function MethodCard({ method }: { method: P2PAdminMethod }) {
  const toggle = useSetP2PAvailable();
  const manage = useCan(Can.p2pManage);
  const priced = method.rates.length > 0;

  return (
    <Card
      title={`${method.name} · ${method.code}`}
      aside={
        <>
          <Badge tone={method.available ? (priced ? 'ok' : 'warn') : 'quiet'}>
            {method.available ? (priced ? 'Encendido' : 'Encendido, sin precios') : 'Apagado'}
          </Badge>
          <button
            type="button"
            style={{ marginLeft: 8 }}
            hidden={!manage}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ id: method.id, value: !method.available })}
          >
            {method.available ? 'Apagar' : 'Encender'}
          </button>
        </>
      }
    >
      <div className="card__body">
        {toggle.isError && <Failure error={toggle.error} />}
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Cambiado por última vez: <Moment at={method.updatedAt} />
        </p>
        {/* One switch for every control below: a disabled fieldset disables
            what it holds, so a read-only viewer cannot half-edit a price. */}
        <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }}>
          <Limits method={method} />
          <Rates method={method} />
          <Instructions method={method} />
        </fieldset>
      </div>
    </Card>
  );
}

function Limits({ method }: { method: P2PAdminMethod }) {
  const scales = useScales();
  const update = useUpdateP2PMethod();
  const local = scales.find(method.code);
  const [name, setName] = useState(method.name);
  const [minimum, setMinimum] = useState(method.minimum.amount);
  const [maximum, setMaximum] = useState(method.maximum.amount);

  useEffect(() => {
    setName(method.name);
    setMinimum(method.minimum.amount);
    setMaximum(method.maximum.amount);
  }, [method.name, method.minimum.amount, method.maximum.amount]);

  const minError = amountError(minimum, local);
  const maxError = amountError(maximum, local);
  const changed =
    name.trim() !== method.name ||
    minimum.trim() !== method.minimum.amount ||
    maximum.trim() !== method.maximum.amount;

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (local === undefined || minError !== undefined || maxError !== undefined) return;

    update.mutate({
      id: method.id,
      update: {
        ...(name.trim() !== method.name ? { name: name.trim() } : {}),
        minimum: Money.parseAmount(minimum.trim(), local).toWire(),
        maximum: Money.parseAmount(maximum.trim(), local).toWire(),
      },
    });
  }

  const min = readMoney(method.minimum, scales);
  const max = readMoney(method.maximum, scales);

  return (
    <form onSubmit={save} style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
        Nombre y límites{' '}
        <span className="muted" style={{ fontWeight: 400 }}>
          (hoy: de {min ? formatMoney(min) : method.minimum.amount} a{' '}
          {max ? formatMoney(max) : method.maximum.amount})
        </span>
      </h3>
      {update.isError && <Failure error={update.error} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <Field label="Nombre">
          {(parts) => <input {...parts} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}
        </Field>
        <Field label={`Mínimo (${method.code})`} error={minError}>
          {(parts) => (
            <input {...parts} className="num" inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          )}
        </Field>
        <Field label={`Máximo (${method.code})`} error={maxError}>
          {(parts) => (
            <input {...parts} className="num" inputMode="decimal" value={maximum} onChange={(e) => setMaximum(e.target.value)} />
          )}
        </Field>
        <button type="submit" disabled={!changed || update.isPending || minError !== undefined || maxError !== undefined}>
          {update.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

/**
 * Both prices for every wallet currency, edited in place.
 *
 * A price saved empty withdraws that side — the server appends a row with no
 * rate rather than deleting, so the history still says when it stopped. The
 * two sides are named from the customer's side of the counter, because that is
 * how the operator hears about them: "somebody wants to sell USDT".
 */
function Rates({ method }: { method: P2PAdminMethod }) {
  const catalogue = useCatalogue();
  const setRate = useSetP2PRate();
  const wallets = (catalogue.data ?? []).filter((c) => c.customerHoldable && c.enabled);
  const current = (code: string, side: P2PSide) => {
    const row = method.rates.find((r) => r.currency === code);
    return (side === 'sell' ? row?.sellRate : row?.buyRate) ?? '';
  };

  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [method.rates]);

  const cell = (code: string, side: P2PSide) => draft[`${code}:${side}`] ?? current(code, side);
  const invalid = (value: string) =>
    value.trim() !== '' && !(/^\d+(\.\d{1,8})?$/.test(value.trim()) && Number(value) > 0);

  const pending = wallets.flatMap((w) =>
    (['sell', 'buy'] as const)
      .filter((side) => cell(w.code, side).trim() !== current(w.code, side))
      .map((side) => ({ code: w.code, side, value: cell(w.code, side).trim() })),
  );
  const broken = pending.some((p) => invalid(p.value));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (broken) return;
    for (const p of pending) {
      await setRate.mutateAsync({
        methodId: method.id,
        side: p.side,
        walletCurrency: p.code,
        rate: p.value === '' ? null : p.value,
      });
    }
  }

  return (
    <form onSubmit={save} style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Precios, en {method.code} por unidad</h3>
      {setRate.isError && <Failure error={setRate.error} />}
      <table>
        <thead>
          <tr>
            <th>Moneda</th>
            <th>El cliente vende (IslaPay compra)</th>
            <th>El cliente compra (IslaPay vende)</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.code}>
              <td>{w.code}</td>
              {(['sell', 'buy'] as const).map((side) => {
                const value = cell(w.code, side);
                return (
                  <td key={side}>
                    <input
                      aria-label={`${w.code} ${side === 'sell' ? 'el cliente vende' : 'el cliente compra'}`}
                      aria-invalid={invalid(value) ? true : undefined}
                      className="num"
                      inputMode="decimal"
                      value={value}
                      placeholder="No se ofrece"
                      onChange={(e) => setDraft((d) => ({ ...d, [`${w.code}:${side}`]: e.target.value }))}
                      style={{ width: 140 }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
        <button type="submit" disabled={pending.length === 0 || broken || setRate.isPending}>
          {setRate.isPending ? 'Publicando…' : `Publicar ${pending.length || ''} ${pending.length === 1 ? 'precio' : 'precios'}`}
        </button>
        <small className="muted">Vacío deja de ofrecer ese sentido. Un precio publicado vale desde ya.</small>
      </div>
    </form>
  );
}

function Instructions({ method }: { method: P2PAdminMethod }) {
  const save = useSetP2PInstructions();
  const [text, setText] = useState(method.instructions);
  useEffect(() => setText(method.instructions), [method.instructions]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: method.id, instructions: text });
      }}
    >
      {save.isError && <Failure error={save.error} />}
      <Field
        label="Dónde paga el comprador"
        hint="Se le enseña en cada compra, junto a la referencia. Cuenta o teléfono, a nombre de quién, y qué escribir en la nota."
      >
        {(parts) => (
          <textarea {...parts} rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        )}
      </Field>
      {method.instructions.trim() === '' && (
        <Note tone="warn">Sin instrucciones, una compra le dice al cliente que no pague todavía.</Note>
      )}
      <button type="submit" disabled={text === method.instructions || save.isPending}>
        {save.isPending ? 'Guardando…' : 'Guardar instrucciones'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------- create

/**
 * Opens a rail for a local currency.
 *
 * Only a fiat currency the catalogue has switched on, and only one rail per
 * currency — the list offers nothing else, and the server refuses it anyway.
 * The rail starts switched off and unpriced, so creating it never starts it
 * quoting.
 */
function CreateDialog({
  open,
  onClose,
  taken,
}: {
  open: boolean;
  onClose: () => void;
  taken: ReadonlySet<string>;
}) {
  const catalogue = useCatalogue();
  const create = useCreateP2PMethod();
  const formId = useId();
  const choices: CurrencyDto[] = (catalogue.data ?? []).filter(
    (c) => c.kind === 'fiat' && c.enabled && !c.customerHoldable && !taken.has(c.code),
  );

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');

  useEffect(() => {
    if (!open) {
      setCode('');
      setName('');
      setMinimum('');
      setMaximum('');
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = choices.find((c) => c.code === code) ?? choices[0];
  const unit: Currency | undefined = chosen ? { code: chosen.code, scale: chosen.scale } : undefined;
  const minError = amountError(minimum, unit);
  const maxError = amountError(maximum, unit);
  const complete =
    unit !== undefined &&
    minimum.trim() !== '' &&
    maximum.trim() !== '' &&
    minError === undefined &&
    maxError === undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || unit === undefined) return;

    create.mutate(
      {
        currency: unit.code,
        minimum: Money.parseAmount(minimum.trim(), unit).toWire(),
        maximum: Money.parseAmount(maximum.trim(), unit).toWire(),
        ...(name.trim() !== '' ? { name: name.trim() } : {}),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo método"
      subtitle="Nace apagado y sin precios. Enciéndelo cuando tenga precio e instrucciones."
    >
      <form id={formId} onSubmit={submit}>
        <div className="dialog__body">
          {create.isError && <Failure error={create.error} />}
          {choices.length === 0 ? (
            <Note tone="warn">
              No queda ninguna moneda fiat encendida sin método. Enciéndela primero en
              «Monedas y redes» (rol catalog-admin).
            </Note>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
                <Field label="Moneda">
                  {(parts) => (
                    <select {...parts} value={chosen?.code ?? ''} onChange={(e) => setCode(e.target.value)}>
                      {choices.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Nombre" hint="Si lo dejas vacío, el código de la moneda.">
                  {(parts) => (
                    <input {...parts} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={chosen?.code} />
                  )}
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label={`Mínimo por operación (${chosen?.code ?? ''})`} error={minError}>
                  {(parts) => (
                    <input {...parts} className="num" inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
                  )}
                </Field>
                <Field label={`Máximo por operación (${chosen?.code ?? ''})`} error={maxError}>
                  {(parts) => (
                    <input {...parts} className="num" inputMode="decimal" value={maximum} onChange={(e) => setMaximum(e.target.value)} />
                  )}
                </Field>
              </div>
            </>
          )}
        </div>
        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!complete || create.isPending}>
            {create.isPending ? 'Creando…' : 'Crear método'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function amountError(amount: string, currency: Currency | undefined): string | undefined {
  const trimmed = amount.trim();
  if (trimmed === '' || currency === undefined) return undefined;

  let minor: bigint;
  try {
    minor = parseMinorUnits(trimmed, currency.scale);
  } catch (error) {
    return error instanceof Error ? error.message : 'No es un importe.';
  }

  return minor > 0n ? undefined : 'Tiene que ser mayor que cero.';
}
