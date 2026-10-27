// Pantallas de cuenta y economía: acceso, colección, cofres, perfil y
// administración. Todo saldo, héroe o rol que se muestra viene del servidor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { HEROES, HERO_CATALOG, byRarity, PUBLIC_HERO_IDS, RARITY_LABEL, ROLE_LABEL, SECRET_IDS, isSecret, type HeroId, type HeroRole, type Rarity } from '../../../shared/config';
import { ECONOMY, ODDS_SCALE, RARITIES, heroesOfRarity, type ChestType } from '../../../shared/economy';
import { account, UnknownOutcome, newKey, type LedgerRow, type Notice, type Odds, type Opening, type OpenResult } from '../account';
import { HeroBadge, PowerList, RARITY_ICON, RarityTag } from './common';

export function useAccount() {
  const [, force] = useState(0);
  useEffect(() => account.subscribe(() => force((n) => n + 1)), []);
  return account;
}

export const CHEST_LABEL: Record<ChestType, string> = { standard: 'Cofre estándar', elite: 'Cofre élite' };

function errText(e: unknown): string {
  if (e instanceof UnknownOutcome) return `${e.message} No sabemos si la operación se completó: usá «Comprobar» en el aviso de arriba.`;
  if (e instanceof Error) return e.message;
  return 'Error inesperado.';
}

const pct = (ppm: number) => {
  const v = (ppm / ODDS_SCALE) * 100;
  return v === 0 ? '0 %' : v < 10 && v % 1 ? `${v.toFixed(1)} %` : `${Math.round(v)} %`;
};

function localTime(iso: string): string {
  return new Date(iso).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function untilText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'ya';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : h ? `${h} h ${m} min` : `${m} min`;
}

// ------------------------------------------------------------ saldo y avisos

export function WalletChips({ onChests }: { onChests?: () => void }) {
  const a = useAccount();
  const w = a.profile?.wallet;
  if (!w) return null;
  const chests = w.standard + w.elite;
  return (
    <div className="wallet" aria-label="Saldo">
      <span className="chip coin" title="HeroCoins">🪙 {w.coins}</span>
      <span className="chip frag" title="Fragmentos (de héroes repetidos)">◆ {w.fragments}</span>
      <button className={`chip chest ${chests ? 'has' : ''}`} onClick={onChests} title="Cofres sin abrir" aria-label={`${chests} cofres sin abrir`}>🎁 {chests}</button>
    </div>
  );
}

function noticeText(n: Notice): string {
  const p = n.payload as Record<string, number | string | boolean | null>;
  const amounts = () => {
    const parts: string[] = [];
    if (p.coins) parts.push(`${Number(p.coins) > 0 ? '+' : ''}${p.coins} HeroCoins`);
    if (p.standard) parts.push(`${Number(p.standard) > 0 ? '+' : ''}${p.standard} cofre(s) estándar`);
    if (p.elite) parts.push(`${Number(p.elite) > 0 ? '+' : ''}${p.elite} cofre(s) élite`);
    return parts.join(', ');
  };
  if (n.kind === 'match') {
    if (!p.eligible) return `Partida oficial sin recompensa: ${p.reason ?? 'no cumplió los requisitos'}.`;
    const extra = [Number(p.dailyBonus) ? `+${p.dailyBonus} por el objetivo diario` : '', Number(p.weeklyElite) ? `+${p.weeklyElite} cofre élite por el objetivo semanal` : ''].filter(Boolean).join(' · ');
    return `Partida oficial: +${p.coins} HeroCoins${Number(p.coins) === 0 ? ' (tope diario alcanzado)' : ''}${extra ? ' · ' + extra : ''}.`;
  }
  if (n.kind === 'grant') return `Recibiste ${amounts()}. Motivo: ${p.reason}.`;
  if (n.kind === 'correction') return `Corrección de saldo: ${amounts()}. Motivo: ${p.reason}.`;
  if (n.kind === 'hero_grant') return `Recibiste un personaje especial: ${HEROES[p.hero as HeroId]?.name ?? p.hero}. Sólo se usa en salas casuales con «Personajes especiales» (sin recompensas). Motivo: ${p.reason}.`;
  if (n.kind === 'hero_revoke') return `Se retiró el personaje especial ${HEROES[p.hero as HeroId]?.name ?? p.hero} de tu colección. Motivo: ${p.reason}.`;
  return 'Aviso nuevo.';
}

export function NoticeBar() {
  const a = useAccount();
  const notes = a.profile?.notifications ?? [];
  const pending = a.unresolved;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!notes.length && !pending && a.status !== 'offline') return null;
  return (
    <div className="notices">
      {a.status === 'offline' && (
        <div className="notice warn" role="status">
          Sin conexión con el servidor de cuentas: podés seguir jugando (entrenamiento, bots y salas), pero cofres, colección y perfil esperan a que vuelva.
          <button className="mini" onClick={() => void a.refresh()}>Reintentar</button>
        </div>
      )}
      {pending && (
        <div className="notice warn" role="alert">
          <span>«{pending.label}» se envió pero no llegó la respuesta. «Comprobar» reenvía la misma operación: si ya se hizo, el servidor devuelve el resultado original sin cobrar dos veces.</span>
          <span className="btn-row">
            <button
              className="mini"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const r = await a.resolvePending<OpenResult>();
                  if (r && 'openingId' in r) pendingOpened?.(r);
                } catch (e) {
                  setErr(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >{busy ? 'Comprobando…' : 'Comprobar'}</button>
            <button className="mini" disabled={busy} onClick={() => a.discardPending()} title="Olvidar el aviso (el perfil muestra el saldo real)">Descartar</button>
          </span>
          {err && <span className="error-text">{err}</span>}
        </div>
      )}
      {notes.map((n) => <div key={n.id} className="notice" role="status">{noticeText(n)}</div>)}
      {notes.length > 0 && (
        <button className="mini" onClick={() => void a.markSeen({ notifications: notes.map((n) => n.id) })}>Entendido</button>
      )}
    </div>
  );
}

