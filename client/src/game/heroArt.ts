// Emblemas de héroes dibujados con Canvas (recursos propios). Se dibujan en
// coordenadas locales de un disco de radio `r`, dentro del anillo de equipo.
import type { HeroId } from '../../../shared/config';

type Ctx = CanvasRenderingContext2D;

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

const DRAW: Record<HeroId, (c: Ctx, r: number) => void> = { spider, batman, hulk, superman };

export function drawHero(c: Ctx, hero: HeroId, r: number): void {
  c.save();
  DRAW[hero](c, r);
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
    case 'batman-e': // humo
      c.globalAlpha = 0.85;
      for (const [x, y, k] of [[-0.4, 0.2, 0.45], [0.35, 0.15, 0.5], [0, -0.25, 0.55]]) {
        circle(c, x * r, y * r, k * r);
        c.fill();
      }
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
    case 'superman-q': // disparo
      circle(c, -r * 0.35, r * 0.2, r * 0.4);
      c.fill();
      c.beginPath();
      c.moveTo(0, -r * 0.1);
      c.lineTo(r, -r * 0.8);
      c.stroke();
      c.beginPath();
      c.moveTo(r * 0.1, r * 0.25);
      c.lineTo(r, -r * 0.3);
      c.stroke();
      break;
  }
  c.restore();
}
