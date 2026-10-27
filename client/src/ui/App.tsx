import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { HEROES, type HeroId } from '../../../shared/config';
import { DEFAULT_SETTINGS, MAX_NICK, MAX_ROOM_NAME, type RoomInfo, type RoomMember, type RoomSettings } from '../../../shared/protocol';
import type { GameMode, Side, Team } from '../../../shared/types';
import { setAudio } from '../game/audio';
import { net } from '../game/net';
import { LocalSession, NetSession, type LocalOptions } from '../game/sessions';
import { loadPrefs, savePrefs, type Prefs } from '../prefs';
import { Chat } from './Chat';
import { Controls, HeroBadge, HeroPicker, SettingsPanel } from './common';
import { GameView } from './GameView';

type Screen = { k: 'nick' } | { k: 'lobby' } | { k: 'online' } | { k: 'offline'; opts: LocalOptions };

function useNet() {
  const [, force] = useState(0);
  useEffect(() => net.subscribe(() => force((n) => n + 1)), []);
  return net;
}

function getInviteRoom(): string | null {
  return new URLSearchParams(location.search).get('sala');
}

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

  const [screen, setScreen] = useState<Screen>(() => (prefs.nick ? { k: 'lobby' } : { k: 'nick' }));
  const n = useNet();

  // conectar al entrar al lobby (y unirse por invitación)
  useEffect(() => {
    if (screen.k === 'lobby' && prefs.nick && n.status === 'closed') {
      const invite = getInviteRoom();
      n.connect(prefs.nick, invite ?? undefined);
    }
  }, [screen.k, prefs.nick, n.status]); // eslint-disable-line

  useEffect(() => {
    if (n.room && screen.k === 'lobby') setScreen({ k: 'online' });
    if (!n.room && screen.k === 'online') setScreen({ k: 'lobby' });
  }, [n.room, screen.k]);

  // la URL refleja la sala actual (enlace de invitación)
  useEffect(() => {
    const url = new URL(location.href);
    if (n.room) url.searchParams.set('sala', n.room.id);
    else url.searchParams.delete('sala');
    history.replaceState(null, '', url);
  }, [n.room?.id]); // eslint-disable-line

  switch (screen.k) {
    case 'nick':
      return (
        <NickScreen
          initial={prefs.nick}
          onDone={(nick) => {
            setPrefs({ ...prefs, nick });
            if (n.status !== 'closed') n.connect(nick);
            setScreen({ k: 'lobby' });
          }}
        />
      );
    case 'lobby':
      return (
        <Lobby
          prefs={prefs}
          setPrefs={setPrefs}
          onChangeNick={() => setScreen({ k: 'nick' })}
          onOffline={(opts) => setScreen({ k: 'offline', opts })}
        />
      );
    case 'online':
      // al salir, la sala desaparece antes de volver al lobby
      return n.room ? <OnlineRoom prefs={prefs} setPrefs={setPrefs} /> : null;
    case 'offline':
      return <OfflineGame prefs={prefs} setPrefs={setPrefs} opts={screen.opts} onExit={() => setScreen({ k: 'lobby' })} />;
  }
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function NickScreen({ initial, onDone }: { initial: string; onDone: (n: string) => void }) {
  const [nick, setNick] = useState(initial);
  return (
    <div className="menu-bg center">
      <div className="logo">Hero<span>Ball</span></div>
      <Panel title="Elegí tu apodo" className="nick-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = nick.trim();
            if (v) onDone(v);
          }}
        >
          <input autoFocus value={nick} maxLength={MAX_NICK} onChange={(e) => setNick(e.target.value)} placeholder="Apodo" />
          <button type="submit" disabled={!nick.trim()}>Aceptar</button>
        </form>
      </Panel>
      <p className="disclaimer">HeroBall es un proyecto independiente inspirado en HaxBall. No es el sitio oficial de HaxBall.</p>
    </div>
  );
}

