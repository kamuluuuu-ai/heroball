// Emblemas de héroes dibujados con Canvas (recursos propios). Se dibujan en
// coordenadas locales de un disco de radio `r`, dentro del anillo de equipo.
import type { HeroId } from '../../../shared/config';

type Ctx = CanvasRenderingContext2D;

/** Salpicadura de tinta (camino cerrado, determinista): `n` gotas alrededor de un centro. */
export function inkBlot(c: Ctx, x: number, y: number, r: number, n: number, seed = 1) {
  c.beginPath();
  const steps = n * 6;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const lobe = Math.sin(a * n + seed) * 0.5 + 0.5;
    const jag = Math.sin(a * n * 3.7 + seed * 2.1) * 0.08;
    const rr = r * (0.62 + lobe * lobe * 0.45 + jag);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function circle(c: Ctx, x: number, y: number, r: number) {

  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function spider(c: Ctx, r: number) {
  c.fillStyle = '#C8161D';
  circle(c, 0, 0, r);
  c.fill();
  c.strokeStyle = 'rgba(40,0,0,0.75)';
  c.lineWidth = r * 0.06;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    c.beginPath();
    c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    c.lineTo(-Math.cos(a) * r, -Math.sin(a) * r);
    c.stroke();
  }
  for (const k of [0.4, 0.75]) {
    circle(c, 0, 0, r * k);
    c.stroke();
  }
  // ojos
  for (const s of [-1, 1]) {
    c.save();
    c.translate(s * r * 0.38, -r * 0.08);
    c.rotate(s * 0.5);
    c.beginPath();
    c.ellipse(0, 0, r * 0.3, r * 0.19, 0, 0, Math.PI * 2);
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = r * 0.09;
    c.strokeStyle = '#111';
    c.stroke();
    c.restore();
  }
}

function batman(c: Ctx, r: number) {
  // capucha oscura con orejas, mentón claro
  c.save();
  circle(c, 0, 0, r);
  c.clip();
  c.fillStyle = '#2A2C35';
  c.fillRect(-r, -r, 2 * r, 2 * r);
  c.fillStyle = '#E3B48B';
  c.beginPath();
  c.ellipse(0, r * 0.62, r * 0.62, r * 0.48, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.fillStyle = '#2A2C35';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * r * 0.62, -r * 0.35);
    c.lineTo(s * r * 0.48, -r * 0.98);
    c.lineTo(s * r * 0.22, -r * 0.55);
    c.closePath();
    c.fill();
  }
  c.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * r * 0.12, -r * 0.05);
    c.lineTo(s * r * 0.55, -r * 0.16);
    c.lineTo(s * r * 0.5, r * 0.05);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = '#5a3a26';
  c.lineWidth = r * 0.08;
  c.beginPath();
  c.moveTo(-r * 0.25, r * 0.58);
  c.lineTo(r * 0.25, r * 0.58);
  c.stroke();
}

function hulk(c: Ctx, r: number) {
  c.fillStyle = '#5AA637';
  circle(c, 0, 0, r);
  c.fill();
  // pelo
  c.save();
  circle(c, 0, 0, r);
  c.clip();
  c.fillStyle = '#1C1F17';
  c.beginPath();
  c.moveTo(-r, -r * 0.3);
  for (let i = 0; i <= 6; i++) {
    const x = -r + (2 * r * i) / 6;
    c.lineTo(x, -r * (i % 2 ? 0.55 : 0.4));
  }
  c.lineTo(r, -r);
  c.lineTo(-r, -r);
  c.closePath();
  c.fill();
  c.restore();
  // cejas enojadas
  c.strokeStyle = '#1C1F17';
  c.lineWidth = r * 0.16;
  c.lineCap = 'round';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * r * 0.62, -r * 0.2);
    c.lineTo(s * r * 0.12, -r * 0.02);
    c.stroke();
  }
  c.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    circle(c, s * r * 0.36, r * 0.14, r * 0.11);
    c.fill();
  }
  // boca con dientes
  c.fillStyle = '#1C1F17';
  c.fillRect(-r * 0.4, r * 0.42, r * 0.8, r * 0.24);
  c.fillStyle = '#f2f2e6';
  c.fillRect(-r * 0.34, r * 0.45, r * 0.68, r * 0.08);
  c.lineCap = 'butt';
}

