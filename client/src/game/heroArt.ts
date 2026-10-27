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

const DRAW: Record<HeroId, (c: Ctx, r: number) => void> = { spider, batman, hulk, superman, hawkeye, widow, cap, panther, ironman, flash, thor, strange };

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
  }
  c.restore();
}
