// Administrador global con clave firmada (ECDSA P-256, WebCrypto).
//
// Sin servidor central no hay contraseña que se pueda esconder: todo el código
// es público. En cambio, el código sólo contiene la clave PÚBLICA. Al conectarse,
// el anfitrión (servidor Node o navegador anfitrión) manda un desafío aleatorio;
// el cliente lo firma con la clave PRIVADA, que sólo existe en el navegador del
// administrador, y el anfitrión verifica la firma. Sin la clave privada no se
// puede producir una firma válida. Para cambiar de clave: scripts/admin-keygen.mjs.

export const ADMIN_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'QlwcSmaNxyQlgMCPUlfoGhsA1Mpw-cRNR2btt_9AWkc',
  y: 'TtOSvfDeohVCRyxWy2eft0bkg0p0Cd1sZw-tuCyqfyM',
};

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

function subtle(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null;
}

function toB64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Desafío aleatorio por conexión. */
export function makeNonce(): string {
  const b = new Uint8Array(18);
  globalThis.crypto.getRandomValues(b);
  return toB64(b.buffer);
}

/** Texto firmado: liga la firma a este desafío y a este id de conexión (no se puede reutilizar). */
function challenge(nonce: string, clientId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`heroball-admin|${nonce}|${clientId}`) as Uint8Array<ArrayBuffer>;
}

/**
 * Texto firmado para los personajes secretos de una cuenta: otro prefijo, así
 * esta firma nunca vale como permiso de administrador (ni al revés).
 */
function heroesChallenge(nonce: string, clientId: string, heroes: readonly string[]): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`heroball-heroes|${nonce}|${clientId}|${heroes.join(',')}`) as Uint8Array<ArrayBuffer>;
}

async function sign(privateKeyB64: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const c = subtle();
  if (!c) throw new Error('Este navegador no permite firmar (requiere HTTPS).');
  const key = await c.importKey('pkcs8', fromB64(privateKeyB64), ALG, false, ['sign']);
  return toB64(await c.sign(SIGN, key, data));
}

/** Firma el desafío con la clave privada (PKCS#8 en base64). Lanza si la clave es inválida. */
export function signAdmin(privateKeyB64: string, nonce: string, clientId: string): Promise<string> {
  return sign(privateKeyB64, challenge(nonce, clientId));
}

/** El servidor firma qué personajes secretos tiene la cuenta de esta conexión (para un anfitrión P2P). */
export function signHeroes(privateKeyB64: string, nonce: string, clientId: string, heroes: readonly string[]): Promise<string> {
  return sign(privateKeyB64, heroesChallenge(nonce, clientId, heroes));
}

let pubKey: Promise<CryptoKey> | null = null;

async function verify(sig: string, data: Uint8Array<ArrayBuffer>, publicKey: JsonWebKey): Promise<boolean> {
  const c = subtle();
  if (!c) return false;
  try {
    const key = publicKey === ADMIN_PUBLIC_KEY
      ? await (pubKey ??= c.importKey('jwk', ADMIN_PUBLIC_KEY, ALG, false, ['verify']))
      : await c.importKey('jwk', publicKey, ALG, false, ['verify']);
    return await c.verify(SIGN, key, fromB64(sig), data);
  } catch {
    return false;
  }
}

/** Verifica la firma con la clave pública incluida en el código. */
export function verifyAdmin(sig: string, nonce: string, clientId: string, publicKey: JsonWebKey = ADMIN_PUBLIC_KEY): Promise<boolean> {
  return verify(sig, challenge(nonce, clientId), publicKey);
}

/** Verifica la firma de personajes secretos emitida por el servidor para este desafío y conexión. */
export function verifyHeroes(sig: string, nonce: string, clientId: string, heroes: readonly string[], publicKey: JsonWebKey = ADMIN_PUBLIC_KEY): Promise<boolean> {
  return verify(sig, heroesChallenge(nonce, clientId, heroes), publicKey);
}
