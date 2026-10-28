import { describe, expect, it } from 'vitest';
import { mergeBits } from '../server/room';
import { isPublicKey, makeNonce, signHeroes, signingPair, verifyHeroes } from '../shared/admin';
import { IN, IN_NUM_SHIFT, inNum } from '../shared/types';

describe('clave de firma del servidor', () => {
  it('sin MODERATOR_SIGNING_KEY genera un par válido; con la clave, deriva la misma pública', async () => {
    const a = await signingPair();
    expect(isPublicKey(a.pub)).toBe(true);
    expect((a.pub as Record<string, unknown>).d).toBeUndefined();
    const b = await signingPair(a.priv);
    expect(b.pub).toEqual(a.pub);
    const nonce = makeNonce();
    const sig = await signHeroes(a.priv, nonce, 'c1', ['thanos']);
    expect(await verifyHeroes(sig, nonce, 'c1', ['thanos'], a.pub)).toBe(true);
    expect(await verifyHeroes(sig, nonce, 'c2', ['thanos'], a.pub)).toBe(false);
    expect(await verifyHeroes(sig, nonce, 'c1', ['thanos'], (await signingPair()).pub)).toBe(false);
  });

  it('isPublicKey rechaza formas inválidas', () => {
    expect(isPublicKey(null)).toBe(false);
    expect(isPublicKey({ kty: 'RSA', crv: 'P-256', x: 'a', y: 'b' })).toBe(false);
    expect(isPublicKey({ kty: 'EC', crv: 'P-256', x: 'a'.repeat(80), y: 'b' })).toBe(false);
  });
});

describe('cola de entradas', () => {
  it('una entrada descartada no pierde patada, Q, E ni el número', () => {
    const num = (n: number) => n << IN_NUM_SHIFT;
    const m = mergeBits(IN.KICK | IN.Q | num(3), IN.UP);
    expect(m & IN.KICK).toBeTruthy();
    expect(m & IN.Q).toBeTruthy();
    expect(m & IN.UP).toBeTruthy();
    expect(inNum(m)).toBe(3);
    // el número de la siguiente gana; la dirección descartada no se arrastra
    const m2 = mergeBits(IN.LEFT | num(2), IN.E | num(5));
    expect(inNum(m2)).toBe(5);
    expect(m2 & IN.LEFT).toBe(0);
    expect(m2 & IN.E).toBeTruthy();
  });
});
