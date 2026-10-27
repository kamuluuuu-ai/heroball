// Procedimiento de servidor para asignar roles. No existe ninguna ruta HTTP
// que haga esto: sólo quien tiene acceso a la base puede crear el primer
// administrador. La cuenta debe existir (registrada desde el juego).
//
//   npm run admin:role -- --email vos@ejemplo.com --role economy_admin
//   npm run admin:role -- --email vos@ejemplo.com --role moderator
//   npm run admin:role -- --email vos@ejemplo.com --role moderator --remove
import { userInfo } from 'node:os';
import { createPool } from '../server/db';
import { setRole, type Role } from '../server/economy';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = opt('email');
const role = opt('role') as Role | undefined;
const remove = args.includes('--remove');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
if (!email || (role !== 'economy_admin' && role !== 'moderator')) {
  console.error('Uso: npm run admin:role -- --email <correo> --role economy_admin|moderator [--remove]');
  process.exit(1);
}
const db = createPool(process.env.DATABASE_URL);
try {
  const u = await setRole(db, email, role, !remove, `cli:${userInfo().username}`);
  console.log(`${remove ? 'Quitado' : 'Asignado'} el rol ${role} a ${u.name} (${u.userId}).`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
