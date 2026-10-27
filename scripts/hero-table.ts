// Imprime la tabla de héroes del README a partir de shared/config.ts (fuente única).
//   npx tsx scripts/hero-table.ts [super]
import { HERO_CATALOG, PUBLIC_HERO_IDS, byRarity, RARITY_LABEL, ROLE_LABEL, SECRET_IDS, heroInfo } from '../shared/config';

const mode = process.argv[2] === 'super' ? 'super' : 'heroes';
const cd = (t: number) => `${(t / 60).toLocaleString('es', { maximumFractionDigits: 1 })} s`;
console.log('| Héroe | Rareza · rol | Q | E |');
console.log('|---|---|---|---|');
for (const id of byRarity(PUBLIC_HERO_IDS)) {
  const h = heroInfo(id, mode);
  const c = HERO_CATALOG[id];
  const tag = `${RARITY_LABEL[c.rarity]}${c.starter ? ' (inicial)' : ''} · ${ROLE_LABEL[c.role]}`;
  console.log(`| ${h.name} | ${tag} | **${h.q.name}**: ${h.q.desc} CD ${cd(h.q.cooldown)} | **${h.e.name}**: ${h.e.desc} CD ${cd(h.e.cooldown)} |`);
}
// personajes secretos: gemas (teclas 1–5) en lugar de Q/E fijas
for (const id of SECRET_IDS) {
  const h = heroInfo(id, mode);
  console.log('');
  console.log(`**${h.name}** (secreto, sólo salas casuales con personajes especiales). Q: ${h.q.desc} E: ${h.e.desc}`);
  console.log('');
  console.log('| Tecla | Gema | Efecto | CD |');
  console.log('|---|---|---|---|');
  h.gems?.forEach((g, i) => console.log(`| ${i + 1} | ${g.name} | ${g.desc} | ${cd(g.cooldown)} |`));
}
