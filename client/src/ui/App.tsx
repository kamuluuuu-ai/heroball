import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HEROES, type HeroId } from '../../../shared/config';
import { ECONOMY } from '../../../shared/economy';
import { DEFAULT_SETTINGS, MAX_NICK, MAX_ROOM_NAME, type RoomInfo, type RoomMember, type RoomSettings } from '../../../shared/protocol';
import type { GameMode, Side, Team } from '../../../shared/types';
import { account, type OpenResult } from '../account';
import { setAudio } from '../game/audio';
import { net } from '../game/net';
import { LocalSession, NetSession, type LocalOptions } from '../game/sessions';
import { loadPrefs, savePrefs, type Prefs } from '../prefs';
import { Chat } from './Chat';
import { Controls, HeroBadge, HeroPicker, SettingsPanel } from './common';
import { GameView } from './GameView';
import { AdminTab, Chests, Collection, NoticeBar, OpeningReveal, ProfileTab, ResetPassword, WalletChips, onPendingOpened, openingToResult, useAccount } from './Meta';

type Screen = { k: 'home' } | { k: 'online' } | { k: 'offline'; opts: LocalOptions };

function useNet() {
  const [, force] = useState(0);
  useEffect(() => net.subscribe(() => force((n) => n + 1)), []);
  return net;
}

function getInviteRoom(): string | null {
  return new URLSearchParams(location.search).get('sala');
}

type Tab = 'play' | 'heroes' | 'chests' | 'profile' | 'admin';
const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Jugar' },
  { id: 'heroes', label: 'Héroes' },
  { id: 'chests', label: 'Cofres' },
  { id: 'profile', label: 'Perfil' },
  { id: 'admin', label: 'Administración' },
];