/** Lo registra App para mostrar la apertura de un cofre que se confirmó al comprobar una operación pendiente. */
let pendingOpened: ((r: OpenResult) => void) | null = null;
export function onPendingOpened(fn: (r: OpenResult) => void): void {
  pendingOpened = fn;
}

// ------------------------------------------------------------ acceso

export function AuthPanel({ onDone }: { onDone?: () => void }) {
  const a = useAccount();
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!a.enabled) {
    return <p className="muted">Esta versión no tiene servidor de cuentas configurado: se juega como invitado (entrenamiento, bots y salas casuales). Ver README para desplegar el backend.</p>;
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') await a.signIn(email.trim(), pass);
      else if (mode === 'up') await a.signUp(name.trim(), email.trim(), pass);
      else {
        await a.requestReset(email.trim());
        setMsg({ ok: true, text: 'Si existe una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva (vence en 30 minutos).' });
        return;
      }
      setPass('');
      onDone?.();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Entrar</button>
        <button role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Crear cuenta</button>
        <button role="tab" aria-selected={mode === 'forgot'} className={mode === 'forgot' ? 'on' : ''} onClick={() => setMode('forgot')}>Olvidé mi contraseña</button>
      </div>
      <form onSubmit={submit}>
        {mode === 'up' && (
          <label className="block">Apodo público
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required autoComplete="nickname" />
          </label>
        )}
        <label className="block">Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        {mode !== 'forgot' && (
          <label className="block">Contraseña {mode === 'up' && <span className="muted small">(mínimo 8 caracteres)</span>}
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
          </label>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Enviando…' : mode === 'in' ? 'Entrar' : mode === 'up' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
      </form>
      {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      {mode === 'up' && <p className="muted small">Con cuenta recibís {ECONOMY.welcome.coins} HeroCoins y {ECONOMY.welcome.standard} cofres estándar de bienvenida (una sola vez). Tu progreso queda en el servidor y lo recuperás desde cualquier navegador.</p>}
    </div>
  );
}

/** Formulario al volver del enlace de recuperación (?token=...). */
export function ResetPassword({ token, error, onDone }: { token: string | null; error: string | null; onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: 'El enlace de recuperación venció o ya se usó. Pedí uno nuevo.' } : null);
  return (
    <div className="panel narrow">
      <h1>Nueva contraseña</h1>
      {token && !msg?.ok && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await account.resetPassword(token, pass);
              setMsg({ ok: true, text: 'Contraseña cambiada. Se cerraron las sesiones abiertas: entrá con la contraseña nueva.' });
            } catch (err) {
              setMsg({ ok: false, text: errText(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">Contraseña nueva <span className="muted small">(mínimo 8 caracteres)</span>
            <input type="password" value={pass} minLength={8} required onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          </label>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </form>
      )}
      {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      <div className="btn-row"><button onClick={onDone}>Volver</button></div>
    </div>
  );
}

// ------------------------------------------------------------ colección

type Avail = 'all' | 'owned' | 'locked';

export function Collection({ selected, onEquip, onTry, onChests }: {
  /** Héroe elegido para jugar. */
  selected: HeroId;
  onEquip: (h: HeroId) => void;
  onTry: (h: HeroId) => void;
  onChests: () => void;
}) {
  const a = useAccount();
  const signed = a.status === 'signed';
  const owned = signed ? a.owned() : new Set<HeroId>(PUBLIC_HERO_IDS.filter((h) => HERO_CATALOG[h].starter));
  // los personajes secretos sólo aparecen en la colección de quien los tiene
  const visible = byRarity([...PUBLIC_HERO_IDS, ...SECRET_IDS.filter((h) => owned.has(h))]);
  const ownedPublic = PUBLIC_HERO_IDS.filter((h) => owned.has(h)).length;
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [role, setRole] = useState<HeroRole | 'all'>('all');
  const [avail, setAvail] = useState<Avail>('all');
  const [focus, setFocus] = useState<HeroId>(selected);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = visible.filter((h) => {
    const c = HERO_CATALOG[h];
    if (rarity !== 'all' && c.rarity !== rarity) return false;
    if (role !== 'all' && c.role !== role) return false;
    if (avail === 'owned' && !owned.has(h)) return false;
    if (avail === 'locked' && owned.has(h)) return false;
    return true;
  });
  const c = HERO_CATALOG[focus];
  const have = owned.has(focus);
  const secret = isSecret(focus);
  const pool = heroesOfRarity(c.rarity).length || 1;
  const cost = ECONOMY.unlockCost[c.rarity];
  const frags = a.profile?.wallet.fragments ?? 0;
  const equipped = a.profile?.wallet.equipped;

  const equip = async () => {
    setMsg(null);
    if (signed) {
      setBusy(true);
      try {
        await a.call('POST', '/api/heroes/equip', { hero: focus });
        await a.refresh();
      } catch (e) {
        setMsg({ ok: false, text: errText(e) });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onEquip(focus);
    setMsg({ ok: true, text: `${HEROES[focus].name} equipado.` });
  };
  const unlock = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await a.mutate('/api/heroes/unlock', { hero: focus }, `Desbloquear ${HEROES[focus].name}`);
      setMsg({ ok: true, text: `¡${HEROES[focus].name} desbloqueado! Ya podés usarlo en partidas oficiales.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="collection">
      <p className="muted small lead">
        Todos los héroes se pueden <b>probar gratis</b> en entrenamiento, contra bots y en salas casuales. En <b>partidas oficiales</b> sólo podés usar los de tu colección.
        La rareza indica qué tan seguido sale en cofres, no cuánto poder tiene.
      </p>
      <div className="filters" role="group" aria-label="Filtros">
        <label>Rareza
          <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity | 'all')}>
            <option value="all">Todas</option>
            {RARITIES.map((r) => <option key={r} value={r}>{RARITY_ICON[r]} {RARITY_LABEL[r]}</option>)}
          </select>
        </label>
        <label>Rol
          <select value={role} onChange={(e) => setRole(e.target.value as HeroRole | 'all')}>
            <option value="all">Todos</option>
            {(Object.keys(ROLE_LABEL) as HeroRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <label>Disponibilidad
          <select value={avail} onChange={(e) => setAvail(e.target.value as Avail)}>
            <option value="all">Todos</option>
            <option value="owned">En mi colección</option>
            <option value="locked">Bloqueados</option>
          </select>
        </label>
        <span className="muted small">{ownedPublic}/{PUBLIC_HERO_IDS.length} en tu colección{!signed && ' (invitado: sólo los iniciales)'}</span>
      </div>
      <div className="hero-grid">
        {list.map((h) => {
          const cat = HERO_CATALOG[h];
          const mine = owned.has(h);
          return (
            <button
              key={h}
              className={`hero-card r-${cat.rarity} ${mine ? 'owned' : 'locked'} ${h === focus ? 'sel' : ''}`}
              onClick={() => { setFocus(h); setMsg(null); }}
              aria-pressed={h === focus}
              aria-label={`${HEROES[h].name}, ${RARITY_LABEL[cat.rarity]}, ${mine ? 'en tu colección' : 'bloqueado'}`}
            >
              <HeroBadge hero={h} size={44} team="red" />
              <b>{HEROES[h].name}</b>
              {isSecret(h) ? <span className="rarity secret">✦ Secreto</span> : <RarityTag rarity={cat.rarity} />}
              <span className="small">{mine ? (h === (equipped ?? selected) ? '✔ Equipado' : 'En tu colección') : '🔒 Bloqueado'}</span>
            </button>
          );
        })}
        {!list.length && <div className="muted">Ningún héroe coincide con los filtros.</div>}
      </div>
      <div className={`hero-detail r-${c.rarity}`}>
        <div className="hd-head">
          <HeroBadge hero={focus} size={64} team="red" />
          <div>
            <h2>{HEROES[focus].name}</h2>
            <div className="hd-tags">{secret ? <span className="rarity secret">✦ Secreto</span> : <RarityTag rarity={c.rarity} />} <span className="tag">{ROLE_LABEL[c.role]}</span> {have ? <span className="tag ok">En tu colección</span> : <span className="tag lock">🔒 Bloqueado</span>}</div>
          </div>
        </div>
        <PowerList hero={focus} />
        <p className="small">
          <b>Cómo se consigue: </b>
          {secret
            ? 'Personaje especial: no sale en cofres ni se desbloquea con Fragmentos; lo asigna un administrador. Sólo se usa en salas casuales con «Personajes especiales» activado, sin recompensas.'
            : c.starter
              ? 'Héroe inicial: gratis para todos.'
              : `Sale en cofres (${RARITY_LABEL[c.rarity].toLowerCase()}: ${pct(ECONOMY.chests.standard.odds[c.rarity] / pool)} por cofre estándar, ${pct(ECONOMY.chests.elite.odds[c.rarity] / pool)} por cofre élite). También se desbloquea con ${cost} Fragmentos, que dan los héroes repetidos.`}
        </p>
        <div className="btn-row">
          {!secret && <button onClick={() => onTry(focus)}>Probar en entrenamiento</button>}
          {(have || !signed) && <button className="primary" disabled={busy || (signed && equipped === focus)} onClick={() => void equip()}>{signed && equipped === focus ? 'Equipado' : 'Equipar'}</button>}
          {signed && !have && !secret && (
            <button className="primary" disabled={busy || frags < cost} onClick={() => void unlock()}>
              Desbloquear por {cost} ◆
            </button>
          )}
          {signed && !have && frags < cost && <span className="muted small">Te faltan {cost - frags} Fragmentos.</span>}
          {signed && !have && <button onClick={onChests}>Ver cofres</button>}
        </div>
        {!signed && a.enabled && <p className="muted small">Creá una cuenta para tener colección, cofres y partidas oficiales.</p>}
        {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ cofres

export function Chests({ onOpened, onLogin }: { onOpened: (r: OpenResult) => void; onLogin: () => void }) {
  const a = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const p = a.profile;
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  if (a.status !== 'signed' || !p) {
    return (
      <div className="chests">
        <OddsTable />
        <p className="muted">{a.status === 'checking' ? 'Cargando tu cuenta…' : a.status === 'offline' ? 'Sin conexión con el servidor de cuentas.' : 'Los cofres requieren una cuenta: el saldo y los héroes quedan guardados en el servidor.'}</p>
        {a.status === 'guest' && <button className="primary" onClick={onLogin}>Entrar o crear cuenta</button>}
      </div>
    );
  }
  const w = p.wallet;
  const nextEpic = p.pity.epicAfter + 1 - p.pity.sinceEpic;
  const nextLeg = p.pity.legendaryAfter + 1 - p.pity.sinceLegendary;
  return (
    <div className="chests">
      <div className="chest-cards">
        {(['standard', 'elite'] as const).map((t) => {
          const have = t === 'standard' ? w.standard : w.elite;
          const price = ECONOMY.chests[t].price;
          return (
            <div key={t} className={`chest-card ${t}`}>
              <div className="chest-icon" aria-hidden>🎁</div>
              <b>{CHEST_LABEL[t]}</b>
              <span className="small">Tenés <b>{have}</b> · precio {price} 🪙</span>
              <div className="btn-row">
                <button
                  className="primary"
                  disabled={!!busy || have < 1}
                  onClick={() => void run(`open-${t}`, async () => {
                    const r = await a.mutate<OpenResult>('/api/chests/open', { type: t }, `Abrir ${CHEST_LABEL[t].toLowerCase()}`);
                    onOpened(r);
                  })}
                >{busy === `open-${t}` ? 'Abriendo…' : 'Abrir'}</button>
                <button
                  disabled={!!busy || w.coins < price}
                  onClick={() => void run(`buy-${t}`, async () => {
                    await a.mutate('/api/chests/buy', { type: t }, `Comprar ${CHEST_LABEL[t].toLowerCase()}`);
                    setMsg({ ok: true, text: `Compraste un ${CHEST_LABEL[t].toLowerCase()} por ${price} HeroCoins.` });
                  })}
                >{busy === `buy-${t}` ? 'Comprando…' : `Comprar (${price} 🪙)`}</button>
              </div>
              {w.coins < price && <span className="muted small">Te faltan {price - w.coins} HeroCoins.</span>}
            </div>
          );
        })}
      </div>
      {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      <div className="pity">
        <Progress label={`Épico o mejor garantizado ${nextEpic <= 1 ? 'en la próxima apertura' : `a más tardar en ${nextEpic} aperturas`}`} value={p.pity.sinceEpic} max={p.pity.epicAfter + 1} />
        <Progress label={`Legendario garantizado ${nextLeg <= 1 ? 'en la próxima apertura' : `a más tardar en ${nextLeg} aperturas`}`} value={p.pity.sinceLegendary} max={p.pity.legendaryAfter + 1} />
      </div>
      <OddsTable next={p.pity.next} />
      <p className="muted small">Un héroe repetido da Fragmentos ({RARITIES.map((r) => `${RARITY_LABEL[r].toLowerCase()} ${ECONOMY.duplicateFragments[r]}`).join(', ')}). Dentro de cada rareza, cada héroe tiene la misma probabilidad. El resultado lo decide el servidor antes de la animación.</p>
      {p.openings.length > 0 && (
        <>
          <h3>Últimas aperturas</h3>
          <OpeningList rows={p.openings} />
        </>
      )}
    </div>
  );
}

function Progress({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="progress">
      <div className="small">{label}</div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <div className="muted small">{value}/{max}</div>
    </div>
  );
}

export function OddsTable({ next }: { next?: Record<ChestType, { odds: Odds; guarantee: Rarity | null }> }) {
  return (
    <table className="odds">
      <caption className="small muted">Probabilidades por apertura{next ? ': base y para tu próxima apertura' : ''}</caption>
      <thead>
        <tr>
          <th>Rareza</th>
          <th>Estándar</th>{next && <th>Tu próxima</th>}
          <th>Élite</th>{next && <th>Tu próxima</th>}
          <th>Por héroe (est. / élite)</th>
        </tr>
      </thead>
      <tbody>
        {RARITIES.map((r) => (
          <tr key={r}>
            <td><RarityTag rarity={r} /></td>
            <td>{pct(ECONOMY.chests.standard.odds[r])}</td>{next && <td className={next.standard.guarantee ? 'hl' : ''}>{pct(next.standard.odds[r])}</td>}
            <td>{pct(ECONOMY.chests.elite.odds[r])}</td>{next && <td className={next.elite.guarantee ? 'hl' : ''}>{pct(next.elite.odds[r])}</td>}
            <td className="small">{heroesOfRarity(r).length ? `${heroesOfRarity(r).length} héroes · ${pct(ECONOMY.chests.standard.odds[r] / heroesOfRarity(r).length)} / ${pct(ECONOMY.chests.elite.odds[r] / heroesOfRarity(r).length)} c/u` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpeningList({ rows }: { rows: Opening[] }) {
  return (
    <ul className="openings">
      {rows.map((o) => (
        <li key={o.id}>
          <HeroBadge hero={o.hero} size={20} team="red" />
          <span>{HEROES[o.hero]?.name ?? o.hero}</span>
          <RarityTag rarity={o.rarity} />
          <span className="muted small">{o.duplicate ? `repetido · +${o.fragments} ◆` : 'nuevo'}{o.guarantee ? ' · por garantía' : ''} · {CHEST_LABEL[o.chest_type]} · {localTime(o.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------ apertura

const REVEAL_MS = 1500;

export function OpeningReveal({ r, recovered, onEquip, onCollection, onClose }: {
  r: OpenResult;
  recovered: boolean;
  onEquip: () => void;
  onCollection: () => void;
  onClose: () => void;
}) {
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const [done, setDone] = useState(reduced || recovered);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done) return;
    const t = window.setTimeout(() => setDone(true), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [done]);
  useEffect(() => {
    if (done) closeRef.current?.focus();
  }, [done]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === 'Escape') (done ? onClose : () => setDone(true))(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [done, onClose]);
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Apertura de cofre">
      <div className={`reveal panel ${done ? `r-${r.rarity} shown` : ''}`}>
        {!done ? (
          <>
            {/* la animación es neutra: no insinúa una rareza distinta de la obtenida */}
            <div className="reveal-chest" aria-hidden>🎁</div>
            <p className="muted">Abriendo {CHEST_LABEL[r.chest].toLowerCase()}…</p>
            <button onClick={() => setDone(true)}>Saltar</button>
          </>
        ) : (
          <>
            {recovered && <p className="muted small">Apertura que no llegaste a ver (resultado guardado en el servidor).</p>}
            <HeroBadge hero={r.hero} size={96} team="red" />
            <h2>{HEROES[r.hero].name}</h2>
            <RarityTag rarity={r.rarity} />
            <p className={r.duplicate ? 'muted' : 'ok-text'}>
              {r.duplicate ? `Repetido: +${r.fragments} Fragmentos` : '¡Héroe nuevo en tu colección!'}
              {r.guarantee && ` · Obtenido por la garantía de ${RARITY_LABEL[r.guarantee].toLowerCase()}`}
            </p>
            <div className="btn-row center-row">
              <button className="primary" onClick={onEquip}>Equipar</button>
              <button onClick={onCollection}>Ver colección</button>
              <button ref={closeRef} onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function openingToResult(o: Opening): OpenResult {
  return { openingId: o.id, chest: o.chest_type, hero: o.hero, rarity: o.rarity, duplicate: o.duplicate, fragments: o.fragments, guarantee: o.guarantee };
}

// ------------------------------------------------------------ perfil

const KIND_LABEL: Record<string, string> = {
  welcome: 'Bienvenida',
  buy_chest: 'Compra de cofre',
  open_chest: 'Apertura de cofre',
  unlock: 'Desbloqueo de héroe',
  match: 'Partida oficial',
  daily: 'Objetivo diario',
  weekly: 'Objetivo semanal',
  admin_grant: 'Entrega de administración',
  admin_correction: 'Corrección de administración',
};

function deltas(l: LedgerRow): string {
  const out: string[] = [];
  const f = (v: number, unit: string) => { if (v) out.push(`${v > 0 ? '+' : '−'}${Math.abs(v)} ${unit}`); };
  f(l.coins_delta, '🪙');
  f(l.fragments_delta, '◆');
  f(l.standard_delta, 'estándar');
  f(l.elite_delta, 'élite');
  return out.join(' · ') || '—';
}

function LedgerTable({ rows, onCorrect }: { rows: LedgerRow[]; onCorrect?: (l: LedgerRow) => void }) {
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead><tr><th>#</th><th>Fecha</th><th>Movimiento</th><th>Cambio</th><th>Saldo después</th>{onCorrect && <th />}</tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="muted">{l.id}</td>
              <td>{localTime(l.created_at)}</td>
              <td>
                {KIND_LABEL[l.kind] ?? l.kind}
                {l.kind === 'open_chest' && l.detail?.hero ? ` · ${HEROES[l.detail.hero as HeroId]?.name ?? ''}` : ''}
                {l.reason && <div className="muted small">{l.reason}{l.actor_name ? ` · por ${l.actor_name}` : ''}{l.detail?.corrects ? ` · corrige #${l.detail.corrects}` : ''}</div>}
              </td>
              <td>{deltas(l)}</td>
              <td className="muted small">{l.coins_after} 🪙 · {l.fragments_after} ◆ · {l.standard_after}/{l.elite_after} cofres</td>
              {onCorrect && <td>{l.kind === 'admin_grant' && <button className="mini" onClick={() => onCorrect(l)}>Corregir</button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProfileTab({ onLogin }: { onLogin: () => void }) {
  const a = useAccount();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const p = a.profile;
  if (a.status !== 'signed' || !p) {
    return (
      <div>
        {a.status === 'checking' && <p className="muted">Cargando tu cuenta…</p>}
        {a.status === 'offline' && <p className="muted">Sin conexión con el servidor de cuentas. <button className="mini" onClick={() => void a.refresh()}>Reintentar</button></p>}
        {(a.status === 'guest' || a.status === 'unavailable') && <AuthPanel onDone={onLogin} />}
      </div>
    );
  }
  const o = p.objectives;
  return (
    <div className="profile">
      <section>
        <h3>Cuenta</h3>
        <div className="kv">
          <span>Apodo</span>
          {editing ? (
            <form className="inline" onSubmit={async (e) => {
              e.preventDefault();
              try {
                await a.rename(name.trim());
                setEditing(false);
                setMsg(null);
              } catch (err) {
                setMsg(errText(err));
              }
            }}>
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="mini" type="submit" disabled={!name.trim()}>Guardar</button>
              <button className="mini" type="button" onClick={() => setEditing(false)}>Cancelar</button>
            </form>
          ) : <span><b>{p.user.name}</b> <button className="mini" onClick={() => { setName(p.user.name); setEditing(true); }}>Cambiar</button></span>}
          <span>Correo</span><span>{p.user.email}</span>
          <span>ID de cuenta</span><span className="mono">{p.user.id}</span>
          <span>Creada</span><span>{localTime(p.user.createdAt)}</span>
          {p.roles.length > 0 && <><span>Roles</span><span>{p.roles.map((r) => (r === 'economy_admin' ? 'Administración económica' : r === 'moderator' ? 'Moderación' : r)).join(', ')}</span></>}
        </div>
        {msg && <div className="error">{msg}</div>}
        <div className="btn-row"><button onClick={() => void a.signOut()}>Cerrar sesión</button></div>
      </section>
      <section>
        <h3>Partidas oficiales (verificadas por el servidor)</h3>
        <div className="stats">
          <div><b>{p.stats.played}</b><span>jugadas</span></div>
          <div><b>{p.stats.eligible}</b><span>con recompensa</span></div>
          <div><b>{p.stats.won}</b><span>ganadas</span></div>
        </div>
      </section>
      <section>
        <h3>Objetivos</h3>
        <Progress label={`Diario: ${o.daily.goal} partidas oficiales → +${o.daily.reward} 🪙${o.daily.completed ? ' (completado)' : ''}`} value={Math.min(o.daily.matches, o.daily.goal)} max={o.daily.goal} />
        <p className="muted small">Se reinicia en {untilText(o.daily.resetAt)} ({localTime(o.daily.resetAt)}, medianoche de {o.timeZone.split('/')[1]?.replace('_', ' ')}).</p>
        <Progress label={`Semanal: ${o.weekly.goal} partidas oficiales → +${o.weekly.rewardElite} cofre élite${o.weekly.completed ? ' (completado)' : ''}`} value={Math.min(o.weekly.matches, o.weekly.goal)} max={o.weekly.goal} />
        <p className="muted small">Se reinicia en {untilText(o.weekly.resetAt)} ({localTime(o.weekly.resetAt)}, lunes).</p>
        <Progress label={`HeroCoins de partidas hoy (tope diario ${o.matchCoinsCap})`} value={o.matchCoinsToday} max={o.matchCoinsCap} />
      </section>
      <section>
        <h3>Movimientos</h3>
        {p.history.length ? <LedgerTable rows={p.history} /> : <p className="muted">Todavía no hay movimientos.</p>}
      </section>
      {p.openings.length > 0 && (
        <section>
          <h3>Aperturas</h3>
          <OpeningList rows={p.openings} />
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------ administración

interface UserRow { id: string; name: string; email: string; coins: number | null; fragments: number | null; standard_chests: number | null; elite_chests: number | null }
interface UserDetail {
  user: { id: string; name: string; email: string; createdAt: string };
  roles: string[];
  wallet: { coins: number; fragments: number; standard_chests: number; elite_chests: number; pity_epic: number; pity_legendary: number; equipped_hero: HeroId } | undefined;
  heroes: { hero: HeroId; source: string }[];
  ledger: LedgerRow[];
  openings: Opening[];
  heroGrants?: { id: number; hero: HeroId; action: 'grant' | 'revoke'; reason: string; actor_id: string; actor_name: string | null; created_at: string }[];
}
interface SecretPreview { userId: string; name: string; hero: HeroId; heroName: string; action: 'grant' | 'revoke'; reason: string; owned: boolean; valid: boolean }
interface Preview {
  userId: string; name: string; reason: string; coins: number; standard: number; elite: number; corrects: number | null;
  before: { coins: number; standard: number; elite: number };
  after: { coins: number; standard: number; elite: number };
  valid: boolean;
}

export function AdminTab() {
  const a = useAccount();
  const isEco = a.hasRole('economy_admin');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (id: string) => {
    setErr(null);
    try {
      setDetail(await a.call<UserDetail>('GET', `/api/admin/users/${encodeURIComponent(id)}`));
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="admin">
      {a.hasRole('moderator') && (
        <p className="muted small">Moderación: en las salas del servidor tenés permisos de anfitrión (expulsar, pausar, configurar, mover). En salas P2P, el servidor firma tu permiso al entrar.</p>
      )}
      {!isEco ? <p className="muted">Tu cuenta no tiene el rol de administración económica.</p> : (
        <>
          <form className="inline" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              setRows(await a.call<UserRow[]>('GET', `/api/admin/users?q=${encodeURIComponent(q.trim())}`));
            } catch (er) {
              setErr(errText(er));
            } finally {
              setBusy(false);
            }
          }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID de cuenta, apodo o correo" aria-label="Buscar usuario" minLength={2} maxLength={64} />
            <button type="submit" disabled={busy || q.trim().length < 2}>Buscar</button>
          </form>
          {err && <div className="error">{err}</div>}
          {rows && (
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th>Apodo</th><th>Correo</th><th>ID</th><th>🪙</th><th>◆</th><th>Cofres</th><th /></tr></thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className={detail?.user.id === u.id ? 'sel' : ''}>
                      <td>{u.name}</td><td>{u.email}</td><td className="mono small">{u.id}</td>
                      <td>{u.coins ?? '—'}</td><td>{u.fragments ?? '—'}</td><td>{u.standard_chests ?? 0}/{u.elite_chests ?? 0}</td>
                      <td><button className="mini" onClick={() => void load(u.id)}>Ver</button></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={7} className="muted">Sin resultados.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {detail && <UserAdmin d={detail} reload={() => void load(detail.user.id)} self={detail.user.id === a.profile?.user.id} />}
        </>
      )}
    </div>
  );
}

function UserAdmin({ d, reload, self }: { d: UserDetail; reload: () => void; self: boolean }) {
  const [corrects, setCorrects] = useState<number | null>(null);
  const [coins, setCoins] = useState('');
  const [standard, setStandard] = useState('');
  const [elite, setElite] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<(Preview & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const w = d.wallet;
  const body = () => ({
    userId: d.user.id,
    coins: Number(coins) || 0,
    standard: Number(standard) || 0,
    elite: Number(elite) || 0,
    reason: reason.trim(),
    ...(corrects !== null ? { correction: true, corrects } : {}),
  });
  const reset = () => {
    setCoins(''); setStandard(''); setElite(''); setReason(''); setCorrects(null); setPreview(null);
  };
  const startCorrection = (l: LedgerRow) => {
    setCorrects(l.id);
    // por defecto, revertir lo que ese movimiento sumó
    setCoins(l.coins_delta > 0 ? String(l.coins_delta) : '');
    setStandard(l.standard_delta > 0 ? String(l.standard_delta) : '');
    setElite(l.elite_delta > 0 ? String(l.elite_delta) : '');
    setReason(`Corrige #${l.id}: `);
    setPreview(null);
    setMsg(null);
  };
  return (
    <div className="user-admin">
      <h3>{d.user.name} <span className="muted small mono">{d.user.id}</span></h3>
      <div className="kv">
        <span>Correo</span><span>{d.user.email}</span>
        <span>Saldo</span><span>{w ? `${w.coins} 🪙 · ${w.fragments} ◆ · ${w.standard_chests} estándar · ${w.elite_chests} élite` : 'Sin billetera (nunca entró)'}</span>
        {w && <><span>Garantías</span><span>{w.pity_epic} sin épico · {w.pity_legendary} sin legendario</span></>}
        <span>Héroes</span><span>{d.heroes.length ? d.heroes.map((h) => HEROES[h.hero]?.name ?? h.hero).join(', ') : 'sólo iniciales'}</span>
        {d.roles.length > 0 && <><span>Roles</span><span>{d.roles.join(', ')}</span></>}
      </div>
      {self && <p className="muted small">Es tu propia cuenta: la entrega queda en el registro a tu nombre.</p>}
      {(
        <form
          className="grant"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            try {
              const pv = await account.call<Preview>('POST', '/api/admin/preview', body());
              // la clave se fija al revisar: un doble clic en «Confirmar» no entrega dos veces
              setPreview({ ...pv, key: newKey() });
            } catch (er) {
              setMsg({ ok: false, text: errText(er) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <b>{corrects !== null ? `Corrección del movimiento #${corrects} (resta)` : 'Entregar'}</b>
          <div className="fields">
            <label>HeroCoins<input type="number" min={0} step={1} value={coins} onChange={(e) => { setCoins(e.target.value); setPreview(null); }} /></label>
            <label>Cofres estándar<input type="number" min={0} step={1} value={standard} onChange={(e) => { setStandard(e.target.value); setPreview(null); }} /></label>
            <label>Cofres élite<input type="number" min={0} step={1} value={elite} onChange={(e) => { setElite(e.target.value); setPreview(null); }} /></label>
          </div>
          <label className="block">Motivo (obligatorio, queda en el registro)
            <input value={reason} minLength={5} maxLength={200} required onChange={(e) => { setReason(e.target.value); setPreview(null); }} />
          </label>
          <div className="btn-row">
            <button type="submit" disabled={busy}>Revisar</button>
            {corrects !== null && <button type="button" onClick={reset}>Cancelar corrección</button>}
          </div>
        </form>
      )}
      {preview && (
        <div className="confirm" role="alert">
          <p>
            {corrects !== null ? 'Se va a RESTAR' : 'Se va a entregar'} a <b>{preview.name}</b> (<span className="mono">{preview.userId}</span>):{' '}
            <b>{[preview.coins && `${Math.abs(preview.coins)} HeroCoins`, preview.standard && `${Math.abs(preview.standard)} cofre(s) estándar`, preview.elite && `${Math.abs(preview.elite)} cofre(s) élite`].filter(Boolean).join(', ')}</b>.
          </p>
          <p className="small">Saldo: {preview.before.coins} → <b>{preview.after.coins}</b> 🪙 · estándar {preview.before.standard} → <b>{preview.after.standard}</b> · élite {preview.before.elite} → <b>{preview.after.elite}</b></p>
          <p className="small">Motivo: {preview.reason}</p>
          {!preview.valid && <p className="error">El saldo quedaría negativo: la corrección no se puede aplicar así.</p>}
          <div className="btn-row">
            <button
              className="primary"
              disabled={busy || !preview.valid}
              onClick={async () => {
                setBusy(true);
                try {
                  await account.mutate(corrects !== null ? '/api/admin/correct' : '/api/admin/grant', body(), `Entrega a ${preview.name}`, preview.key);
                  setMsg({ ok: true, text: `Listo: ${corrects !== null ? 'corrección aplicada' : 'entrega registrada'} para ${preview.name}. Verá un aviso al entrar.` });
                  reset();
                  reload();
                } catch (er) {
                  setMsg({ ok: false, text: errText(er) });
                } finally {
                  setBusy(false);
                }
              }}
            >Confirmar</button>
            <button onClick={() => setPreview(null)} disabled={busy}>Volver</button>
          </div>
        </div>
      )}
      {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      <SecretAdmin d={d} reload={reload} />
      <h3>Movimientos</h3>
      {d.ledger.length ? <LedgerTable rows={d.ledger} onCorrect={startCorrection} /> : <p className="muted">Sin movimientos.</p>}
      {d.openings.length > 0 && (<><h3>Aperturas</h3><OpeningList rows={d.openings} /></>)}
    </div>
  );
}

/** Asignar o retirar un personaje secreto (Thanos): motivo obligatorio, confirmación con el destinatario y auditoría. */
function SecretAdmin({ d, reload }: { d: UserDetail; reload: () => void }) {
  const [hero] = useState<HeroId>(SECRET_IDS[0]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<(SecretPreview & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const has = d.heroes.some((h) => h.hero === hero);
  const action: 'grant' | 'revoke' = has ? 'revoke' : 'grant';
  const body = () => ({ userId: d.user.id, hero, action, reason: reason.trim() });
  return (
    <div className="secret-admin">
      <h3>Personaje secreto: {HEROES[hero].name}</h3>
      <p className="muted small">
        {has ? `${d.user.name} lo tiene.` : `${d.user.name} no lo tiene.`} No sale en cofres ni cuenta en la colección pública; sólo se usa en salas casuales con «Personajes especiales», sin recompensas.
      </p>
      <form
        className="grant"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            const pv = await account.call<SecretPreview>('POST', '/api/admin/secret/preview', body());
            setPreview({ ...pv, key: newKey() });
          } catch (er) {
            setMsg({ ok: false, text: errText(er) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">Motivo (obligatorio, queda en la auditoría)
          <input value={reason} minLength={5} maxLength={200} required onChange={(e) => { setReason(e.target.value); setPreview(null); }} />
        </label>
        <div className="btn-row">
          <button type="submit" disabled={busy}>{has ? `Revisar retiro de ${HEROES[hero].name}` : `Revisar asignación de ${HEROES[hero].name}`}</button>
        </div>
      </form>
      {preview && (
        <div className="confirm" role="alert">
          <p>
            Se va a <b>{preview.action === 'grant' ? 'ASIGNAR' : 'RETIRAR'}</b> a <b>{preview.heroName}</b> {preview.action === 'grant' ? 'a' : 'de'} <b>{preview.name}</b> (<span className="mono">{preview.userId}</span>).
          </p>
          <p className="small">Motivo: {preview.reason}</p>
          {!preview.valid && <p className="error">{preview.action === 'grant' ? 'Ya lo tiene.' : 'No lo tiene.'}</p>}
          <div className="btn-row">
            <button
              className="primary"
              disabled={busy || !preview.valid}
              onClick={async () => {
                setBusy(true);
                try {
                  await account.mutate('/api/admin/secret', body(), `${preview.action === 'grant' ? 'Asignar' : 'Retirar'} ${preview.heroName} a ${preview.name}`, preview.key);
                  setMsg({ ok: true, text: `Listo: ${preview.heroName} ${preview.action === 'grant' ? 'asignado a' : 'retirado de'} ${preview.name}. Verá un aviso al entrar.` });
                  setReason('');
                  setPreview(null);
                  reload();
                  // si fue a la propia cuenta, la colección de esta página tiene que verlo ya
                  void account.refresh();
                } catch (er) {
                  setMsg({ ok: false, text: errText(er) });
                } finally {
                  setBusy(false);
                }
              }}
            >Confirmar</button>
            <button onClick={() => setPreview(null)} disabled={busy}>Volver</button>
          </div>
        </div>
      )}
      {msg && <div className={msg.ok ? 'ok-text' : 'error'} role="status">{msg.text}</div>}
      {d.heroGrants && d.heroGrants.length > 0 && (
        <ul className="openings">
          {d.heroGrants.map((g) => (
            <li key={g.id}>
              <span>{g.action === 'grant' ? 'Asignado' : 'Retirado'}: {HEROES[g.hero]?.name ?? g.hero}</span>
              <span className="muted small">por {g.actor_name ?? g.actor_id} · {localTime(g.created_at)} · {g.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
