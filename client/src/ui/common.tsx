import { useEffect, useRef, useState } from 'react';
import { HEROES, HERO_IDS, heroInfo, type HeroId } from '../../../shared/config';
import type { GameMode } from '../../../shared/types';
import { setAudio } from '../game/audio';
import { drawHero, drawPowerIcon } from '../game/heroArt';
import { net } from '../game/net';
import type { Prefs } from '../prefs';

export function HeroBadge({ hero, size = 28, team }: { hero: HeroId; size?: number; team?: 'red' | 'blue' | 'spec' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ref.current!.width = ref.current!.height = size * dpr;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, size, size);
    c.translate(size / 2, size / 2);
    const r = size / 2 - 1;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = team === 'red' ? '#E56E56' : team === 'blue' ? '#5689E5' : '#888';
    c.fill();
    drawHero(c, hero, r * 0.76);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.lineWidth = 1.5;
    c.strokeStyle = '#000';
    c.stroke();
  }, [hero, size, team]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="hero-badge" />;
}

function PowerIcon({ hero, slot }: { hero: HeroId; slot: 'q' | 'e' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!.getContext('2d')!;
    c.clearRect(0, 0, 40, 40);
    drawPowerIcon(c, hero, slot, 40);
  }, [hero, slot]);
  return <canvas ref={ref} width={40} height={40} className="power-icon" />;
}

export function HeroPicker({ value, onChange, team, note, mode = 'heroes' }: { value: HeroId; onChange: (h: HeroId) => void; team?: 'red' | 'blue' | 'spec'; note?: string; mode?: GameMode }) {
  const h = heroInfo(value, mode);
  return (
    <div className="hero-picker">
      <div className="hero-row">
        {HERO_IDS.map((id) => (
          <button key={id} className={`hero-btn ${id === value ? 'sel' : ''}`} onClick={() => onChange(id)} title={HEROES[id].name}>
            <HeroBadge hero={id} size={34} team={team} />
            <span>{HEROES[id].name}</span>
          </button>
        ))}
      </div>
      <div className="hero-powers">
        {(['q', 'e'] as const).map((k) => (
          <div key={k} className="hero-power">
            <PowerIcon hero={value} slot={k} />
            <div>
              <b>{k.toUpperCase()} · {h[k].name}</b> <span className="muted">({Math.round(h[k].cooldown / 60)} s)</span>
              <div className="muted">{h[k].desc}</div>
            </div>
          </div>
        ))}
      </div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

export function SettingsPanel({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  useEffect(() => setAudio(prefs.sound, prefs.volume), [prefs.sound, prefs.volume]);
  return (
    <div className="settings">
      <label className="row">
        <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ ...prefs, sound: e.target.checked })} /> Sonido
      </label>
      <label className="row">
        Volumen
        <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPrefs({ ...prefs, volume: Number(e.target.value) })} />
      </label>
      <label className="row">
        Escala
        <select value={prefs.zoom} onChange={(e) => setPrefs({ ...prefs, zoom: Number(e.target.value) })}>
          <option value={1}>Cancha completa</option>
          <option value={1.3}>Cerca</option>
          <option value={1.7}>Muy cerca</option>
        </select>
      </label>
      <label className="row">
        <input type="checkbox" checked={prefs.showNames} onChange={(e) => setPrefs({ ...prefs, showNames: e.target.checked })} /> Mostrar nombres
      </label>
      <label className="row">
        Controles táctiles
        <select value={prefs.touch} onChange={(e) => setPrefs({ ...prefs, touch: e.target.value as Prefs['touch'] })}>
          <option value="auto">Automático</option>
          <option value="on">Siempre</option>
          <option value="off">Nunca</option>
        </select>
      </label>
      <AdminKeyField prefs={prefs} setPrefs={setPrefs} />
    </div>
  );
}

/** Clave privada de administrador: se guarda sólo en este navegador y nunca se envía (sólo firmas). */
function AdminKeyField({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const [, force] = useState(0);
  useEffect(() => net.subscribe(() => force((n) => n + 1)), []);
  const status = !prefs.adminKey
    ? null
    : net.adminError
      ? <span className="error-text">{net.adminError}</span>
      : net.isAdmin
        ? <span className="ok-text">Verificado como administrador.</span>
        : <span className="muted">Se verifica al entrar a una sala.</span>;
  return (
    <details className="admin-key" open={!!prefs.adminKey}>
      <summary>Administración</summary>
      <label className="row">
        Clave
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Clave privada de administrador"
          value={prefs.adminKey}
          onChange={(e) => setPrefs({ ...prefs, adminKey: e.target.value.trim() })}
        />
      </label>
      {status && <div className="small">{status}</div>}
    </details>
  );
}

export function Controls() {
  return (
    <div className="controls-help muted small">
      WASD/flechas mover · Espacio/X patear · Q/E poderes · Enter chat · Esc menú
    </div>
  );
}
