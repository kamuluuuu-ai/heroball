// Genera un par de claves de administrador (ECDSA P-256).
// Uso: node scripts/admin-keygen.mjs
// - La clave PÚBLICA se pega en shared/admin.ts (ADMIN_PUBLIC_KEY) y se publica.
// - La clave PRIVADA se guarda sólo en tu navegador (Ajustes → Administración).
//   Nunca la subas al repositorio ni la compartas.
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await subtle.exportKey('jwk', pair.publicKey);
const priv = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
console.log('Clave pública (shared/admin.ts):');
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }));
console.log('\nClave privada (pegar en Ajustes → Administración):');
console.log(priv);