export function App() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  };
  useEffect(() => setAudio(prefs.sound, prefs.volume), []); // eslint-disable-line
  useEffect(() => {
    const lag = Number(new URLSearchParams(location.search).get('lag'));
    if (lag > 0) net.fakeLag = Math.min(500, lag / 2); // ida y vuelta
  }, []);

  const [screen, setScreen] = useState<Screen>({ k: 'home' });
  const [tab, setTab] = useState<Tab>('play');
  const n = useNet();
  const acc = useAccount();
  const signedName = acc.status === 'signed' ? acc.profile?.user.name : undefined;
  const nick = signedName ?? prefs.nick;

  // enlace de recuperación de contraseña (?token=… o ?error=…)
  const [reset, setReset] = useState(() => {
    const q = new URLSearchParams(location.search);
    return q.has('token') || q.get('error') === 'INVALID_TOKEN' ? { token: q.get('token'), error: q.get('error') } : null;
  });
  const clearReset = () => {
    const url = new URL(location.href);
    url.searchParams.delete('token');
    url.searchParams.delete('error');
    history.replaceState(null, '', url);
    setReset(null);
    setTab('profile');
  };

  useEffect(() => { void account.refresh(); }, []);
  // perfil al día al volver a la pestaña
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible' && account.token) void account.refresh(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  // conectar al lobby (y unirse por invitación); con cuenta se espera a saber quién es
  useEffect(() => {
    if (screen.k === 'home' && nick && n.status === 'closed' && acc.status !== 'checking') {
      const invite = getInviteRoom();
      n.connect(nick, invite ?? undefined);
    }
  }, [screen.k, nick, n.status, acc.status]); // eslint-disable-line

  // al entrar o salir de la cuenta, el servidor tiene que ver la identidad nueva
  const userId = acc.profile?.user.id ?? null;
  const lastUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (acc.status === 'checking') return;
    if (lastUser.current !== undefined && lastUser.current !== userId) n.reconnect();
    lastUser.current = userId;
    n.proveModerator();
  }, [userId, acc.status]); // eslint-disable-line

  useEffect(() => {
    if (n.room && screen.k === 'home') setScreen({ k: 'online' });
    if (!n.room && screen.k === 'online') setScreen({ k: 'home' });
  }, [n.room, screen.k]);

  // la URL refleja la sala actual (enlace de invitación)
  useEffect(() => {
    const url = new URL(location.href);
    if (n.room) url.searchParams.set('sala', n.room.id);
    else url.searchParams.delete('sala');
    history.replaceState(null, '', url);
  }, [n.room?.id]); // eslint-disable-line

  // apertura de cofre: la que se acaba de confirmar o una que quedó sin ver
  const [reveal, setReveal] = useState<{ r: OpenResult; recovered: boolean } | null>(null);
  const shown = useRef(new Set<number>());
  const showOpening = (r: OpenResult, recovered = false) => {
    shown.current.add(r.openingId);
    setReveal({ r, recovered });
  };
  useEffect(() => onPendingOpened((r) => showOpening(r)), []);
  useEffect(() => {
    const p = acc.profile;
    if (reveal || !p || screen.k !== 'home') return;
    const id = p.unseenOpenings.filter((x) => !shown.current.has(x)).sort((x, y) => x - y)[0];
    const o = id !== undefined ? p.openings.find((x) => x.id === id) : undefined;
    if (o) showOpening(openingToResult(o), true);
  }, [acc.profile, reveal, screen.k]); // eslint-disable-line
  const closeReveal = () => {
    if (reveal) void account.markSeen({ opening: reveal.r.openingId });
    setReveal(null);
  };

  const equip = (hero: HeroId) => setPrefs({ ...prefs, hero });
  const startTraining = (hero: HeroId) => {
    setPrefs({ ...prefs, hero });
    setScreen({ k: 'offline', opts: { kind: 'training', mode: 'heroes', hero, teamSize: 1, timeLimitMin: 0, scoreLimit: 0, botSkill: 0.6 } });
  };

  // héroe equipado en la cuenta (guardado en el servidor) como preferencia de juego
  const equipped = acc.profile?.wallet.equipped;
  useEffect(() => {
    if (equipped && equipped !== prefs.hero) setPrefs({ ...prefs, hero: equipped });
  }, [equipped]); // eslint-disable-line

  if (screen.k === 'online') return n.room ? <OnlineRoom prefs={prefs} setPrefs={setPrefs} /> : null;
  if (screen.k === 'offline') return <OfflineGame prefs={prefs} setPrefs={setPrefs} nick={nick} opts={screen.opts} onExit={() => setScreen({ k: 'home' })} />;

  const showAdmin = acc.hasRole('economy_admin') || acc.hasRole('moderator');
  const tabs = TABS.filter((t) => t.id !== 'admin' || showAdmin);
  const current = tab === 'admin' && !showAdmin ? 'play' : tab;
  return (
    <div className="menu-bg home">
      <header className="home-head">
        <div className="logo small-logo">Hero<span>Ball</span></div>
        <nav className="tabs" role="tablist" aria-label="Secciones">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'on' : ''} onClick={() => { setTab(t.id); if (reset) clearReset(); }}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="grow" />
        <WalletChips onChests={() => setTab('chests')} />
        <AccountButton onClick={() => setTab('profile')} />
      </header>
      <NoticeBar />
      <main className="home-main">
        {reset ? <ResetPassword token={reset.token} error={reset.error} onDone={clearReset} /> : (
          <div className={`panel tab-panel tab-${current}`} role="tabpanel">
            {current === 'play' && (
              <PlayTab
                prefs={prefs}
                setPrefs={setPrefs}
                nick={nick}
                onOffline={(opts) => setScreen({ k: 'offline', opts })}
                onLogin={() => setTab('profile')}
                onHeroes={() => setTab('heroes')}
              />
            )}
            {current === 'heroes' && <Collection selected={prefs.hero} onEquip={equip} onTry={startTraining} onChests={() => setTab('chests')} />}
            {current === 'chests' && <Chests onOpened={(r) => showOpening(r)} onLogin={() => setTab('profile')} />}
            {current === 'profile' && <ProfileTab onLogin={() => setTab('play')} />}
            {current === 'admin' && <AdminTab />}
          </div>
        )}
      </main>
      <p className="disclaimer">HeroBall es un proyecto independiente inspirado en HaxBall. No es el sitio oficial de HaxBall.</p>
      {reveal && (
        <OpeningReveal
          r={reveal.r}
          recovered={reveal.recovered}
          onClose={closeReveal}
          onCollection={() => { closeReveal(); setTab('heroes'); }}
          onEquip={() => {
            const hero = reveal.r.hero;
            closeReveal();
            void account.call('POST', '/api/heroes/equip', { hero }).then(() => account.refresh()).catch(() => {});
            equip(hero);
            setTab('heroes');
          }}
        />
      )}
    </div>
  );
}

