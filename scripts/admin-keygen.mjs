// Genera el par de claves de moderación (ECDSA P-256).
// Uso: npm run admin:keygen
// - La clave PÚBLICA se pega en shared/admin.ts (ADMIN_PUBLIC_KEY) y se publica:
//   los anfitriones P2P la usan para verificar firmas.
// - La clave PRIVADA va SÓLO en el servidor (MODERATOR_SIGNING_KEY en .env).
//   El servidor firma desafíos para cuentas con rol "moderator"; nunca se
//   guarda en el navegador ni se sube al repositorio.
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await subtle.exportKey('jwk', pair.publicKey);
const priv = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
console.log('Clave pública (shared/admin.ts):');
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }));
console.log('\nClave privada (MODERATOR_SIGNING_KEY del servidor):');
console.log(priv);
