import { useEffect, useRef, useState } from 'react';
import { GEM_COLOR, GEM_IDS, HEROES, byRarity, HERO_CATALOG, PUBLIC_HERO_IDS, RARITY_LABEL, SECRET_IDS, heroInfo, type HeroId, type Rarity } from '../../../shared/config';
import type { GameMode } from '../../../shared/types';
import { setAudio } from '../game/audio';
import { drawGemIcon, drawHero, drawPowerIcon, onPortraitLoad, preloadPortraits } from '../game/heroArt';
import type { Prefs } from '../prefs';

export function HeroBadge({ hero, size = 28, team }: { hero: HeroId; size?: number; team?: 'red' | 'blue' | 'spec' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // los retratos cargan en segundo plano: redibujar cuando llegan
  const [, setLoaded] = useState(0);
  useEffect(() => {
    preloadPortraits();
    return onPortraitLoad(() => setLoaded((n) => n + 1));
  }, []);
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
  });
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

export const RARITY_ICON: Record<Rarity, string> = { common: '●', rare: '◆', epic: '★', legendary: '♛' };

/** Rareza con color, texto e icono (no depende sólo del color). */
export function RarityTag({ rarity }: { rarity: Rarity }) {
  return <span className={`rarity r-${rarity}`}>{RARITY_ICON[rarity]} {RARITY_LABEL[rarity]}</span>;
}

function GemIcon({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!.getContext('2d')!;
    c.clearRect(0, 0, 40, 40);
    drawGemIcon(c, color, 40);
  }, [color]);
  return <canvas ref={ref} width={40} height={40} className="power-icon" />;
}

export function PowerList({ hero, mode = 'heroes' }: { hero: HeroId; mode?: GameMode }) {
  const h = heroInfo(hero, mode);
  if (h.gems) {
    return (
      <div className="hero-powers">
        <div className="muted small">Teclas 1–5 eligen la gema · Q la activa · E pasa a la siguiente (en el celular: tocá la gema y después Q).</div>
        {h.gems.map((g, i) => (
          <div key={i} className="hero-power">
            <GemIcon color={GEM_COLOR[GEM_IDS[i]]} />
            <div>
              <b>{i + 1} · {g.name}</b> <span className="muted">(recarga {Math.round(g.cooldown / 60)} s)</span>
              <div className="muted">{g.desc}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="hero-powers">
      {(['q', 'e'] as const).map((k) => (
        <div key={k} className="hero-power">
          <PowerIcon hero={hero} slot={k} />
          <div>
            <b>{k.toUpperCase()} · {h[k].name}</b> <span className="muted">(recarga {Math.round(h[k].cooldown / 60)} s)</span>
            <div className="muted">{h[k].desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeroPicker({ value, onChange, team, note, mode = 'heroes', locked, secrets = [] }: {
  value: HeroId; onChange: (h: HeroId) => void; team?: 'red' | 'blue' | 'spec'; note?: string; mode?: GameMode;
  /** Héroes no disponibles en esta partida (oficial: sólo los de la colección). */
  locked?: (h: HeroId) => boolean;
  /** Personajes secretos que esta cuenta tiene (sólo esos se muestran). */
  secrets?: HeroId[];
}) {
  const ids = byRarity([...PUBLIC_HERO_IDS, ...SECRET_IDS.filter((h) => secrets.includes(h))]);
  return (
    <div className="hero-picker">
      <div className="hero-row" role="radiogroup" aria-label="Héroe">
        {ids.map((id) => {
          const lock = locked?.(id) ?? false;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={id === value}
              className={`hero-btn ${id === value ? 'sel' : ''} ${lock ? 'locked' : ''} r-${HERO_CATALOG[id].rarity}`}
              disabled={lock}
              onClick={() => onChange(id)}
              title={lock ? `${HEROES[id].name}: bloqueado en tu colección` : HEROES[id].name}
            >
              <HeroBadge hero={id} size={30} team={team} />
              <span>{HEROES[id].name}{lock && <span aria-label="bloqueado"> 🔒</span>}</span>
            </button>
          );
        })}
      </div>
      <PowerList hero={value} mode={mode} />
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
      <label className="row" title="Reducidos: sin partículas, destellos ni giros; las zonas, avisos y haces siguen visibles. También se activa si el sistema pide menos movimiento.">
        Efectos
        <select value={prefs.effects} onChange={(e) => setPrefs({ ...prefs, effects: e.target.value as Prefs['effects'] })}>
          <option value="full">Completos</option>
          <option value="reduced">Reducidos</option>
        </select>
      </label>
      <label className="row" title="Muestra radios físicos, alcance de patada, separación entre bordes y posiciones de red">
        <input type="checkbox" checked={prefs.debug} onChange={(e) => setPrefs({ ...prefs, debug: e.target.checked })} /> Depuración de contacto
      </label>
    </div>
  );
}

export function Controls() {
  return (
    <div className="controls-help muted small">
      WASD/flechas mover · Espacio/X patear · Q/E poderes · 1–5 gemas (Thanos) · 1–3 responder el quiz · Enter chat · Esc menú
    </div>
  );
}
