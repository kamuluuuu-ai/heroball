// Preferencias locales del usuario (localStorage del navegador).
import type { HeroId } from '../../shared/config';

export interface Prefs {
  nick: string;
  hero: HeroId;
  sound: boolean;
  volume: number;
  /** 1 = cancha completa; 1.3 / 1.6 acercan la cámara. */
  zoom: number;
  showNames: boolean;
  touch: 'auto' | 'on' | 'off';
  /** Capa de depuración de contacto (radios, alcance de patada, posiciones de red). */
  debug: boolean;
}

const KEY = 'heroball.prefs.v1';
const DEFAULTS: Prefs = { nick: '', hero: 'spider', sound: true, volume: 0.5, zoom: 1, showNames: true, touch: 'auto', debug: false };

/** Campos que versiones anteriores guardaban y ya no se usan (la clave de administrador ya no vive en el navegador). */
const OBSOLETE = ['adminKey'];

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, unknown>;
      if (OBSOLETE.some((k) => k in stored)) {
        for (const k of OBSOLETE) delete stored[k];
        localStorage.setItem(KEY, JSON.stringify(stored));
      }
      return { ...DEFAULTS, ...stored };
    }
  } catch {
    /* sin almacenamiento: usar valores por defecto */
  }
  return { ...DEFAULTS };
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignorar */
  }
}

export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}