function Lobby({ prefs, setPrefs, onChangeNick, onOffline }: {
  prefs: Prefs; setPrefs: (p: Prefs) => void; onChangeNick: () => void; onOffline: (o: LocalOptions) => void;
}) {
  const n = useNet();
  const [creating, setCreating] = useState(false);
  const [offline, setOffline] = useState<null | 'training' | 'bots'>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => n.send({ t: 'list' }), 4000);
    return () => window.clearInterval(t);
  }, [n]);

  if (creating) return <CreateRoom onCancel={() => setCreating(false)} nick={prefs.nick} />;
  if (offline) return <OfflineSetup kind={offline} prefs={prefs} setPrefs={setPrefs} onCancel={() => setOffline(null)} onStart={onOffline} />;

  return (
    <div className="menu-bg center">
      <Panel title="Salas" className="rooms-panel">
        <div className="lobby-head">
          <span>Jugando como <b>{prefs.nick}</b> <a onClick={onChangeNick}>cambiar</a></span>
          <ConnBadge />
        </div>
        <div className="room-table">
          <div className="room-row head">
            <span>Nombre</span><span>Jugadores</span><span>Modo</span><span>Estado</span>
          </div>
          <div className="room-list">
            {n.status !== 'open' && <div className="empty">{n.status === 'connecting' ? (n.p2p ? 'Conectando con la sala…' : 'Conectando con el servidor…') : 'Sin conexión con el servidor. Podés jugar sin conexión (entrenamiento o contra bots).'}</div>}
            {n.status === 'open' && n.p2p && <WebModeHelp />}
            {n.status === 'open' && !n.p2p && n.rooms?.length === 0 && <div className="empty">No hay salas abiertas. Creá una e invitá a alguien con el enlace.</div>}
            {n.status === 'open' && n.rooms?.map((r) => (
              <div key={r.id} className="room-row" onDoubleClick={() => n.send({ t: 'join', room: r.id })} onClick={() => n.send({ t: 'join', room: r.id })}>
                <span className="rname">{r.name}</span>
                <span>{r.players}/{r.maxPlayers}</span>
                <span>{r.mode === 'heroes' ? 'Héroes' : 'Clásico'} {r.teamSize}v{r.teamSize}</span>
                <span>{r.playing ? 'En juego' : 'Esperando'}</span>
              </div>
            ))}
          </div>
        </div>
        {n.error && <div className="error">{n.error}</div>}
        <div className="btn-row">
          {!n.p2p && <button onClick={() => n.send({ t: 'list' })} disabled={n.status !== 'open'}>Actualizar</button>}
          <button onClick={() => setCreating(true)} disabled={n.status !== 'open'}>Crear sala</button>
          {n.status === 'closed' && <button onClick={() => n.connect(prefs.nick)}>Reconectar</button>}
          <span className="grow" />
          <button onClick={() => setOffline('training')}>Entrenamiento</button>
          <button onClick={() => setOffline('bots')}>Contra bots</button>
          <button onClick={() => setShowSettings(!showSettings)}>Ajustes</button>
        </div>
        {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
        <Controls />
      </Panel>
    </div>
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
      <p>Versión web: no hay servidor central ni lista pública de salas.</p>
      <p><b>Crear sala</b> la aloja en tu navegador; compartí el enlace de invitación para que entren otros.</p>
      <form className="join-code" onSubmit={(e) => { e.preventDefault(); join(); }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pegá un enlace o código de sala" />
        <button type="submit" disabled={!code.trim()}>Unirse</button>
      </form>
    </div>
  );
}

function ConnBadge() {
  const n = useNet();
  if (n.p2p && !n.linked && n.status === 'open') return <span className="conn open">● Modo web (sin servidor)</span>;
  const label = n.status === 'open' ? `Conectado · ${Math.round(n.ping)} ms` : n.status === 'connecting' ? 'Conectando…' : 'Desconectado';
  return <span className={`conn ${n.status}`}>● {label}</span>;
}

function SettingsFields({ s, onChange, disabled }: { s: RoomSettings; onChange: (p: Partial<RoomSettings>) => void; disabled?: boolean }) {
  return (
    <div className="fields">
      <label>Modo
        <select disabled={disabled} value={s.mode} onChange={(e) => onChange({ mode: e.target.value as GameMode })}>
          <option value="heroes">Héroes</option>
          <option value="classic">Clásico (sin poderes)</option>
        </select>
      </label>
      <label>Equipos
        <select disabled={disabled} value={s.teamSize} onChange={(e) => onChange({ teamSize: Number(e.target.value) as 1 | 2 | 3 })}>
          <option value={1}>1v1</option><option value={2}>2v2</option><option value={3}>3v3</option>
        </select>
      </label>
      <label>Tiempo
        <select disabled={disabled} value={s.timeLimitMin} onChange={(e) => onChange({ timeLimitMin: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 7, 10].map((v) => <option key={v} value={v}>{v === 0 ? 'Sin límite' : `${v} min`}</option>)}
        </select>
      </label>
      <label>Goles
        <select disabled={disabled} value={s.scoreLimit} onChange={(e) => onChange({ scoreLimit: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 7, 10].map((v) => <option key={v} value={v}>{v === 0 ? 'Sin límite' : v}</option>)}
        </select>
      </label>
      <label>Capacidad
        <select disabled={disabled} value={s.maxPlayers} onChange={(e) => onChange({ maxPlayers: Number(e.target.value) })}>
          {[2, 4, 6, 8, 10, 12, 16].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
    </div>
  );
}

function CreateRoom({ onCancel, nick }: { onCancel: () => void; nick: string }) {
  const n = useNet();
  const [name, setName] = useState(`Sala de ${nick}`);
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  return (
    <div className="menu-bg center">
      <Panel title="Crear sala">
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
          {n.error && <div className="error">{n.error}</div>}
          <div className="btn-row">
            <button type="button" onClick={onCancel}>Cancelar</button>
            <span className="grow" />
            <button type="submit">Crear</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function OfflineSetup({ kind, prefs, setPrefs, onCancel, onStart }: {
  kind: 'training' | 'bots'; prefs: Prefs; setPrefs: (p: Prefs) => void; onCancel: () => void; onStart: (o: LocalOptions) => void;
}) {
  const [mode, setMode] = useState<GameMode>('heroes');
  const [teamSize, setTeamSize] = useState<1 | 2 | 3>(1);
  const [skill, setSkill] = useState(0.6);
  return (
    <div className="menu-bg center">
      <Panel title={kind === 'training' ? 'Entrenamiento (sin conexión)' : 'Partido contra bots (sin conexión)'}>
        <HeroPicker value={prefs.hero} onChange={(hero) => setPrefs({ ...prefs, hero })} team="red" />
        <div className="fields">
          <label>Modo
            <select value={mode} onChange={(e) => setMode(e.target.value as GameMode)}>
              <option value="heroes">Héroes</option>
              <option value="classic">Clásico</option>
            </select>
          </label>
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
        {kind === 'bots' && <p className="muted small">Partido a 3 minutos o 3 goles. Los bots están marcados con [BOT].</p>}
        {kind === 'training' && <p className="muted small">Sin rival ni reloj. R: reiniciar posiciones · Esc: menú.</p>}
        <div className="btn-row">
          <button onClick={onCancel}>Volver</button>
          <span className="grow" />
          <button onClick={() => onStart({ kind, mode, hero: prefs.hero, teamSize, timeLimitMin: 3, scoreLimit: 3, botSkill: skill })}>Jugar</button>
        </div>
      </Panel>
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

  // al cambiar el héroe preferido, avisar al servidor
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
      status={<ConnBadge />}
      idle={null}
      menu={<RoomPanel room={room} prefs={prefs} setPrefs={setPrefs} onClose={room.playing ? () => setMenu(false) : undefined} />}
    />
  );
}

function MemberRow({ m, room, isHost }: { m: RoomMember; room: RoomInfo; isHost: boolean }) {
  const n = useNet();
  const move = (side: Side) => n.send({ t: 'side', side, target: m.id });
  return (
    <div className={`member ${m.id === n.id ? 'me' : ''}`}>
      <HeroBadge hero={m.hero} size={18} team={m.side} />
      <span className="mnick">{m.host && <span title="Anfitrión">★ </span>}{m.nick}{m.bot && <span className="bot-tag">BOT</span>}</span>
      {!m.bot && m.id !== n.id && <span className="mping">{m.ping} ms</span>}
      {isHost && (
        <span className="mactions">
          {m.side !== 'red' && <button className="mini red" onClick={() => move('red')} title="Mover a Rojo">R</button>}
          {m.side !== 'spec' && !m.bot && <button className="mini" onClick={() => move('spec')} title="Mover a espectadores">S</button>}
          {m.side !== 'blue' && <button className="mini blue" onClick={() => move('blue')} title="Mover a Azul">A</button>}
          {m.id !== n.id && <button className="mini" onClick={() => n.send({ t: 'kick', target: m.id })} title={m.bot ? 'Quitar bot' : 'Expulsar'}>✕</button>}
        </span>
      )}
      <span className="sr" hidden>{room.id}</span>
    </div>
  );
}

function RoomPanel({ room, prefs, setPrefs, onClose }: { room: RoomInfo; prefs: Prefs; setPrefs: (p: Prefs) => void; onClose?: () => void }) {
  const n = useNet();
  const me = room.members.find((m) => m.id === n.id);
  const isHost = room.hostId === n.id;
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const invite = `${location.origin}${location.pathname}?sala=${room.id}`;
  const col = (side: Side, title: string) => {
    const list = room.members.filter((m) => m.side === side);
    const full = side !== 'spec' && list.length >= room.settings.teamSize;
    return (
      <div className={`team-col ${side}`}>
        <div className="team-head" onClick={() => !full && me?.side !== side && n.send({ t: 'side', side })} title={full ? 'Equipo completo' : 'Unirse'}>
          {title} <span className="muted">{side !== 'spec' ? `${list.length}/${room.settings.teamSize}` : list.length}</span>
          {!full && me?.side !== side && <span className="join">Unirse</span>}
        </div>
        <div className="team-list">
          {list.map((m) => <MemberRow key={m.id} m={m} room={room} isHost={isHost} />)}
        </div>
        {isHost && side !== 'spec' && !full && <button className="mini wide" onClick={() => n.send({ t: 'addbot', side: side as Team })}>+ Bot</button>}
      </div>
    );
  };
  return (
    <div className="room-panel panel">
      <h1>
        {room.name}
        <span className="grow" />
        {onClose && <button className="mini" onClick={onClose}>Volver al partido (Esc)</button>}
      </h1>
      <div className="invite">
        <span className="muted">Invitación:</span>
        <input readOnly value={invite} onFocus={(e) => e.target.select()} />
        <button className="mini" onClick={() => { void navigator.clipboard?.writeText(invite).then(() => setCopied(true)); }}>{copied ? 'Copiado' : 'Copiar'}</button>
        <ConnBadge />
      </div>
      <div className="teams">
        {col('red', 'Rojo')}
        {col('spec', 'Espectadores')}
        {col('blue', 'Azul')}
      </div>
      <div className="room-bottom">
        <div className="room-left">
          {room.settings.mode === 'heroes' && (
            <HeroPicker
              value={me?.hero ?? prefs.hero}
              team={me?.side}
              onChange={(hero: HeroId) => {
                setPrefs({ ...prefs, hero });
                n.send({ t: 'hero', hero });
              }}
              note={room.playing ? 'Durante el partido, el cambio se aplica en el próximo saque (sin reiniciar recargas).' : undefined}
            />
          )}
          {room.settings.mode === 'classic' && <p className="muted">Modo Clásico: sin poderes, física base.</p>}
        </div>
        <div className="room-right">
          <SettingsFields s={room.settings} disabled={!isHost || room.playing} onChange={(s) => n.send({ t: 'settings', settings: s })} />
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
          <div className="btn-row">
            <button onClick={() => n.leaveRoom()}>{n.isBrowserHost ? 'Cerrar la sala' : 'Salir de la sala'}</button>
            <button onClick={() => setShowSettings(!showSettings)}>Ajustes</button>
          </div>
          {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
        </div>
      </div>
      <Chat docked lines={n.chat} send={(text) => n.send({ t: 'chat', text })} />
      <Controls />
    </div>
  );
}

// ------------------------------------------------------------ offline

function OfflineGame({ prefs, setPrefs, opts, onExit }: { prefs: Prefs; setPrefs: (p: Prefs) => void; opts: LocalOptions; onExit: () => void }) {
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
    const m = new Map<string, string>([['me', prefs.nick]]);
    for (const b of session.brains) m.set(b.id, `${HEROES[session.state.players.find((p) => p.id === b.id)?.hero ?? 'spider'].name} [BOT]`);
    return m;
  }, [session, prefs.nick]);
  return (
    <GameView
      session={session}
      names={names}
      prefs={prefs}
      menuOpen={menu || ended}
      onToggleMenu={() => setMenu((v) => !v)}
      status={<span className="muted">{opts.kind === 'training' ? 'Entrenamiento' : 'Contra bots'} · {opts.mode === 'heroes' ? 'Héroes' : 'Clásico'}</span>}
      extraKeys={(e) => {
        if (e.code === 'KeyR' && opts.kind === 'training') session.resetPositions();
      }}
      menu={
        <div className="panel offline-menu">
          <h1>{ended ? (session.state.winner ? `¡Ganó ${session.state.winner === 'red' ? 'Rojo' : 'Azul'}!` : 'Fin del partido') : 'Menú'}</h1>
          <HeroPicker
            value={prefs.hero}
            team="red"
            onChange={(hero) => { setPrefs({ ...prefs, hero }); session.setHero(hero); }}
            note={opts.kind === 'bots' ? 'El cambio se aplica en el próximo saque.' : undefined}
          />
          <div className="btn-row">
            {opts.kind === 'training' && <button onClick={() => { session.resetPositions(); setMenu(false); }}>Reiniciar posiciones (R)</button>}
            <button className="primary" onClick={() => { session.opts.hero = prefs.hero; session.restart(); setMenu(false); }}>{opts.kind === 'bots' ? 'Revancha / reiniciar' : 'Reiniciar'}</button>
            {!ended && <button onClick={() => setMenu(false)}>Continuar</button>}
            <button onClick={() => setShowSettings(!showSettings)}>Ajustes</button>
            <button onClick={onExit}>Salir</button>
          </div>
          {showSettings && <SettingsPanel prefs={prefs} setPrefs={setPrefs} />}
          <Controls />
        </div>
      }
    />
  );
}
