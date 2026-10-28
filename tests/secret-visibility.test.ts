import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HERO_CATALOG, visibleHeroes, visibleHeroSelection, PLAYER } from '../shared/config';
import { RARITIES, heroesOfRarity } from '../shared/economy';
import { HeroPicker, RarityTag } from '../client/src/ui/common';
import { LocalSession } from '../client/src/game/sessions';

describe('Secreto: propiedad y presentación', () => {
  it('es una rareza propia y nunca participa en los cofres', () => {
    expect(HERO_CATALOG.thanos.rarity).toBe('secret');
    for (const r of RARITIES) expect(heroesOfRarity(r)).not.toContain('thanos');
    expect(renderToStaticMarkup(createElement(RarityTag, {rarity: 'secret'}))).toContain('r-secret');
  });
  it('oculta el personaje y sus poderes aun con una selección guardada antigua', () => {
    expect(visibleHeroes()).not.toContain('thanos');
    expect(visibleHeroSelection('thanos')).toBe('spider');
    const html = renderToStaticMarkup(createElement(HeroPicker, {value: 'thanos', onChange: () => {}}));
    expect(html).not.toContain('Thanos');
    expect(html).not.toContain('Gema');
    expect(html).toContain('Telaraña');
  });
  it('muestra la opción negra y las gemas solo al dueño', () => {
    expect(visibleHeroes(['thanos'])).toContain('thanos');
    const html = renderToStaticMarkup(createElement(HeroPicker, {value: 'thanos', secrets: ['thanos'], onChange: () => {}}));
    expect(html).toContain('Thanos');
    expect(html).toContain('r-secret');
    expect(html).toContain('gema');
  });
  it('limpia tamaño, masa y estados al cambiar de héroe en entrenamiento', () => {
    const s = new LocalSession({kind: 'training', mode: 'heroes', hero: 'ibai', teamSize: 1, botSkill: .5, timeLimitMin: 0, scoreLimit: 0});
    const old = s.state.players[0];
    old.giant = 100; old.d.r = 30; old.d.invMass = .1; old.stun = 20;
    s.setHero('cj');
    expect(s.state.players[0]).toMatchObject({hero: 'cj', giant: 0, stun: 0, ammo: 3});
    expect(s.state.players[0].d.r).toBe(PLAYER.radius);
    expect(s.state.players[0].d.invMass).toBe(PLAYER.invMass);
    s.setHero('thanos');
    expect(s.state.players[0].hero).toBe('cj');
  });
});

it('revocar la propiedad retira el héroe de la sesión local activa y conserva la pausa', () => {
  const s = new LocalSession({kind: 'training', mode: 'heroes', hero: 'thanos', secrets: ['thanos'], teamSize: 1, botSkill: .5, timeLimitMin: 0, scoreLimit: 0});
  s.state.paused = true;
  s.setOwnedSecrets([]);
  expect(s.state.players[0].hero).toBe('spider');
  expect(s.state.paused).toBe(true);
  s.setHero('thanos');
  expect(s.state.players[0].hero).toBe('spider');
});