function AccountButton({ onClick }: { onClick: () => void }) {
  const a = useAccount();
  if (!a.enabled) return <span className="conn" title="Esta versión no tiene servidor de cuentas">Invitado</span>;
  const label = a.status === 'signed' ? a.profile!.user.name : a.status === 'checking' ? '…' : a.status === 'offline' ? 'Sin conexión' : a.status === 'unavailable' ? 'Invitado' : 'Entrar';
  return (
    <button className={`acct ${a.status}`} onClick={onClick} aria-label={a.status === 'signed' ? `Perfil de ${label}` : 'Entrar o crear cuenta'}>
      {a.status === 'signed' ? '👤 ' : ''}{label}
    </button>
  );
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function NickField({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const [nick, setNick] = useState(prefs.nick);
  const [editing, setEditing] = useState(!prefs.nick);
  if (!editing) {
    return <span>Jugando como <b>{prefs.nick}</b> <span className="muted">(invitado)</span> <button className="link" onClick={() => setEditing(true)}>cambiar</button></span>;
  }
  return (
    <form
      className="inline"
      onSubmit={(e) => {
        e.preventDefault();
        const v = nick.trim();
        if (!v) return;
        setPrefs({ ...prefs, nick: v });
        setEditing(false);
        if (net.status !== 'closed') net.connect(v);
      }}
    >
      <label>Apodo <input autoFocus value={nick} maxLength={MAX_NICK} onChange={(e) => setNick(e.target.value)} placeholder="Tu apodo" /></label>
      <button type="submit" disabled={!nick.trim()}>Aceptar</button>
    </form>
  );
}

function PlayTab({ prefs, setPrefs, nick, onOffline, onLogin, onHeroes }: {
  prefs: Prefs; setPrefs: (p: Prefs) => void; nick: string; onOffline: (o: LocalOptions) => void; onLogin: () => void; onHeroes: () => void;
}) {
  const n = useNet();
  const acc = useAccount();
  const [creating, setCreating] = useState(false);
  const [offline, setOffline] = useState<null | 'training' | 'bots'>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => n.send({ t: 'list' }), 4000);
    return () => window.clearInterval(t);
  }, [n]);

  if (creating) return <CreateRoom onCancel={() => setCreating(false)} nick={nick} />;
  if (offline) return <OfflineSetup kind={offline} prefs={prefs} setPrefs={setPrefs} onCancel={() => setOffline(null)} onStart={onOffline} />;

  const signed = acc.status === 'signed';
  return (
    <>
      <div className="lobby-head">
        {signed ? <span>Jugando como <b>{nick}</b> <span className="verified" title="Cuenta verificada por el servidor">✔ cuenta</span></span> : <NickField prefs={prefs} setPrefs={setPrefs} />}
        <span className="hero-now">
          <HeroBadge hero={prefs.hero} size={22} team="red" /> {HEROES[prefs.hero].name} <button className="link" onClick={onHeroes}>cambiar</button>
        </span>
      </div>
      <div className="play-cards">
        <div className="play-card">
          <b>Entrenamiento</b>
          <span className="small muted">Vos y la pelota, sin rival. Probá cualquier héroe gratis.</span>
          <button className="primary" onClick={() => setOffline('training')}>Entrenar</button>
        </div>
        <div className="play-card">
          <b>Contra bots</b>
          <span className="small muted">Partido rápido sin conexión, de 1v1 a 3v3.</span>
          <button className="primary" onClick={() => setOffline('bots')}>Jugar contra bots</button>
        </div>
        <div className="play-card">
          <b>Multijugador</b>
          <span className="small muted">{n.p2p ? 'Sala alojada en tu navegador; invitá con un enlace. Siempre casual.' : 'Salas en el servidor. Las oficiales dan recompensas a cuentas.'}</span>
          <button className="primary" onClick={() => setCreating(true)} disabled={n.status !== 'open' || !nick}>Crear sala</button>
        </div>
      </div>
      <details className="modes">
        <summary>¿Qué son los modos Héroes, Súper y Clásico?</summary>
        <ul className="small">
          <li><b>Héroes</b>: cada jugador tiene dos poderes (Q y E) con recarga. Puede ser oficial.</li>
          <li><b>Súper</b>: los mismos héroes con poderes potenciados y más caóticos. Sólo casual: no da recompensas.</li>
          <li><b>Clásico</b>: sin poderes, sólo física y patada. Puede ser oficial.</li>
        </ul>
      </details>
      <div className="rooms-section">
        <div className="rooms-head">
          <b>Salas</b>
          <ConnBadge />
          <span className="grow" />
          {!n.p2p && <button className="mini" onClick={() => n.send({ t: 'list' })} disabled={n.status !== 'open'}>Actualizar</button>}
          {n.status === 'closed' && nick && <button className="mini" onClick={() => n.connect(nick)}>Reconectar</button>}
        </div>
        {!nick && <div className="empty short">Elegí un apodo{acc.enabled && !signed ? <> o <button className="link" onClick={onLogin}>entrá con tu cuenta</button></> : null} para ver las salas.</div>}
        {nick && n.status === 'connecting' && <div className="empty short">{n.p2p ? 'Conectando con la sala…' : 'Conectando con el servidor…'}</div>}
        {nick && n.status === 'closed' && <div className="empty short">Sin conexión con el servidor de salas. Entrenamiento y bots funcionan igual.</div>}
        {nick && n.status === 'open' && n.p2p && <WebModeHelp />}
        {nick && n.status === 'open' && !n.p2p && n.rooms?.length === 0 && <div className="empty short">No hay salas abiertas. Creá una e invitá con el enlace.</div>}
        {nick && n.status === 'open' && !n.p2p && !!n.rooms?.length && (
          <div className="room-table">
            <div className="room-row head">
              <span>Nombre</span><span>Jugadores</span><span>Modo</span><span>Tipo</span>
            </div>
            <div className="room-list">
              {n.rooms.map((r) => (
                <button key={r.id} className="room-row" onClick={() => n.send({ t: 'join', room: r.id })} aria-label={`Entrar a ${r.name}`}>
                  <span className="rname">{r.name}</span>
                  <span>{r.players}/{r.maxPlayers}</span>
                  <span>{MODE_LABEL[r.mode]} {r.teamSize}v{r.teamSize}{r.cooldowns === 'none' && r.mode !== 'classic' ? ' · sin cooldowns' : ''}{r.playing ? ' · en juego' : ''}</span>
                  <span>{r.official ? <span className="tag official">Oficial</span> : <span className="tag">Casual</span>}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {n.error && <div className="error">{n.error}</div>}
      </div>
      <div className="btn-row">
        <button onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Ajustes</button>
      </div>
      {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
      <Controls />
    </>
  );
}

function WebModeHelp() {
  const n = useNet();
  const [code, setCode] = useState('');
  const join = () => {
    // acepta el enlace completo o sólo el código de sala
    const m = code.trim().match(/[?&]sala=([a-z0-9]+)/i);
    const id = (m ? m[1] : code.trim()).toLowerCase();
    if (/^[a-z0-9]{4,16}$/.test(id)) n.connect(n.nick, id);
  };
  return (
    <div className="empty web-help">
      <p>Versión web: no hay servidor de salas ni lista pública. <b>Crear sala</b> la aloja en tu navegador; compartí el enlace para que entren otros.</p>
      <form className="join-code" onSubmit={(e) => { e.preventDefault(); join(); }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pegá un enlace o código de sala" aria-label="Enlace o código de sala" />
        <button type="submit" disabled={!code.trim()}>Unirse</button>
      </form>
    </div>
  );
}

const MODE_LABEL: Record<GameMode, string> = { heroes: 'Héroes', super: 'Súper', classic: 'Clásico' };

function ConnBadge() {
  const n = useNet();
  if (n.p2p && !n.linked && n.status === 'open') return <span className="conn open">● Modo web (salas P2P)</span>;
  const label = n.status === 'open' ? `Conectado · ${Math.round(n.ping)} ms` : n.status === 'connecting' ? 'Conectando…' : 'Desconectado';
  return <span className={`conn ${n.status}`} role="status">● {label}</span>;
}

/** Etiqueta visible de partidas sin cooldowns (en sala y en partido). */
function NoCdTag({ on }: { on: boolean }) {
  return on ? <span className="tag nocd" title="Sin espera de recarga. Partida casual: sin recompensas ni clasificación.">Sin cooldowns</span> : null;
}

/** Selector Cooldowns: Normales / Sin cooldowns (deshabilitado en Clásico, con explicación). */
function CooldownsField({ mode, value, onChange, disabled }: { mode: GameMode; value: RoomSettings['cooldowns']; onChange: (v: RoomSettings['cooldowns']) => void; disabled?: boolean }) {
  const classic = mode === 'classic';
  return (
    <label title={classic ? 'El modo Clásico no tiene poderes: no hay recargas que quitar.' : 'Sin cooldowns: los poderes no esperan recarga (duraciones y anticipaciones siguen). Siempre casual.'}>Cooldowns
      <select disabled={disabled || classic} value={classic ? 'normal' : value} onChange={(e) => onChange(e.target.value as RoomSettings['cooldowns'])}>
        <option value="normal">Normales</option>
        <option value="none">Sin cooldowns</option>
      </select>
      {classic && <span className="muted small">No aplica en Clásico (sin poderes).</span>}
    </label>
  );
}

function SettingsFields({ s, onChange, disabled, playing }: { s: RoomSettings; onChange: (p: Partial<RoomSettings>) => void; disabled?: boolean; playing?: boolean }) {
  const n = useNet();
  const canOfficial = n.officialServer && !n.p2p && s.mode !== 'super' && s.cooldowns !== 'none';
  return (
    <div className="fields">
      <label>Modo
        <select disabled={disabled || playing} value={s.mode} onChange={(e) => onChange({ mode: e.target.value as GameMode, ...(e.target.value === 'super' ? { official: false } : {}) })}>
          <option value="heroes">Héroes</option>
          <option value="super">Súper (poderes potenciados)</option>
          <option value="classic">Clásico (sin poderes)</option>
        </select>
      </label>
      <label>Equipos
        <select disabled={disabled || playing} value={s.teamSize} onChange={(e) => onChange({ teamSize: Number(e.target.value) as 1 | 2 | 3 })}>
          <option value={1}>1v1</option><option value={2}>2v2</option><option value={3}>3v3</option>
        </select>
      </label>
      <label>Tiempo
        <select disabled={disabled || playing} value={s.timeLimitMin} onChange={(e) => onChange({ timeLimitMin: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 7, 10].map((v) => <option key={v} value={v}>{v === 0 ? 'Sin límite' : `${v} min`}</option>)}
        </select>
      </label>
      <label>Goles
        <select disabled={disabled || playing} value={s.scoreLimit} onChange={(e) => onChange({ scoreLimit: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 7, 10].map((v) => <option key={v} value={v}>{v === 0 ? 'Sin límite' : v}</option>)}
        </select>
      </label>
      <label>Capacidad
        <select disabled={disabled || playing} value={s.maxPlayers} onChange={(e) => onChange({ maxPlayers: Number(e.target.value) })}>
          {[2, 4, 6, 8, 10, 12, 16].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      {/* con el partido en curso sólo se puede cambiar esto: se aplica al reiniciar */}
      <CooldownsField mode={s.mode} value={s.cooldowns} disabled={disabled} onChange={(cooldowns) => onChange({ cooldowns, ...(cooldowns === 'none' && !playing ? { official: false } : {}) })} />
      {n.officialServer && !n.p2p && (
        <label className="check" title={canOfficial ? 'Cuenta para recompensas: sólo jugadores con cuenta, sin bots' : 'El modo Súper y las partidas sin cooldowns no pueden ser oficiales'}>
          <span><input type="checkbox" disabled={disabled || playing || !canOfficial} checked={s.official && canOfficial} onChange={(e) => onChange({ official: e.target.checked })} /> Oficial (recompensas)</span>
        </label>
      )}
    </div>
  );
}

function CreateRoom({ onCancel, nick }: { onCancel: () => void; nick: string }) {
  const n = useNet();
  const [name, setName] = useState(`Sala de ${nick}`);
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  return (
    <div>
      <h2>Crear sala</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          n.createRoom(name.trim() || 'Sala HeroBall', s);
        }}
      >
        <label className="block">Nombre
          <input value={name} maxLength={MAX_ROOM_NAME} onChange={(e) => setName(e.target.value)} />
        </label>
        <SettingsFields s={s} onChange={(p) => setS({ ...s, ...p })} />
        {s.official && <OfficialRules />}
        {s.official && !n.account && <p className="error">Sin cuenta vas a quedar como espectador en una sala oficial.</p>}
        {n.error && <div className="error">{n.error}</div>}
        <div className="btn-row">
          <button type="button" onClick={onCancel}>Cancelar</button>
          <span className="grow" />
          <button type="submit" className="primary">Crear</button>
        </div>
      </form>
    </div>
  );
}

function OfficialRules() {
  const M = ECONOMY.match;
  return (
    <p className="muted small">
      Partida oficial: sólo cuentas (los invitados miran), sin bots, héroes de tu colección. Da {M.completeCoins} HeroCoins por completarla y {M.winBonus} más por ganar
      (tope {M.dailyCap} por día) si dura al menos {M.minSeconds} s, ambos equipos tienen cuentas distintas, jugaste al menos el {Math.round(M.minParticipation * 100)} % del partido y no
      repetiste los mismos rivales más de {M.sameOpponentsDaily} veces hoy. Detener o reiniciar antes del final no da recompensas.
    </p>
  );
}

function OfflineSetup({ kind, prefs, setPrefs, onCancel, onStart }: {
  kind: 'training' | 'bots'; prefs: Prefs; setPrefs: (p: Prefs) => void; onCancel: () => void; onStart: (o: LocalOptions) => void;
}) {
  const [mode, setMode] = useState<GameMode>('heroes');
  const [teamSize, setTeamSize] = useState<1 | 2 | 3>(1);
  const [skill, setSkill] = useState(0.6);
  const [cooldowns, setCooldowns] = useState<RoomSettings['cooldowns']>('normal');
  return (
    <div>
      <h2>{kind === 'training' ? 'Entrenamiento (sin conexión)' : 'Partido contra bots (sin conexión)'}</h2>
      {mode !== 'classic' && <HeroPicker mode={mode} value={prefs.hero} onChange={(hero) => setPrefs({ ...prefs, hero })} team="red" note="Sin conexión podés usar cualquier héroe, esté o no en tu colección." />}
      <div className="fields">
        <label>Modo
          <select value={mode} onChange={(e) => setMode(e.target.value as GameMode)}>
            <option value="heroes">Héroes</option>
            <option value="super">Súper</option>
            <option value="classic">Clásico</option>
          </select>
        </label>
        <CooldownsField mode={mode} value={cooldowns} onChange={setCooldowns} />
        {kind === 'bots' && (
          <>
            <label>Equipos
              <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value) as 1 | 2 | 3)}>
                <option value={1}>1v1</option><option value={2}>2v2</option><option value={3}>3v3</option>
              </select>
            </label>
            <label>Bots
              <select value={skill} onChange={(e) => setSkill(Number(e.target.value))}>
                <option value={0.3}>Fáciles</option><option value={0.6}>Normales</option><option value={0.9}>Difíciles</option>
              </select>
            </label>
          </>
        )}
      </div>
      {kind === 'bots' && <p className="muted small">Partido a 3 minutos o 3 goles. Los bots están marcados con [BOT]. No da recompensas.</p>}
      {kind === 'training' && <p className="muted small">Práctica libre sin rival: no hay límite de tiempo ni de goles (el reloj sólo cuenta cuánto llevás). R: volver al centro · Esc: menú.</p>}
      <div className="btn-row">
        <button onClick={onCancel}>Volver</button>
        <span className="grow" />
        <button className="primary" onClick={() => onStart({ kind, mode, hero: prefs.hero, teamSize, timeLimitMin: 3, scoreLimit: 3, botSkill: skill, noCooldowns: cooldowns === 'none' && mode !== 'classic' })}>Jugar</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ online

function OnlineRoom({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const n = useNet();
  const session = useMemo(() => new NetSession(net), []);
  useEffect(() => () => session.dispose(), [session]);
  const [menu, setMenu] = useState(false);
  const room = n.room!;
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of room.members) m.set(x.id, x.bot ? `${x.nick} [BOT]` : x.nick);
    return m;
  }, [room.members]);
  const me = room.members.find((m) => m.id === n.id);

  // al entrar, pedir el héroe preferido (el servidor lo rechaza si la sala es oficial y no lo tenés)
  useEffect(() => {
    if (me && me.hero !== prefs.hero) n.send({ t: 'hero', hero: prefs.hero });
  }, [me?.id]); // eslint-disable-line

  const open = menu || !room.playing;
  return (
    <GameView
      session={session}
      names={names}
      prefs={prefs}
      chat={room.playing && !open ? { lines: n.chat, send: (text) => n.send({ t: 'chat', text }) } : undefined}
      menuOpen={open}
      onToggleMenu={() => setMenu((v) => !v)}
      status={<>{room.settings.official ? <span className="tag official">Oficial</span> : <span className="tag">Casual</span>}<NoCdTag on={room.settings.cooldowns === 'none' && room.settings.mode !== 'classic'} /><ConnBadge /></>}
      idle={null}
      menu={<RoomPanel room={room} prefs={prefs} setPrefs={setPrefs} onClose={room.playing ? () => setMenu(false) : undefined} />}
    />
  );
}

function MemberRow({ m, isHost }: { m: RoomMember; isHost: boolean }) {
  const n = useNet();
  const move = (side: Side) => n.send({ t: 'side', side, target: m.id });
  return (
    <div className={`member ${m.id === n.id ? 'me' : ''}`}>
      <HeroBadge hero={m.hero} size={18} team={m.side} />
      <span className="mnick">
        {m.host && <span title="Anfitrión" aria-label="Anfitrión">★ </span>}
        {m.nick}
        {m.id === n.id && <span className="muted"> (vos)</span>}
        {m.verified && <span className="verified" title="Cuenta verificada por el servidor" aria-label="cuenta verificada"> ✔</span>}
        {m.bot && <span className="bot-tag">BOT</span>}
        {m.admin && <span className="admin-tag" title="Moderador verificado">MOD</span>}
      </span>
      {!m.bot && m.id !== n.id && <span className="mping">{m.ping} ms</span>}
      {isHost && (
        <span className="mactions">
          {m.side !== 'red' && <button className="mini red" onClick={() => move('red')} title="Mover a Rojo" aria-label={`Mover a ${m.nick} a Rojo`}>R</button>}
          {m.side !== 'spec' && !m.bot && <button className="mini" onClick={() => move('spec')} title="Mover a espectadores" aria-label={`Mover a ${m.nick} a espectadores`}>S</button>}
          {m.side !== 'blue' && <button className="mini blue" onClick={() => move('blue')} title="Mover a Azul" aria-label={`Mover a ${m.nick} a Azul`}>A</button>}
          {n.isAdmin && !m.bot && !m.host && <button className="mini" onClick={() => n.send({ t: 'makehost', target: m.id })} title="Hacer anfitrión" aria-label={`Hacer anfitrión a ${m.nick}`}>★</button>}
          {m.id !== n.id && !(m.admin && !n.isAdmin) && <button className="mini" onClick={() => n.send({ t: 'kick', target: m.id })} title={m.bot ? 'Quitar bot' : 'Expulsar'} aria-label={m.bot ? `Quitar ${m.nick}` : `Expulsar a ${m.nick}`}>✕</button>}
        </span>
      )}
    </div>
  );
}

function RewardBox() {
  const n = useNet();
  const r = n.reward;
  if (!r) return null;
  return (
    <div className={`notice ${r.eligible ? 'good' : 'warn'}`} role="status">
      <button className="mini close" onClick={() => n.dismissReward()} aria-label="Cerrar aviso">✕</button>
      {r.eligible
        ? `Partida oficial registrada: +${r.coins} HeroCoins${r.coins === 0 ? ' (tope diario alcanzado)' : ''}${r.dailyBonus ? ` · +${r.dailyBonus} por objetivo diario` : ''}${r.weeklyElite ? ` · +${r.weeklyElite} cofre élite por objetivo semanal` : ''}.`
        : `Partida oficial sin recompensa: ${r.reason ?? 'no cumplió los requisitos'}.`}
    </div>
  );
}

function RoomPanel({ room, prefs, setPrefs, onClose }: { room: RoomInfo; prefs: Prefs; setPrefs: (p: Prefs) => void; onClose?: () => void }) {
  const n = useNet();
  const acc = useAccount();
  const me = room.members.find((m) => m.id === n.id);
  // un moderador tiene los mismos permisos que el anfitrión
  const isHost = room.hostId === n.id || n.isAdmin;
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const invite = `${location.origin}${location.pathname}?sala=${room.id}`;
  const official = room.settings.official;
  const owned = acc.owned();
  const o = acc.profile?.objectives;
  const col = (side: Side, title: string) => {
    const list = room.members.filter((m) => m.side === side);
    const full = side !== 'spec' && list.length >= room.settings.teamSize;
    const canJoin = !full && me?.side !== side && !(official && side !== 'spec' && !n.account);
    return (
      <div className={`team-col ${side}`}>
        <button className="team-head" disabled={!canJoin} onClick={() => n.send({ t: 'side', side })} title={full ? 'Equipo completo' : canJoin ? 'Unirse' : ''}>
          {title} <span className="muted">{side !== 'spec' ? `${list.length}/${room.settings.teamSize}` : list.length}</span>
          {canJoin && <span className="join">Unirse</span>}
        </button>
        <div className="team-list">
          {list.map((m) => <MemberRow key={m.id} m={m} isHost={isHost} />)}
        </div>
        {isHost && side !== 'spec' && !full && !official && <button className="mini wide" onClick={() => n.send({ t: 'addbot', side: side as Team })}>+ Bot</button>}
      </div>
    );
  };
  return (
    <div className="room-panel panel">
      <h1>
        {room.name}
        {official ? <span className="tag official">Oficial</span> : <span className="tag">Casual</span>}
        <NoCdTag on={room.settings.cooldowns === 'none' && room.settings.mode !== 'classic'} />
        <span className="grow" />
        {onClose && <button className="mini" onClick={onClose}>Volver al partido (Esc)</button>}
      </h1>
      <div className="invite">
        <span className="muted">Invitación:</span>
        <input readOnly value={invite} onFocus={(e) => e.target.select()} aria-label="Enlace de invitación" />
        <button className="mini" onClick={() => { void navigator.clipboard?.writeText(invite).then(() => setCopied(true)); }}>{copied ? 'Copiado' : 'Copiar'}</button>
        <ConnBadge />
      </div>
      <RewardBox />
      {official ? (
        <div className="official-info">
          {n.account
            ? o && <span className="small">Hoy: {Math.min(o.daily.matches, o.daily.goal)}/{o.daily.goal} partidas para el objetivo diario · {o.matchCoinsToday}/{o.matchCoinsCap} HeroCoins de partidas.</span>
            : <span className="small error-text">Estás como invitado: en una sala oficial sólo podés mirar. Entrá con tu cuenta para jugar.</span>}
          <OfficialRules />
        </div>
      ) : (
        <p className="muted small">Partida casual: cualquier héroe, con bots si querés. No da recompensas.</p>
      )}
      <div className="teams">
        {col('red', 'Rojo')}
        {col('spec', 'Espectadores')}
        {col('blue', 'Azul')}
      </div>
      <div className="room-bottom">
        <div className="room-left">
          {room.settings.mode !== 'classic' && (
            <HeroPicker
              mode={room.settings.mode}
              value={me?.hero ?? prefs.hero}
              team={me?.side}
              locked={official ? (h) => !owned.has(h) : undefined}
              onChange={(hero: HeroId) => {
                setPrefs({ ...prefs, hero });
                n.send({ t: 'hero', hero });
              }}
              note={[
                official ? 'Sala oficial: sólo héroes de tu colección (🔒 = bloqueado).' : '',
                room.playing ? 'Durante el partido, el cambio se aplica en el próximo saque (sin reiniciar recargas).' : '',
              ].filter(Boolean).join(' ') || undefined}
            />
          )}
          {room.settings.mode === 'classic' && <p className="muted">Modo Clásico: sin poderes, física base.</p>}
        </div>
        <div className="room-right">
          <SettingsFields s={room.settings} disabled={!isHost} playing={room.playing} onChange={(s) => n.send({ t: 'settings', settings: s })} />
          {room.playing && isHost && room.settings.mode !== 'classic' && <p className="muted small">Con el partido en curso sólo se puede cambiar Cooldowns: se aplica al reiniciar (Revancha) y se avisa a todos.</p>}
          {!isHost && <p className="muted small">Sólo el anfitrión cambia la configuración e inicia el partido.</p>}
          {n.isBrowserHost && <p className="muted small">La sala corre en tu navegador: si cerrás esta pestaña, termina para todos. Dejala visible mientras se juega.</p>}
          {isHost && (
            <div className="btn-row">
              {!room.playing && <button className="primary" onClick={() => n.send({ t: 'start' })}>Iniciar partido</button>}
              {room.playing && <button onClick={() => n.send({ t: 'pause' })}>Pausa / Reanudar</button>}
              {room.playing && <button onClick={() => n.send({ t: 'restart' })}>Revancha</button>}
              {room.playing && <button onClick={() => n.send({ t: 'stop' })}>Detener</button>}
            </div>
          )}
          {n.error && <div className="error">{n.error}</div>}
          {n.adminError && <div className="error">{n.adminError}</div>}
          <div className="btn-row">
            <button onClick={() => n.leaveRoom()}>{n.isBrowserHost ? 'Cerrar la sala' : 'Salir de la sala'}</button>
            <button onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Ajustes</button>
          </div>
          {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
        </div>
      </div>
      {n.isAdmin && <AdminPanel />}
      <Chat docked lines={n.chat} send={(text) => n.send({ t: 'chat', text })} />
      <Controls />
    </div>
  );
}

function AdminPanel() {
  const n = useNet();
  const a = n.adminState;
  const sideName: Record<Side, string> = { red: 'Rojo', blue: 'Azul', spec: 'Espect.' };
  const g = a?.game;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="admin-panel">
      <div className="admin-head">
        <b>Moderación</b>
        <span className="muted small">Tenés permisos de anfitrión en esta sala.</span>
      </div>
      {!a ? <div className="muted small">Esperando datos de la sala…</div> : (
        <>
          <div className="admin-stats">
            <span>Sala abierta: <b>{clock(a.uptime)}</b></span>
            <span>Estado: <b>{g ? (g.paused ? 'En pausa' : { kickoff: 'Saque', playing: 'En juego', goal: 'Gol', ended: 'Terminado' }[g.phase] ?? g.phase) : 'Sin partido'}</b></span>
            {g && <span>Marcador: <b>{g.score.red} - {g.score.blue}</b></span>}
            {g && <span>Tiempo: <b>{clock(g.time)}{g.timeLimit ? ' / ' + clock(g.timeLimit) : ''}{g.overtime ? ' (gol de oro)' : ''}</b></span>}
            {g && <span>Tick: <b>{g.tick}</b></span>}
            {g && <span>Snapshot: <b>{(a.snapBytes / 1024).toFixed(1)} KB</b> × 30/s</span>}
          </div>
          <table className="admin-table">
            <thead><tr><th>Jugador</th><th>Equipo</th><th>Ping</th><th>Cola</th><th>Sin entradas</th><th>Última entrada</th></tr></thead>
            <tbody>
              {a.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.nick}{m.bot ? ' [BOT]' : ''}{m.admin ? ' [MOD]' : ''} <span className="muted">{m.id}</span></td>
                  <td>{sideName[m.side]}</td>
                  <td>{m.bot ? '—' : `${m.ping} ms`}</td>
                  <td>{m.bot ? '—' : m.queue}</td>
                  <td className={m.starved > 30 ? 'warn' : ''}>{m.bot || m.side === 'spec' ? '—' : `${(m.starved / 60).toFixed(1)} s`}</td>
                  <td>{m.bot ? '—' : m.ack}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ offline

function OfflineGame({ prefs, setPrefs, nick, opts, onExit }: { prefs: Prefs; setPrefs: (p: Prefs) => void; nick: string; opts: LocalOptions; onExit: () => void }) {
  const session = useMemo(() => new LocalSession({ ...opts }), [opts]);
  const [menu, setMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ended = useSyncExternalStore(
    (cb) => { const t = window.setInterval(cb, 300); return () => window.clearInterval(t); },
    () => session.state.phase === 'ended',
  );
  useEffect(() => {
    if (!menu || opts.kind !== 'bots') return;
    session.state.paused = true;
    return () => { session.state.paused = false; };
  }, [menu, session, opts.kind]);
  const names = useMemo(() => {
    const m = new Map<string, string>([['me', nick || 'Vos']]);
    for (const b of session.brains) m.set(b.id, `${HEROES[session.state.players.find((p) => p.id === b.id)?.hero ?? 'spider'].name} [BOT]`);
    return m;
  }, [session, nick]);
  return (
    <GameView
      session={session}
      names={names}
      prefs={prefs}
      menuOpen={menu || ended}
      onToggleMenu={() => setMenu((v) => !v)}
      status={<><NoCdTag on={!!opts.noCooldowns} /><span className="muted">{opts.kind === 'training' ? 'Entrenamiento' : 'Contra bots'} · {MODE_LABEL[opts.mode]} · sin recompensas</span></>}
      extraKeys={(e) => {
        if (e.code === 'KeyR' && opts.kind === 'training') session.resetPositions();
      }}
      menu={
        <Panel title={ended ? (session.state.winner ? `¡Ganó ${session.state.winner === 'red' ? 'Rojo' : 'Azul'}!` : 'Fin del partido') : 'Menú'} className="offline-menu">
          <HeroPicker
            mode={opts.mode}
            value={prefs.hero}
            team="red"
            onChange={(hero) => { setPrefs({ ...prefs, hero }); session.setHero(hero); }}
            note={opts.kind === 'bots' ? 'El cambio se aplica en el próximo saque.' : undefined}
          />
          <div className="btn-row">
            {opts.kind === 'training' && <button onClick={() => { session.resetPositions(); setMenu(false); }}>Volver al centro (R)</button>}
            <button className="primary" onClick={() => { session.opts.hero = prefs.hero; session.restart(); setMenu(false); }}>{opts.kind === 'bots' ? 'Revancha / reiniciar' : 'Reiniciar'}</button>
            {!ended && <button onClick={() => setMenu(false)}>Continuar</button>}
            <button onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Ajustes</button>
            <button onClick={onExit}>Salir</button>
          </div>
          {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
          <Controls />
        </Panel>
      }
    />
  );
}
