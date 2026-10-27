// Simulación de la economía (configuración versionada de shared/economy.ts).
// Mide el ritmo de desbloqueo de un jugador que sólo juega partidas oficiales.
//   npx tsx scripts/simulate-economy.ts [jugadores] [días]
import { randomInt } from 'node:crypto';
import { HERO_CATALOG, HERO_IDS, STARTER_IDS, type HeroId } from '../shared/config';
import { ECONOMY, ODDS_SCALE, resolveChest, type PityState } from '../shared/economy';

const players = Number(process.argv[2] ?? 2000);
const days = Number(process.argv[3] ?? 120);

interface Profile {
  name: string;
  matchesPerDay: number;
  winRate: number;
}
const PROFILES: Profile[] = [
  { name: 'casual (3 partidas/día)', matchesPerDay: 3, winRate: 0.5 },
  { name: 'regular (6 partidas/día)', matchesPerDay: 6, winRate: 0.5 },
  { name: 'intenso (12 partidas/día)', matchesPerDay: 12, winRate: 0.5 },
];

const unlockables = HERO_IDS.filter((h) => !STARTER_IDS.includes(h));

function simulate(p: Profile) {
  const firstAt: number[] = [];
  const allAt: number[] = [];
  const ownedAt = new Map<number, number[]>();
  let legendaries = 0;
  let opened = 0;
  for (let i = 0; i < players; i++) {
    let coins = ECONOMY.welcome.coins;
    let fragments = 0;
    const chests = { standard: ECONOMY.welcome.standard, elite: ECONOMY.welcome.elite };
    let pity: PityState = { sinceEpic: 0, sinceLegendary: 0 };
    const owned = new Set<HeroId>(STARTER_IDS);
    let first = -1;
    let all = -1;
    for (let d = 1; d <= days; d++) {
      let matchCoins = 0;
      for (let m = 0; m < p.matchesPerDay; m++) {
        const c = Math.min(ECONOMY.match.completeCoins + (Math.random() < p.winRate ? ECONOMY.match.winBonus : 0), ECONOMY.match.dailyCap - matchCoins);
        matchCoins += c;
      }
      coins += matchCoins;
      if (p.matchesPerDay >= ECONOMY.objectives.daily.matches) coins += ECONOMY.objectives.daily.coins;
      if (d % 7 === 0 && p.matchesPerDay * 7 >= ECONOMY.objectives.weekly.matches) chests.elite += ECONOMY.objectives.weekly.elite;
      // estrategia: comprar estándar con todo y abrir todo; desbloquear con Fragmentos el más barato posible
      while (coins >= ECONOMY.chests.standard.price) {
        coins -= ECONOMY.chests.standard.price;
        chests.standard++;
      }
      for (const type of ['elite', 'standard'] as const) {
        while (chests[type] > 0) {
          chests[type]--;
          const out = resolveChest(type, pity, owned, randomInt(ODDS_SCALE), (n) => randomInt(n));
          pity = out.pityAfter;
          opened++;
          if (out.rarity === 'legendary') legendaries++;
          if (out.duplicate) fragments += out.fragments;
          else owned.add(out.hero);
        }
      }
      for (const h of unlockables.filter((x) => !owned.has(x)).sort((a, b) => ECONOMY.unlockCost[HERO_CATALOG[a].rarity] - ECONOMY.unlockCost[HERO_CATALOG[b].rarity])) {
        const cost = ECONOMY.unlockCost[HERO_CATALOG[h].rarity];
        if (fragments >= cost) {
          fragments -= cost;
          owned.add(h);
        }
      }
      const n = owned.size - STARTER_IDS.length;
      if (first < 0 && n > 0) first = d;
      if (all < 0 && n === unlockables.length) all = d;
      if (d % 30 === 0) {
        const arr = ownedAt.get(d) ?? [];
        arr.push(n);
        ownedAt.set(d, arr);
      }
    }
    firstAt.push(first < 0 ? Infinity : first);
    allAt.push(all < 0 ? Infinity : all);
  }
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
  return { firstAt: med(firstAt), allMedian: med(allAt), all90: pct(allAt, 0.9), ownedAt, legendaryRate: legendaries / opened };
}

console.log(`Economía v${ECONOMY.version} · ${players} jugadores simulados · ${days} días\n`);
for (const p of PROFILES) {
  const r = simulate(p);
  const fmt = (v: number) => (Number.isFinite(v) ? `${v} días` : `más de ${days} días`);
  console.log(`${p.name}`);
  console.log(`  primer héroe nuevo (mediana): ${fmt(r.firstAt)}`);
  console.log(`  los 8 héroes nuevos: mediana ${fmt(r.allMedian)}, 90 % de jugadores ${fmt(r.all90)}`);
  for (const [d, arr] of r.ownedAt) console.log(`  día ${d}: ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)} de 8 en promedio`);
  console.log(`  tasa legendaria efectiva por cofre (con garantías): ${(r.legendaryRate * 100).toFixed(2)} %\n`);
}
