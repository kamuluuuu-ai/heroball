// Cuentas recuperables con Better Auth (correo y contraseña). El frontend de
// GitHub Pages vive en otro origen, así que la sesión viaja como token
// "Bearer" (plugin bearer) en vez de cookie de terceros.
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import type { Db } from './db';

export interface AuthConfig {
  db: Db;
  /** URL pública del backend (https://api.ejemplo.com). */
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  /** Envío del enlace de recuperación (correo real o consola en local). */
  sendResetLink: (to: string, url: string) => Promise<void>;
  /** Límite de intentos por IP (activo salvo en pruebas automatizadas). */
  rateLimit?: boolean;
}

export function createAuth(c: AuthConfig) {
  return betterAuth({
    database: c.db,
    baseURL: c.baseURL,
    basePath: '/api/auth',
    secret: c.secret,
    trustedOrigins: c.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // la contraseña nueva cierra las demás sesiones
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 30,
      sendResetPassword: async ({ user, url }) => {
        await c.sendResetLink(user.email, url);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: c.rateLimit ?? true, window: 60, max: 60 },
    plugins: [bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Usuario de la sesión a partir de un token Bearer (o null si no es válida). */
export async function sessionUser(auth: Auth, headers: Headers): Promise<{ id: string; name: string; email: string } | null> {
  try {
    const s = await auth.api.getSession({ headers });
    return s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null;
  } catch {
    return null;
  }
}

export function bearerHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}