function superman(c: Ctx, r: number) {
  c.fillStyle = '#1F4FB8';
  circle(c, 0, 0, r);
  c.fill();
  // escudo
  c.beginPath();
  c.moveTo(-r * 0.78, -r * 0.42);
  c.lineTo(-r * 0.48, -r * 0.72);
  c.lineTo(r * 0.48, -r * 0.72);
  c.lineTo(r * 0.78, -r * 0.42);
  c.lineTo(0, r * 0.8);
  c.closePath();
  c.fillStyle = '#F6D21A';
  c.fill();
  c.lineWidth = r * 0.12;
  c.strokeStyle = '#D3202A';
  c.stroke();
  c.fillStyle = '#D3202A';
  c.font = `900 ${r * 1.05}px Arial Black, Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('S', 0, -r * 0.08);
}

/** Fondo de color con un aro interior, base de los emblemas nuevos. */
function base(c: Ctx, r: number, fill: string, ring?: string) {
  circle(c, 0, 0, r);
  c.fillStyle = fill;
  c.fill();
  if (ring) {
    circle(c, 0, 0, r * 0.82);
    c.lineWidth = r * 0.1;
    c.strokeStyle = ring;
    c.stroke();
  }
}

function hawkeye(c: Ctx, r: number) {
  base(c, r, '#4B2A6B', '#8E5BB8');
  // diana
  circle(c, 0, 0, r * 0.5);
  c.lineWidth = r * 0.1;
  c.strokeStyle = '#E9D9F5';
  c.stroke();
  circle(c, 0, 0, r * 0.17);
  c.fillStyle = '#E9D9F5';
  c.fill();
  // flecha
  c.beginPath();
  c.moveTo(-r * 0.75, r * 0.75);
  c.lineTo(r * 0.45, -r * 0.45);
  c.stroke();
  c.beginPath();
  c.moveTo(r * 0.62, -r * 0.62);
  c.lineTo(r * 0.22, -r * 0.5);
  c.lineTo(r * 0.5, -r * 0.22);
  c.closePath();
  c.fill();
}

function widow(c: Ctx, r: number) {
  base(c, r, '#1C1C22', '#3A3A44');
  // reloj de arena rojo
  c.fillStyle = '#D9232E';
  c.beginPath();
  c.moveTo(-r * 0.42, -r * 0.5);
  c.lineTo(r * 0.42, -r * 0.5);
  c.lineTo(r * 0.06, 0);
  c.lineTo(r * 0.42, r * 0.5);
  c.lineTo(-r * 0.42, r * 0.5);
  c.lineTo(-r * 0.06, 0);
  c.closePath();
  c.fill();
}

function star(c: Ctx, r: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.42 : r;
    c.lineTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  c.closePath();
}

function cap(c: Ctx, r: number) {
  // escudo concéntrico
  base(c, r, '#C8232C');
  circle(c, 0, 0, r * 0.74);
  c.fillStyle = '#F2F2F2';
  c.fill();
  circle(c, 0, 0, r * 0.52);
  c.fillStyle = '#C8232C';
  c.fill();
  circle(c, 0, 0, r * 0.36);
  c.fillStyle = '#1F3F94';
  c.fill();
  star(c, r * 0.3);
  c.fillStyle = '#F2F2F2';
  c.fill();
}

function panther(c: Ctx, r: number) {
  base(c, r, '#1A1A24', '#6E5AA8');
  // garras plateadas
  c.strokeStyle = '#C9C6E8';
  c.lineWidth = r * 0.12;
  c.lineCap = 'round';
  for (const o of [-0.35, 0, 0.35]) {
    c.beginPath();
    c.moveTo(o * r - r * 0.15, -r * 0.5);
    c.quadraticCurveTo(o * r + r * 0.2, 0, o * r - r * 0.05, r * 0.52);
    c.stroke();
  }
}

function ironman(c: Ctx, r: number) {
  base(c, r, '#A3151C', '#E0B12E');
  // placa facial dorada y ojos
  c.fillStyle = '#E0B12E';
  c.beginPath();
  c.moveTo(-r * 0.45, -r * 0.42);
  c.lineTo(r * 0.45, -r * 0.42);
  c.lineTo(r * 0.38, r * 0.3);
  c.lineTo(0, r * 0.55);
  c.lineTo(-r * 0.38, r * 0.3);
  c.closePath();
  c.fill();
  c.fillStyle = '#E8FBFF';
  c.fillRect(-r * 0.36, -r * 0.18, r * 0.26, r * 0.1);
  c.fillRect(r * 0.1, -r * 0.18, r * 0.26, r * 0.1);
}

function bolt(c: Ctx, r: number) {
  c.beginPath();
  c.moveTo(r * 0.15, -r);
  c.lineTo(-r * 0.45, r * 0.1);
  c.lineTo(-r * 0.02, r * 0.1);
  c.lineTo(-r * 0.2, r);
  c.lineTo(r * 0.45, -r * 0.15);
  c.lineTo(r * 0.02, -r * 0.15);
  c.closePath();
}

function flash(c: Ctx, r: number) {
  base(c, r, '#C21A1A');
  circle(c, 0, 0, r * 0.62);
  c.fillStyle = '#F7F1E0';
  c.fill();
  bolt(c, r * 0.58);
  c.fillStyle = '#F1C21B';
  c.fill();
  c.lineWidth = r * 0.04;
  c.strokeStyle = '#7A4C00';
  c.stroke();
}

function thor(c: Ctx, r: number) {
  base(c, r, '#2D3B55', '#B9C3D6');
  // martillo
  c.fillStyle = '#B9C3D6';
  c.fillRect(-r * 0.48, -r * 0.48, r * 0.96, r * 0.42);
  c.fillStyle = '#7B5A3A';
  c.fillRect(-r * 0.09, -r * 0.06, r * 0.18, r * 0.62);
  c.fillStyle = '#B9C3D6';
  c.fillRect(-r * 0.12, r * 0.52, r * 0.24, r * 0.1);
}

function strange(c: Ctx, r: number) {
  base(c, r, '#20406E', '#E2A23B');
  // sello: dos cuadrados girados y un ojo
  c.strokeStyle = '#E2A23B';
  c.lineWidth = r * 0.07;
  for (const a of [0, Math.PI / 4]) {
    c.save();
    c.rotate(a);
    c.strokeRect(-r * 0.4, -r * 0.4, r * 0.8, r * 0.8);
    c.restore();
  }
  c.beginPath();
  c.ellipse(0, 0, r * 0.26, r * 0.14, 0, 0, Math.PI * 2);
  c.fillStyle = '#7CF0A0';
  c.fill();
}

/** Sin imagen cargada: un disco con la inicial (nunca se rediseña el personaje). */
function placeholder(fill: string, letter: string) {
  return (c: Ctx, r: number) => {
    base(c, r, fill);
    c.fillStyle = '#fff';
    c.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(letter, 0, r * 0.06);
  };
}

const DRAW: Record<HeroId, (c: Ctx, r: number) => void> = {
  spider, batman, hulk, superman, hawkeye, widow, cap, panther, ironman, flash, thor, strange,
  homer: placeholder('#E8C520', 'H'),
  cj: placeholder('#2E7D32', 'CJ'),
  baldi: placeholder('#3A7BD5', 'B'),
  ibai: placeholder('#7A4FB3', 'I'),
  verity: placeholder('#C2185B', 'V'),
  thanos: placeholder('#6A3FA0', 'T'),
  bendy: placeholder('#1a1a1a', 'B'),
  jeff: placeholder('#2F7FC1', 'J'),
  goku: placeholder('#E8741E', 'G'),
};
const DRAW_SUPER_GOKU = placeholder('#E2B23B', 'G');

// ---- retratos con las imágenes del usuario (recortes circulares en public/heroes)
type PortraitKey = HeroId | 'verity-angry' | 'goku-super';
const PORTRAIT_FILE: Partial<Record<PortraitKey, string>> = {
  homer: 'homer.png', cj: 'cj.png', baldi: 'baldi.png', ibai: 'ibai.png', verity: 'verity.png', 'verity-angry': 'verity-angry.png', thanos: 'thanos.png',
  bendy: 'bendy.png', jeff: 'jeff.png', goku: 'goku.png', 'goku-super': 'goku-super.png',
};
const portraits = new Map<PortraitKey, HTMLImageElement>();
const loadedListeners = new Set<() => void>();

function portrait(key: PortraitKey): HTMLImageElement | null {
  const file = PORTRAIT_FILE[key];
  if (!file || typeof Image === 'undefined') return null;
  let img = portraits.get(key);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      for (const f of loadedListeners) f();
    };
    img.src = `${import.meta.env.BASE_URL}heroes/${file}`;
    portraits.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Para redibujar las insignias cuando termina de cargar un retrato. */
export function onPortraitLoad(f: () => void): () => void {
  loadedListeners.add(f);
  return () => loadedListeners.delete(f);
}

/** Carga anticipada (menú y selección) para que la partida no empiece con iniciales. */
export function preloadPortraits(): void {
  for (const k of Object.keys(PORTRAIT_FILE) as PortraitKey[]) portrait(k);
}

/**
 * Dibuja el héroe dentro de un círculo de radio r (el anillo de equipo queda
 * fuera). Con imagen: recorte circular sin deformar; si no cargó, el dibujo
 * propio o la inicial. `angry`: retrato enojado de Verity durante su Q.
 * `superForm`: Goku Super Saiyajin (variante propia, nunca la normal).
 */
export function drawHero(c: Ctx, hero: HeroId, r: number, opts: { angry?: boolean; superForm?: boolean } = {}): void {
  c.save();
  const gokuSuper = hero === 'goku' && !!opts.superForm;
  const img = gokuSuper ? portrait('goku-super') : (hero === 'verity' && opts.angry ? portrait('verity-angry') : null) ?? portrait(hero);
  if (img) {
    circle(c, 0, 0, r);
    c.clip();
    c.drawImage(img, -r, -r, r * 2, r * 2);
  } else (gokuSuper ? DRAW_SUPER_GOKU : DRAW[hero])(c, r);
  c.restore();
}

/** Icono de una gema de Thanos (cuadrado de lado s). */
export function drawGemIcon(c: Ctx, color: string, s: number): void {
  c.save();
  c.translate(s / 2, s / 2);
  const r = s * 0.34;
  c.beginPath();
  c.moveTo(0, -r);
  c.lineTo(r * 0.8, -r * 0.2);
  c.lineTo(r * 0.5, r);
  c.lineTo(-r * 0.5, r);
  c.lineTo(-r * 0.8, -r * 0.2);
  c.closePath();
  c.fillStyle = color;
  c.fill();
  c.lineWidth = s * 0.05;
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.stroke();
  c.restore();
}

/** Iconos de poderes para la barra Q/E (dibujados en un cuadrado de lado s). */
export function drawPowerIcon(c: Ctx, hero: HeroId, slot: 'q' | 'e', s: number): void {
  c.save();
  c.translate(s / 2, s / 2);
  const r = s * 0.38;
  c.strokeStyle = '#fff';
  c.fillStyle = '#fff';
  c.lineWidth = s * 0.07;
  c.lineCap = 'round';
  const key = `${hero}-${slot}`;
  switch (key) {
    case 'spider-q': // telaraña
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        c.beginPath();
        c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        c.lineTo(-Math.cos(a) * r, -Math.sin(a) * r);
        c.stroke();
      }
      circle(c, 0, 0, r * 0.55);
      c.stroke();
      break;
    case 'spider-e': // impulso
    case 'superman-e': // velocidad
      for (const o of [-0.4, 0, 0.4]) {
        c.beginPath();
        c.moveTo(-r, o * r);
        c.lineTo(r * 0.3, o * r);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(r * 0.3, -r * 0.6);
      c.lineTo(r, 0);
      c.lineTo(r * 0.3, r * 0.6);
      c.stroke();
      break;
    case 'batman-q': // batarang
      c.beginPath();
      c.moveTo(-r, -r * 0.2);
      c.quadraticCurveTo(-r * 0.4, r * 0.1, 0, r * 0.45);
      c.quadraticCurveTo(r * 0.4, r * 0.1, r, -r * 0.2);
      c.quadraticCurveTo(r * 0.3, 0, 0, -r * 0.3);
      c.quadraticCurveTo(-r * 0.3, 0, -r, -r * 0.2);
      c.fill();
      break;
    case 'batman-e': // gancho: cuerda con un garfio
      c.setLineDash([s * 0.06, s * 0.05]);
      c.beginPath();
      c.moveTo(-r, r);
      c.lineTo(r * 0.15, -r * 0.15);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(-r * 0.05, r * 0.05);
      c.lineTo(r * 0.55, -r * 0.55);
      c.moveTo(r * 0.55, -r * 0.55);
      c.quadraticCurveTo(r * 0.95, -r * 0.2, r * 0.75, r * 0.1);
      c.moveTo(r * 0.55, -r * 0.55);
      c.quadraticCurveTo(r * 0.2, -r * 0.95, -r * 0.1, -r * 0.75);
      c.stroke();
      break;
    case 'hulk-q': // golpe al suelo
      circle(c, 0, 0, r * 0.3);
      c.fill();
      circle(c, 0, 0, r * 0.65);
      c.stroke();
      circle(c, 0, 0, r);
      c.stroke();
      break;
    case 'hulk-e': // furia (puño)
      c.fillRect(-r * 0.6, -r * 0.5, r * 1.2, r);
      c.fillRect(-r * 0.6, r * 0.5, r * 0.7, r * 0.45);
      break;
    case 'superman-q': // visión láser: dos haces desde los ojos
      circle(c, -r * 0.55, -r * 0.1, r * 0.22);
      c.fill();
      c.save();
      c.strokeStyle = '#FF5A4A';
      for (const o of [-0.25, 0.15]) {
        c.beginPath();
        c.moveTo(-r * 0.3, o * r);
        c.lineTo(r, (o - 0.35) * r);
        c.stroke();
      }
      c.restore();
      break;
    case 'hawkeye-q': // flecha explosiva
      c.beginPath();
      c.moveTo(-r, r * 0.6);
      c.lineTo(r * 0.2, -r * 0.2);
      c.stroke();
      c.save();
      c.fillStyle = '#FF9A3C';
      circle(c, r * 0.45, -r * 0.45, r * 0.42);
      c.fill();
      c.restore();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        c.beginPath();
        c.moveTo(r * 0.45 + Math.cos(a) * r * 0.5, -r * 0.45 + Math.sin(a) * r * 0.5);
        c.lineTo(r * 0.45 + Math.cos(a) * r * 0.75, -r * 0.45 + Math.sin(a) * r * 0.75);
        c.stroke();
      }
      break;
    case 'ironman-q': // repulsor: pulso con anillo
      circle(c, 0, 0, r * 0.35);
      c.fill();
      circle(c, 0, 0, r * 0.7);
      c.stroke();
      c.save();
      c.strokeStyle = '#3FD8FF';
      circle(c, 0, 0, r);
      c.stroke();
      c.restore();
      break;
    case 'hawkeye-e': // paso lateral
    case 'panther-q': // salto
      c.setLineDash([s * 0.05, s * 0.05]);
      c.beginPath();
      c.moveTo(-r, r * 0.4);
      c.quadraticCurveTo(0, key === 'panther-q' ? -r : r * 0.4, r * 0.55, r * 0.1);
      c.stroke();
      c.setLineDash([]);
      circle(c, r * 0.65, r * 0.1, r * 0.3);
      c.fill();
      break;
    case 'widow-q': // descarga
    case 'thor-e': // rayo paralizante
      bolt(c, r);
      c.fill();
      if (key === 'thor-e') {
        circle(c, 0, 0, r);
        c.setLineDash([s * 0.05, s * 0.05]);
        c.stroke();
        c.setLineDash([]);
      }
      break;
    case 'widow-e': // dash evasivo: silueta con contornos residuales
      circle(c, r * 0.45, 0, r * 0.45);
      c.fill();
      c.save();
      c.strokeStyle = '#E03844';
      c.lineWidth = s * 0.05;
      for (const [x, k] of [[-0.15, 0.4], [-0.65, 0.32]] as const) {
        circle(c, x * r, 0, k * r);
        c.stroke();
      }
      c.restore();
      break;
    case 'cap-q': // escudo encadenado: escudo con rebotes
      circle(c, -r * 0.3, r * 0.2, r * 0.6);
      c.stroke();
      circle(c, -r * 0.3, r * 0.2, r * 0.25);
      c.fill();
      c.setLineDash([s * 0.05, s * 0.05]);
      c.beginPath();
      c.moveTo(r * 0.3, -r * 0.1);
      c.lineTo(r * 0.75, -r * 0.75);
      c.lineTo(r, -r * 0.1);
      c.stroke();
      c.setLineDash([]);
      break;
    case 'cap-e': // protección de la pelota: burbuja con pelota y estrella
      circle(c, 0, 0, r * 0.5);
      c.fill();
      c.save();
      c.strokeStyle = '#7FB2FF';
      circle(c, 0, 0, r * 0.85);
      c.stroke();
      c.restore();
      break;
    case 'panther-e': // pulso
      circle(c, 0, 0, r * 0.25);
      c.fill();
      c.setLineDash([s * 0.05, s * 0.04]);
      circle(c, 0, 0, r * 0.62);
      c.stroke();
      circle(c, 0, 0, r);
      c.stroke();
      c.setLineDash([]);
      break;
    case 'ironman-e': // misil sobre una retícula
      c.save();
      c.strokeStyle = '#FF5A4A';
      circle(c, 0, r * 0.35, r * 0.55);
      c.stroke();
      c.restore();
      c.fillRect(-r * 0.15, -r, r * 0.3, r * 0.95);
      c.beginPath();
      c.moveTo(-r * 0.15, -r * 0.05);
      c.lineTo(0, r * 0.25);
      c.lineTo(r * 0.15, -r * 0.05);
      c.closePath();
      c.fill();
      break;
    case 'flash-q': // velocidad extrema
      for (const o of [-0.45, 0, 0.45]) {
        c.beginPath();
        c.moveTo(-r, o * r);
        c.lineTo(r * 0.1, o * r);
        c.stroke();
      }
      bolt(c, r * 0.6);
      c.translate(r * 0.45, 0);
      c.fill();
      break;
    case 'flash-e': // estela acelerada (naranja)
      c.save();
      c.fillStyle = '#FF9A3C';
      for (const [x, k] of [[-0.6, 0.18], [-0.1, 0.26], [0.45, 0.34]] as const) {
        circle(c, x * r, 0, k * r);
        c.fill();
      }
      c.restore();
      break;
    case 'thor-q': // Mjolnir electrificado
      c.fillRect(-r * 0.75, -r * 0.75, r * 1.2, r * 0.6);
      c.save();
      c.rotate(-Math.PI / 4);
      c.fillRect(-r * 0.1, -r * 0.1, r * 0.2, r * 1.2);
      c.restore();
      c.save();
      c.strokeStyle = '#8CC8FF';
      c.lineWidth = s * 0.045;
      c.beginPath();
      c.moveTo(r * 0.55, -r * 0.9);
      c.lineTo(r * 0.85, -r * 0.55);
      c.lineTo(r * 0.6, -r * 0.4);
      c.lineTo(r * 0.95, -r * 0.05);
      c.stroke();
      c.restore();
      break;
    case 'strange-q': // rebobinar: flecha circular hacia atrás
      c.beginPath();
      c.arc(0, 0, r * 0.75, -Math.PI * 0.2, Math.PI * 1.35);
      c.stroke();
      c.beginPath();
      c.moveTo(r * 0.55, -r * 0.85);
      c.lineTo(r * 0.75, -r * 0.3);
      c.lineTo(r * 0.2, -r * 0.4);
      c.closePath();
      c.fill();
      circle(c, 0, 0, r * 0.18);
      c.fill();
      break;
    case 'strange-e': // portal al arco: dos portales
      for (const x of [-0.5, 0.5]) {
        c.beginPath();
        c.ellipse(x * r, 0, r * 0.3, r * 0.7, 0, 0, Math.PI * 2);
        c.stroke();
      }
      break;
    case 'homer-q': // rosquilla glaseada
      c.save();
      c.fillStyle = '#E9A86B';
      circle(c, 0, 0, r);
      c.fill();
      c.fillStyle = '#F06BB0';
      circle(c, 0, 0, r * 0.82);
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      circle(c, 0, 0, r * 0.32);
      c.fill();
      c.restore();
      break;
    case 'homer-e': // charco de cerveza
      c.save();
      c.fillStyle = '#E3A72F';
      c.beginPath();
      c.ellipse(0, r * 0.3, r, r * 0.5, 0, 0, Math.PI * 2);
      c.fill();
      for (const [x, k] of [[-0.4, 0.2], [0.05, 0.26], [0.45, 0.18]] as const) {
        c.fillStyle = '#fff';
        circle(c, x * r, -r * 0.1, k * r);
        c.fill();
      }
      c.restore();
      break;
    case 'cj-q': // cargador de tres balas
      for (const x of [-0.55, 0, 0.55]) {
        c.fillRect((x - 0.14) * r, -r * 0.35, r * 0.28, r);
        c.beginPath();
        c.arc(x * r, -r * 0.35, r * 0.14, Math.PI, 0);
        c.fill();
      }
      break;
    case 'cj-e': // jetpack: dos propulsores con llama
      c.fillRect(-r * 0.6, -r * 0.8, r * 0.45, r * 1.1);
      c.fillRect(r * 0.15, -r * 0.8, r * 0.45, r * 1.1);
      c.save();
      c.fillStyle = '#FF9A3C';
      for (const x of [-0.375, 0.375]) {
        c.beginPath();
        c.moveTo((x - 0.2) * r, r * 0.35);
        c.lineTo(x * r, r);
        c.lineTo((x + 0.2) * r, r * 0.35);
        c.fill();
      }
      c.restore();
      break;
    case 'baldi-q': // regla
      c.save();
      c.rotate(-Math.PI / 5);
      c.fillStyle = '#E9D27A';
      c.fillRect(-r, -r * 0.22, r * 2, r * 0.44);
      c.strokeStyle = '#5a4a1a';
      c.lineWidth = s * 0.03;
      for (let i = -4; i <= 4; i++) {
        c.beginPath();
        c.moveTo(i * r * 0.22, -r * 0.22);
        c.lineTo(i * r * 0.22, i % 2 ? -r * 0.05 : r * 0.05);
        c.stroke();
      }
      c.restore();
      break;
    case 'baldi-e': // quiz: signos
      c.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('+−', 0, -r * 0.2);
      c.fillText('?', 0, r * 0.65);
      break;
    case 'ibai-q': // guante de boxeo
      c.save();
      c.fillStyle = '#E53935';
      c.beginPath();
      c.ellipse(r * 0.15, -r * 0.1, r * 0.75, r * 0.6, 0, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-r * 0.75, -r * 0.05, r * 0.5, r * 0.75);
      c.restore();
      c.fillRect(-r, -r * 0.05, r * 0.25, r * 0.75);
      break;
    case 'ibai-e': // cuerpo gigante: disco que crece
      circle(c, 0, 0, r * 0.35);
      c.fill();
      c.setLineDash([s * 0.05, s * 0.04]);
      circle(c, 0, 0, r);
      c.stroke();
      c.setLineDash([]);
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        c.beginPath();
        c.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        c.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        c.stroke();
      }
      break;
    case 'verity-q': // enfado: cejas fruncidas
      c.save();
      c.strokeStyle = '#FF5A4A';
      c.beginPath();
      c.moveTo(-r * 0.8, -r * 0.5);
      c.lineTo(-r * 0.15, -r * 0.15);
      c.moveTo(r * 0.8, -r * 0.5);
      c.lineTo(r * 0.15, -r * 0.15);
      c.stroke();
      c.restore();
      c.beginPath();
      c.arc(0, r * 0.65, r * 0.4, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
      break;
    case 'verity-e': // TNT con mecha
      c.save();
      c.fillStyle = '#D32F2F';
      c.fillRect(-r * 0.7, -r * 0.45, r * 1.4, r * 1.2);
      c.fillStyle = '#fff';
      c.font = `bold ${Math.round(r * 0.5)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('TNT', 0, r * 0.15);
      c.restore();
      c.beginPath();
      c.moveTo(0, -r * 0.45);
      c.quadraticCurveTo(r * 0.3, -r * 0.9, r * 0.6, -r * 0.8);
      c.stroke();
      break;
    case 'thanos-q': // guantelete: cinco gemas
    case 'thanos-e':
      ['#3fd16b', '#f2d03b', '#e8423f', '#3f7cf2', '#a64ff2'].forEach((col, i) => {
        c.save();
        c.fillStyle = col;
        circle(c, (i - 2) * r * 0.42, i === 2 ? -r * 0.3 : 0, r * 0.2);
        c.fill();
        c.restore();
      });
      if (key === 'thanos-e') {
        c.beginPath();
        c.moveTo(-r * 0.6, r * 0.6);
        c.lineTo(r * 0.6, r * 0.6);
        c.lineTo(r * 0.35, r * 0.35);
        c.stroke();
      }
      break;
    case 'bendy-q': // mancha de tinta: salpicadura
      c.save();
      c.fillStyle = '#111';
      c.strokeStyle = '#fff';
      c.lineWidth = s * 0.03;
      inkBlot(c, 0, 0, r * 0.8, 7);
      c.fill();
      c.stroke();
      c.restore();
      break;
    case 'bendy-e': // forma de tinta: charco con rastro
      c.save();
      c.fillStyle = '#111';
      c.strokeStyle = '#fff';
      c.lineWidth = s * 0.03;
      c.beginPath();
      c.ellipse(r * 0.25, r * 0.35, r * 0.65, r * 0.35, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      for (const [x, y, k] of [[-r * 0.55, -r * 0.1, 0.18], [-r * 0.8, -r * 0.45, 0.13], [-r * 0.95, -r * 0.8, 0.09]]) {
        circle(c, x, y, r * k);
        c.fill();
        c.stroke();
      }
      c.restore();
      break;
    case 'jeff-q': // chorro de agua
      c.save();
      c.strokeStyle = '#6EC6FF';
      c.lineWidth = s * 0.1;
      c.beginPath();
      c.moveTo(-r, 0);
      c.lineTo(r * 0.5, 0);
      c.stroke();
      c.lineWidth = s * 0.05;
      for (const k of [-1, 1]) {
        c.beginPath();
        c.moveTo(r * 0.3, 0);
        c.quadraticCurveTo(r * 0.7, k * r * 0.3, r, k * r * 0.5);
        c.stroke();
      }
      c.restore();
      break;
    case 'jeff-e': // tragar: mandíbula abierta
      c.save();
      c.fillStyle = '#2F7FC1';
      c.beginPath();
      c.arc(0, 0, r * 0.9, Math.PI * 0.2, Math.PI * 1.8);
      c.lineTo(0, 0);
      c.closePath();
      c.fill();
      c.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 0.2 + i * 0.12;
        c.beginPath();
        c.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
        c.lineTo(Math.cos(a + 0.06) * r * 0.55, Math.sin(a + 0.06) * r * 0.55);
        c.lineTo(Math.cos(a + 0.12) * r * 0.9, Math.sin(a + 0.12) * r * 0.9);
        c.fill();
        c.beginPath();
        c.moveTo(Math.cos(-a) * r * 0.9, Math.sin(-a) * r * 0.9);
        c.lineTo(Math.cos(-a - 0.06) * r * 0.55, Math.sin(-a - 0.06) * r * 0.55);
        c.lineTo(Math.cos(-a - 0.12) * r * 0.9, Math.sin(-a - 0.12) * r * 0.9);
        c.fill();
      }
      c.restore();
      break;
    case 'goku-q': { // Kamehameha: esfera azul con rayo
      c.save();
      const g = c.createRadialGradient(-r * 0.4, 0, 0, -r * 0.4, 0, r * 0.55);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#8FD8FF');
      g.addColorStop(1, 'rgba(60,150,255,0)');
      c.fillStyle = g;
      circle(c, -r * 0.4, 0, r * 0.55);
      c.fill();
      c.fillStyle = 'rgba(120,200,255,0.9)';
      c.fillRect(-r * 0.4, -r * 0.2, r * 1.4, r * 0.4);
      c.restore();
      break;
    }
    case 'goku-e': // transmisión instantánea: dos dedos y destello
      c.save();
      c.strokeStyle = '#FFD54F';
      c.setLineDash([s * 0.05, s * 0.05]);
      circle(c, 0, 0, r * 0.85);
      c.stroke();
      c.restore();
      c.lineWidth = s * 0.09;
      c.beginPath();
      c.moveTo(-r * 0.15, r * 0.55);
      c.lineTo(-r * 0.15, -r * 0.55);
      c.moveTo(r * 0.15, r * 0.55);
      c.lineTo(r * 0.15, -r * 0.55);
      c.stroke();
      break;
  }
  c.restore();
}
