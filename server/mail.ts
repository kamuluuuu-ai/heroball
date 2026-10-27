// Envío del enlace de recuperación de contraseña. Con SMTP_URL usa
// nodemailer; sin él (desarrollo local) lo escribe en la consola del servidor.
import nodemailer from 'nodemailer';

export function createMailer(smtpUrl: string | undefined, from: string): (to: string, url: string) => Promise<void> {
  if (!smtpUrl) {
    return async (to, url) => {
      console.log(`[recuperación] enlace para ${to}: ${url}`);
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return async (to, url) => {
    await transport.sendMail({
      from,
      to,
      subject: 'HeroBall: recuperar contraseña',
      text: `Para elegir una contraseña nueva abrí este enlace (vence en 30 minutos):\n\n${url}\n\nSi no lo pediste, ignorá este correo.`,
    });
  };
}
