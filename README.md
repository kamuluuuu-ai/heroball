# HeroBall

Fútbol 2D multijugador en el navegador, con vista cenital, jugadores como discos y superpoderes.
Proyecto independiente **inspirado en HaxBall**; no es HaxBall ni su sitio oficial. Código y gráficos propios.

![Inicio con cuenta](docs/capturas/01-jugar.jpg)

> **Estado de la economía.** Cuentas, monedas, cofres, colección, partidas oficiales y administración están
> terminados y probados **contra PostgreSQL real en local**. El sitio público de GitHub Pages **todavía no tiene
> backend desplegado**: ahí se juega como invitado (entrenamiento, bots y salas P2P casuales) y las pestañas
> Cofres/Perfil explican que no hay servidor de cuentas. Ver [Pendientes reales](#pendientes-reales).

## Jugar en línea

**https://kamuluuuu-ai.github.io/heroball/**

La versión web no tiene servidor central: quien toca *Crear sala* aloja la partida en su navegador
(corre la simulación autoritativa, igual que el servidor Node) y los demás entran con el enlace de invitación,
conectados por WebRTC ([PeerJS](https://peerjs.com) para la señalización). Estas salas son **siempre casuales**:
un navegador anfitrión no puede emitir recompensas. Limitaciones de este modo:

- No hay lista pública de salas: se entra por enlace o código.
- Si el anfitrión cierra o minimiza mucho tiempo la pestaña, la sala termina para todos.
- Algunas redes muy restrictivas pueden bloquear WebRTC.
- Entrenamiento y partidos contra bots funcionan sin conexión.

El sitio se publica con GitHub Actions (`.github/workflows/pages.yml`) en cada push a `main`.

## Ejecutar en local (con cuentas y economía)

Requiere Node.js 20 o superior (probado con Node 24). No hace falta Docker.

```bash
npm install
cp .env.example .env          # completar BETTER_AUTH_SECRET (32+ caracteres aleatorios)
npm run dev:db                # PostgreSQL embebido en .data/dev (puerto 54329); dejarlo abierto
npm run dev                   # otra terminal: servidor (3001) + Vite (5173)
```

Abrí <http://localhost:5173>, creá una cuenta en *Perfil* y vas a recibir la bienvenida (400 HeroCoins y
2 cofres estándar). Con Docker, en lugar de `npm run dev:db`: `docker compose up -d`.

- Migraciones: se aplican al arrancar (`MIGRATE_ON_START=1`) o con `npm run db:migrate`. Están en `migrations/`.
- Sin `DATABASE_URL` el servidor arranca igual, sólo con partidas casuales (`/api/*` responde 503 `no_economy`).
- Sin `SMTP_URL`, el enlace de recuperación de contraseña se escribe en la consola del servidor.
- Producción en un solo proceso: `npm run build && npm start` (sirve `dist/`, la API y el WebSocket en `/ws`).

### Administrador inicial

No hay usuario ni contraseña de administrador por defecto. El rol se asigna **desde el servidor**, nunca desde el
navegador:

```bash
# 1) la persona crea su cuenta normalmente desde el juego; 2) en el servidor:
npm run admin:role -- --email persona@ejemplo.com --role economy_admin
npm run admin:role -- --email persona@ejemplo.com --role moderator
npm run admin:role -- --email persona@ejemplo.com --role moderator --remove
```

- `economy_admin`: pestaña **Administración** (buscar usuarios, ver saldos e historial, entregar o corregir).
- `moderator`: permisos de anfitrión en cualquier sala (expulsar, pausar, configurar, mover) y panel de estado.

## Desplegar

### Backend (Node + PostgreSQL)

**Render + Neon (gratis, configurado en `render.yaml`):**

1. [Neon](https://neon.tech): crear un proyecto (región cercana a Oregon, p. ej. *US West*) y copiar la cadena de
   conexión **con «Connection pooling» desactivado** (`postgresql://…neon.tech/neondb?sslmode=require`).
2. [Render](https://render.com): *New → Blueprint*, elegir este repositorio. Pide `DATABASE_URL` (pegar la de Neon);
   `SMTP_URL` y `MODERATOR_SIGNING_KEY` se pueden dejar vacías. `BETTER_AUTH_SECRET` se genera solo y la URL
   pública se toma de `RENDER_EXTERNAL_URL`. Las migraciones se aplican al arrancar.
3. Comprobar `https://heroball-api.onrender.com/api/health` (o la URL que asigne Render) → `"economy":true`.
4. Conectar el frontend (abajo) y crear el administrador: registrarse en el juego y, en local, con la cadena de Neon
   en `.env` como `DATABASE_URL`: `npm run admin:role -- --email … --role economy_admin`.

En el plan gratuito, Render duerme el servicio tras 15 minutos sin uso; la primera visita después tarda cerca de un
minuto y las salas abiertas se pierden (cuentas y saldos quedan en Neon).

**Cualquier otro hosting** de Node con HTTPS (VPS, Railway, Fly.io…) y PostgreSQL gestionado. Pasos:

1. Variables de entorno (ver `.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PUBLIC_API_URL`
   (la URL HTTPS del backend), `CORS_ORIGINS=https://kamuluuuu-ai.github.io`, `SMTP_URL` y `MAIL_FROM`
   (recuperación de contraseña), opcionalmente `MODERATOR_SIGNING_KEY` y `ADMIN_MAX_COINS`/`ADMIN_MAX_CHESTS`.
2. `npm ci && npm run db:migrate && npm start` (o `MIGRATE_ON_START=1`).
3. Comprobar `GET https://tu-backend/api/health` → `{"ok":true,"economy":true}`.
4. Asignar el administrador inicial con `npm run admin:role` (arriba).

`MODERATOR_SIGNING_KEY` es la clave **privada** (PKCS#8 base64) que corresponde a la clave pública de
`shared/admin.ts`. Sólo vive en el servidor: con ella el backend firma el desafío de una sala P2P para una cuenta
con rol `moderator` y, para cualquier cuenta, la lista de sus personajes secretos (Thanos) que presenta al
anfitrión P2P. Sin esta variable Thanos funciona sin conexión y en salas del servidor, pero no en salas P2P. Si ya tenías la clave del administrador anterior, va acá; para generar otra:
`npm run admin:keygen` y publicar la pública nueva en `shared/admin.ts`.

### Frontend (GitHub Pages)

En el repositorio: *Settings → Secrets and variables → Actions → Variables*, crear `VITE_API_URL` con la URL
del backend (sin barra final) y hacer push a `main`. El workflow la pasa al build. Sin esa variable, el sitio
queda en modo invitado. El WebSocket de salas del servidor se deriva de la misma URL (`wss://…/ws`).

## Cuentas, economía y partidas oficiales

Toda la economía se decide en el servidor. El navegador sólo guarda el token de sesión y, si una operación quedó
sin respuesta, su clave de idempotencia; nunca saldos, héroes ni roles.

- **Cuentas** (Better Auth, correo y contraseña de 8+ caracteres): id estable, recuperación por correo con
  enlace que vence en 30 min y cierra las demás sesiones. El frontend de Pages vive en otro origen, así que la
  sesión viaja como token `Bearer`, no como cookie. Se puede seguir jugando como invitado.
- **Monedas**: HeroCoins (se ganan y gastan) y Fragmentos (salen de héroes repetidos y desbloquean héroes).
- **Cofres** (configuración versionada en `shared/economy.ts`):

  | Cofre | Precio | Común | Raro | Épico | Legendario |
  |---|---|---|---|---|---|
  | Estándar | 200 | 60 % | 28 % | 10 % | 2 % |
  | Élite | 600 | — | 70 % | 25 % | 5 % |

  Garantías: épico o mejor a más tardar en la apertura 10 sin épico; legendario a más tardar en la 30; si
  coinciden, gana la legendaria. Dentro de cada rareza, cada héroe tiene la misma probabilidad. Repetidos:
  10/25/60/150 Fragmentos; desbloqueo directo: 100/250/600/1500. El sorteo usa `crypto.randomInt` en el servidor.
- **Partidas oficiales** (sólo en el servidor, nunca P2P): 40 HeroCoins por completarla + 20 por ganar, tope 400
  por día; requisitos: al menos 60 s, modo Héroes o Clásico, cuentas distintas en ambos equipos, al menos 2
  patadas por equipo, 60 % de participación (8 s sin cambiar de entrada cuenta como AFK), seguir en el equipo al
  final y no repetir los mismos rivales más de 3 veces en el día. Detener o reiniciar antes del final no da nada.
  Objetivos: 3 oficiales al día → +80; 15 a la semana → +1 cofre élite. Días y semanas en hora de Montevideo
  (la semana empieza el lunes).
- **Garantías técnicas**: cada operación lleva una clave de idempotencia (doble clic o reintento no cobran dos
  veces); la billetera se bloquea por usuario (`SELECT … FOR UPDATE`); el libro de movimientos y las aperturas son
  sólo de agregado (un disparador impide modificarlos); las correcciones son movimientos compensatorios.
- **Errores de red**: si se envió una compra o apertura y no llegó la respuesta, aparece un aviso con
  *Comprobar*, que reenvía la misma operación con la misma clave: si ya se hizo, el servidor devuelve el resultado
  original. Una apertura que no llegaste a ver (pestaña cerrada) se muestra al volver.

Simulación de progreso (`npm run economy:simulate`): con un jugador casual se completan los 8 héroes no iniciales en
una mediana de 42 días; regular, 27; intenso, 21. Tasa efectiva de legendario ≈ 4,7 %.

## Interfaz

Pestañas **Jugar** (entrenamiento, bots y multijugador separados; lista de salas compacta con tipo Oficial/Casual),
**Héroes** (colección de 12 con filtros por rareza, rol y disponibilidad; descripción de Q/E con recargas; cómo se
consigue; equipar; probar gratis en entrenamiento), **Cofres** (saldo, compra, apertura, probabilidades base y para
tu próxima apertura, progreso de garantías), **Perfil** (cuenta, estadísticas verificadas, objetivos con hora de
reinicio, historial de movimientos y aperturas) y **Administración** (sólo con rol).

La apertura de cofres sólo empieza cuando el servidor confirmó el resultado; la animación dura 1,5 s, es neutra
(no insinúa otra rareza), se puede saltar y se omite con *reducir movimiento*. Muestra héroe, rareza (color, icono
y texto), si es nuevo o repetido y los Fragmentos, con *Equipar*, *Ver colección* y *Cerrar*.

| Cofres | Apertura | Apertura recuperada |
|---|---|---|
| ![cofres](docs/capturas/02-cofres.jpg) | ![apertura](docs/capturas/03-apertura.jpg) | ![recuperada](docs/capturas/04-apertura-recuperada.jpg) |

| Colección | Perfil | Sala oficial |
|---|---|---|
| ![colección](docs/capturas/05-coleccion.jpg) | ![perfil](docs/capturas/06-perfil.jpg) | ![sala oficial](docs/capturas/11-sala-oficial.jpg) |

| Administración: vista previa | Entrega registrada | Avisos del destinatario |
|---|---|---|
| ![vista previa](docs/capturas/07-admin-vista-previa.jpg) | ![entrega](docs/capturas/08-admin-entrega.jpg) | ![avisos](docs/capturas/09-avisos-destinatario.jpg) |

| HUD con nombre y estado de Q/E | Móvil vertical | Crear sala oficial |
|---|---|---|
| ![hud](docs/capturas/12-hud.jpg) | ![móvil](docs/capturas/13-movil.jpg) | ![crear](docs/capturas/10-crear-sala-oficial.jpg) |

Capturas reales tomadas del servidor local con PostgreSQL embebido y cuentas de prueba.

## Administración

- Buscar por id estable, apodo o correo; ver HeroCoins, Fragmentos, cofres, garantías, héroes, movimientos y
  aperturas.
- Entregar HeroCoins y cofres estándar/élite con **motivo obligatorio** (5 a 200 caracteres), dentro de los límites
  por operación. *Revisar* muestra destinatario, id, cantidades y saldo antes/después; *Confirmar* usa una clave
  fijada al revisar (un doble clic no entrega dos veces). Un administrador puede entregarse recursos a sí mismo; queda en el registro con su id.
- Correcciones: sólo como movimiento compensatorio que referencia al original (*Corregir* en una entrega). Nada se
  edita ni se borra.
- El destinatario ve un aviso la próxima vez que entra, aunque estuviera desconectado.
- **Personaje secreto (Thanos)**: en el detalle de la cuenta, *Revisar asignación* / *Revisar retiro* con motivo
  obligatorio; la confirmación nombra al destinatario y su id. Es idempotente, no duplica, no toca otros héroes y
  queda en la auditoría `hero_grant` (sólo inserción) con quién, cuándo y por qué. Al retirarlo, si lo tenía
  equipado vuelve a Spider-Man, y si estaba en una sala deja de valer en el próximo saque.
- Moderación en salas: con rol `moderator`, en el servidor el rol llega con la sesión verificada; en salas P2P el
  backend firma el desafío de la conexión (la clave privada nunca llega al navegador). La marca **MOD** identifica
  al moderador verificado y **✔** a las cuentas verificadas.

## Controles

| Acción | Teclado | Táctil |
|---|---|---|
| Moverse (8 direcciones) | WASD o flechas | joystick (mitad izquierda) |
| Patear | Espacio o X | botón ⚽ |
| Poder 1 / Poder 2 | Q / E | botones Q / E |
| Thanos: elegir gema / activar / siguiente | 1–5 / Q / E | tocar la gema / Q / E |
| Responder el quiz de Baldi | 1, 2 o 3 | tocar la respuesta |
| Chat | Enter | — |
| Menú / sala | Esc | botón Menú |
| Volver al centro (entrenamiento) | R | menú |

Debajo de cada poder el HUD muestra su nombre y su estado en texto: *Listo*, *Activo*, *Recargando* (con segundos),
*Aturdido*, *Atrapado*, *Controlado*, *Quiz* o *En pausa* (sin cooldowns: *LISTO* / *ACTIVA*). CJ muestra sus tres
balas (●/○) y la recarga; Thanos, una barra con las cinco gemas (tecla, nombre, objetivo, estado y recarga). Las
teclas 1–5 no se capturan mientras escribís en el chat; durante el quiz, 1–3 responden y no cambian la gema.

## Modos

- **Héroes**: dos poderes (Q y E) con recarga. Puede ser oficial.
- **Súper**: mismos héroes con poderes potenciados (`SUPER_POWERS` en `shared/config.ts`). Sólo casual.
- **Clásico**: sin poderes. Puede ser oficial.

**Cooldowns: Normales / Sin cooldowns** (Héroes y Súper). Se elige al crear la sala, en la configuración de la sala
(anfitrión), en entrenamiento y contra bots; en Clásico está deshabilitado con su explicación. Sin cooldowns los
poderes no esperan recarga pero conservan sus duraciones y anticipaciones; mantener la tecla no repite y un poder no
se reactiva mientras dure su propio efecto. El HUD muestra *LISTO* o *ACTIVA* sin números. Lo valida la
simulación (no el cliente), hay topes de proyectiles, zonas y eventos, y la sala y el partido muestran la etiqueta
«Sin cooldowns». Siempre es casual: no puede marcarse como oficial y el servidor rechaza recompensas
(`evaluateMatch`). Cambiarlo con el partido en curso se avisa a todos y se aplica al reiniciar (Revancha).

**Efectos visuales**: en Ajustes, *Efectos: Completos / Reducidos* (también se respeta `prefers-reduced-motion`).
Reducidos quita partículas decorativas y conserva las señales esenciales (avisos, áreas reales, aturdimientos).

Entrenamiento (sin rival ni límite) y partidos contra bots (1v1 a 3v3, bots con cualquiera de los 17 héroes públicos)
funcionan sin conexión y no dan recompensas. Todos los héroes se pueden usar en entrenamiento, bots y salas casuales;
en salas oficiales el servidor sólo acepta los de tu colección.

## Héroes y poderes

Todos comparten la física base; sólo cambian los poderes. R = radio de un jugador (15). La rareza indica la
frecuencia en cofres, no el poder. Tabla generada desde `shared/config.ts` con `npx tsx scripts/hero-table.ts`:

| Héroe | Rareza · rol | Q | E |
|---|---|---|---|
| Spider-Man | Común (inicial) · Control | **Telaraña**: Apunta sola a la pelota y la atrae (8R). CD 7 s | **Impulso arácnido**: Desplazamiento rápido 0,25 s. CD 6 s |
| Batman | Común (inicial) · Control | **Batarang**: Apunta solo al objetivo más alineado: empuja la pelota o frena a un rival (9R). CD 6 s | **Gancho**: Se engancha a la pelota y te lleva hacia ella (10R). CD 7 s |
| Hulk | Común (inicial) · Defensa | **Golpe al suelo**: Onda 4R que empuja pelota y rivales. CD 8 s | **Furia**: Más masa y patada +35 % durante 2 s. CD 12 s |
| Superman | Común (inicial) · Ataque | **Visión láser**: Tras 0,15 s de aviso, rayo recto (12R) que apunta solo a la pelota o a un rival: empuja al primer objetivo (pelota o rival). Paredes y postes lo bloquean. CD 8 s | **Súper velocidad**: +40 % aceleración y velocidad durante 1,2 s. CD 10 s |
| Hawkeye | Común · Ataque | **Flecha explosiva**: Flecha (12R) que apunta sola a la pelota y explota al tocar algo: onda de 3R que empuja pelota y jugadores de ambos equipos (también a vos), más fuerte cerca del centro. CD 8 s | **Paso lateral**: Desplazamiento de hasta 2,5R hacia donde apuntás, chocando normalmente. CD 8 s |
| Black Widow | Común · Control | **Descarga**: Proyectil (6R) que apunta solo al rival más alineado: el primer rival alcanzado acelera 20 % menos durante 0,7 s. CD 8 s | **Dash evasivo**: Desplazamiento rápido (×2,2 velocidad, 0,22 s) hacia donde apuntás, chocando con todo. CD 6 s |
| Capitán América | Raro · Defensa | **Escudo encadenado**: Escudo grande que apunta solo y rebota entre la pelota y rivales cercanos (5R): hasta 3 impactos, uno por objetivo. Nunca rebota hacia aliados. CD 9 s | **Protección de la pelota**: Pelota a menos de 10R: durante 2 s ningún poder puede modificarla (sí patadas y choques). CD 12 s |
| Black Panther | Raro · Movilidad | **Salto felino**: Avance de hasta 4R hacia donde apuntás; se detiene ante jugadores, pelota u obstáculos. CD 8 s | **Pulso cinético**: Tras 0,3 s de aviso empuja a los rivales a 3R y un poco la pelota. CD 10 s |
| Ibai | Raro · Defensa | **Guante de boxeo**: Golpe corto (1,5R desde tu borde) al rival más cercano delante tuyo: empujón fuerte, sin aturdir. No toca pelota ni aliados. CD 8 s | **Cuerpo gigante**: Durante 3 s: tamaño ×1,35 (también el choque), masa ×1,8 y 25 % menos aceleración. Sólo crece en el espacio libre. CD 13 s |
| Iron Man | Épico · Ataque | **Repulsor**: Carga 0,12 s y dispara un pulso (12R) que apunta solo: un impacto fuerte a la pelota o empuje a un rival. CD 7 s | **Misil**: Pelota a menos de 14R: marca dónde está y a los 0,65 s cae un misil (2,5R). Si la pelota sigue ahí, sale en una dirección al azar. No afecta jugadores. CD 11 s |
| Flash | Épico · Movilidad | **Velocidad extrema**: Durante 2 s: aceleración ×2 y velocidad máxima ×1,9. CD 10 s | **Estela acelerada**: Durante 1,5 s acelerás ×1,5 y dejás una estela (1,2 s) que frena 30 % a los rivales que la pisan. No se suma con Q: vale la mejor. CD 11 s |
| Homero | Épico · Control | **Rosquilla atrapante**: Rosquilla (10R) que apunta sola a la pelota o a un rival. Rival: no puede moverse 0,7 s (sí patear y usar poderes sin desplazamiento). Pelota: pierde 25 % de velocidad y durante 2 s patadas y poderes la impulsan 40 % menos. CD 10 s | **Charco de cerveza**: Tira una cerveza 4R adelante: charco de 3R durante 3 s donde todos (también vos) resbalan y cuesta frenar o girar. La pelota no cambia. CD 12 s |
| CJ | Épico · Ataque | **Cargador de tres balas**: 3 balas (12R) que apuntan solas, una por pulsación (mínimo 0,3 s entre balas). Pelota: impulso ×0,75 patada; rival: empujón sin aturdir. Tras la tercera, recarga 10 s. CD 10 s | **Jetpack**: Durante 2 s: aceleración +45 % y velocidad máxima +35 %. Seguís chocando con todo (el vuelo es visual). CD 12 s |
| Verity | Épico · Ataque | **Enfado**: Durante 5 s: aceleración y velocidad +20 % y patada +30 %. CD 13 s | **TNT**: Tira una TNT (8R) que apunta sola a la pelota o a un rival; el lugar de caída queda fijo y explota 2 s después de caer: 5R que empuja pelota y a todos (también a vos). CD 13 s |
| Thor | Legendario · Defensa | **Mjolnir electrificado**: Martillo grande (10R) que apunta solo: un impacto fuerte. Si golpea la pelota la electrifica 1,5 s: quien la toque queda aturdido 0,35 s (también vos). CD 10 s | **Rayo paralizante**: Marca al rival más cercano delante tuyo (10R); a los 0,4 s cae un rayo (1,3R) que aturde 0,55 s a los rivales que sigan ahí. Sin objetivo no gasta la recarga. CD 12 s |
| Doctor Strange | Legendario · Control | **Rebobinar**: Pelota a menos de 12R: vuelve a la posición y velocidad de hace 1,5 s (sólo de esta jugada). No cambia jugadores, marcador ni reloj. CD 12 s | **Portal al arco**: Tras 0,35 s de canalización aparecés delante del arco de la mitad donde estás. Un aturdimiento lo interrumpe. CD 14 s |
| Baldi | Legendario · Control | **Regla de detención**: Regla (12R) que apunta sola a la pelota: la deja quieta una vez, sin congelarla. No afecta jugadores. CD 9 s | **Quiz matemático**: Al rival más alineado delante tuyo (10R): tras 0,4 s recibe una cuenta (suma o resta) y no puede jugar hasta responder bien (máximo 2,5 s). Sin objetivo no gasta la recarga. CD 35 s |

**Thanos** (secreto, en todos los modos para quien lo tenga asignado). Q: Activa la gema seleccionada (teclas 1–5 para elegir). E: Pasa a la siguiente gema.

| Tecla | Gema | Efecto | CD |
|---|---|---|---|
| 1 | Gema del Tiempo | Rival a menos de 10R: vuelve a su posición y velocidad de hace 1,5 s (sólo de esta jugada). | 14 s |
| 2 | Gema de la Mente | Rival a menos de 8R y a la vista: durante 0,8 s se mueve con tus direcciones (vos quedás quieto). No lo hace patear ni usar poderes. | 16 s |
| 3 | Gema de la Realidad | Durante 0,8 s los rivales ven una pelota falsa junto a vos y no ven la real (la real sigue jugándose). | 15 s |
| 4 | Gema del Espacio | Pelota a menos de 12R: tras 0,25 s aparecés junto a ella sin moverla. | 12 s |
| 5 | Gema del Poder | Tu próxima patada (dentro de 2 s) sale +80 % más fuerte. | 10 s |

Balance medido con bots (`tests/balance.test.ts`, 1v1 contra cada inicial; varía entre corridas): la prueba exige
que ningún héroe no inicial supere el 70 % de los goles. En la última corrida: Homero 42 %, CJ 55 %, Baldi 49 %,
Ibai 35 %, Verity 53 % y Thanos 41 % (los bots usan poco el guante de Ibai y no usan las gemas de Thanos). Todos los valores (alcances en R, impulsos en K = patada normal, tiempos en segundos) están
centralizados en `POWERS` y `SUPER_POWERS` de `shared/config.ts`; la tabla muestra los de Héroes.

Reglas comunes:

- Los poderes se activan por flanco (mantener la tecla no repite), no funcionan en saque, pausa, celebración ni
  como espectador. No hay vida o daño, y lo visual nunca cambia la colisión: la única excepción es el Cuerpo
  gigante de Ibai, que cambia su radio físico de a poco y sólo en espacio libre.
- **Autoapuntado compartido** (todos los poderes que se lanzan): cono de 100° alrededor de la última dirección de
  movimiento; gana el menor ángulo, luego la menor distancia, luego el id estable; con línea de visión (los postes
  tapan). Anticipación moderada; la trayectoria queda fija al lanzar. Nunca aliados ni la pelota protegida. Los de
  área (TNT, misil) apuntan al punto de caída. La mira cambia de objetivo sólo si el nuevo se sostiene 150 ms.
- **Controles incapacitantes** (aturdimiento, rosquilla, Gema de la Mente, quiz): no se apilan, nunca más de 1 s
  seguido (el quiz tiene su propio máximo de 2,5 s) y al terminar dejan 1 s de inmunidad. Una tecla mantenida
  durante el control no se dispara al terminar.
- **Protección del Capitán** (prioridad máxima): mientras dura, ningún poder modifica la pelota; los proyectiles
  que la tocan se consumen, los efectos radiales siguen empujando jugadores. No deshace impactos anteriores ni se
  suma con otra protección. Quita la electricidad y la atracción activas sin cambiar posición ni velocidad.
- Ralentizaciones: vale la más fuerte. Velocidad de Flash: Q y E no se multiplican, vale la mayor.
- Cada proyectil, haz o explosión golpea a cada objetivo una sola vez; orden de resolución determinista
  (jugadores en orden, luego proyectiles, hilos y zonas por creación).
- La dirección del misil la sortea la simulación autoritativa con el generador del estado: la reconciliación del
  cliente no la vuelve a sortear. Portal y rebobinado son saltos (no se interpolan como recorrido).
- Gol, reinicio y fin limpian proyectiles, zonas (TNT, charcos, quiz), aturdimientos, controles, electricidad,
  protección, portales, ilusión, tamaño gigante e historiales (pelota y jugadores). Si un jugador se va, se quitan
  sus proyectiles, zonas y su protección, se libera a quien controlaba y termina su ilusión.
- CJ conserva sus balas y su recarga al cambiar de héroe, abrir el menú o reconectarse (el servidor las guarda por
  cuenta durante el partido).

**Thanos (secreto)**: no sale en cofres, catálogos públicos, contadores, bots ni en la colección de quien no lo
tiene. Lo asigna o retira un administrador (motivo obligatorio y auditoría). Quien lo tiene lo usa en **todos los
modos**: entrenamiento, contra bots, salas P2P y salas del servidor (casuales u oficiales, con las recompensas
normales). La propiedad nunca sale del navegador: sin conexión se usa la colección que devuelve el servidor; en el
servidor se lee de la base de datos en cada cambio; en una sala P2P el servidor firma (con `MODERATOR_SIGNING_KEY`)
la lista de secretos de la cuenta para el desafío de esa conexión y el anfitrión verifica la firma con la clave
pública. Esa firma no sirve en otra conexión ni como permiso de moderador. Un retiro vale en salas del servidor en el
próximo saque; en una sala P2P, a partir de la próxima conexión.

## Arquitectura

```
shared/      motor común cliente/servidor (TypeScript puro, sin DOM)
  config.ts    física, estadio, reglas, poderes, catálogo de héroes (rareza y rol)
  economy.ts   precios, probabilidades, garantías, recompensas y calendario (versionado)
  game.ts / physics.ts / powers.ts / bot.ts / protocol.ts / types.ts
server/
  index.ts     HTTP + WebSocket; sin DATABASE_URL, sólo casual
  auth.ts      Better Auth (correo y contraseña, token Bearer)
  api.ts       /api/me, cofres, héroes, moderación y administración (CORS con lista blanca)
  economy.ts   operaciones con transacciones, bloqueo por billetera e idempotencia
  official.ts  reglas puras de elegibilidad de partidas oficiales
  room.ts / handler.ts  salas autoritativas (también corren en el navegador anfitrión P2P)
migrations/  SQL (auth y economía)
client/src/
  account.ts   cliente de la API (sesión, claves de idempotencia, operación pendiente)
  game/        render Canvas 2D, entrada, red y transportes (WebSocket / WebRTC), sesiones, audio
  ui/          React: pestañas (Meta.tsx), sala y partido (App.tsx), HUD (GameView.tsx)
scripts/     base embebida, migraciones, roles, simulación de economía, tabla de héroes
tests/       Vitest
```

### Red

- **Servidor autoritativo**: el cliente envía `{seq, bits}` 60 veces por segundo; el servidor simula física,
  poderes y goles. Snapshots a 30 Hz con el último `ack`.
- **Predicción y reconciliación** del jugador local; interpolación para espectadores.
- Validación de tamaño, forma y rangos de cada mensaje, límites de frecuencia y permisos.
- El token de sesión sólo se envía al servidor propio, nunca a un anfitrión P2P.
- `?lag=200` agrega ~200 ms de latencia artificial (sólo pruebas).

## Parámetros de física

Todos en `shared/config.ts` (px lógicos y ticks de 60/s). Los valores base (jugador radio 15, pelota radio 10,
amortiguación 0,96/0,99, patada 5, cancha 370×170…) se tomaron del cliente público de HaxBall como punto de
partida; el motor es propio y la sensación puede no ser idéntica. El modo *Depuración de contacto* (Ajustes)
dibuja radios, alcance de patada y posiciones de red.

## Cambios (ordenados por importancia)

0. **Seis personajes nuevos**: Homero, CJ, Baldi, Ibai y Verity (en cofres, composición versión 2) y Thanos
   (secreto, asignado por administración, en todos los modos para quien lo tenga); autoapuntado compartido
   para todos los poderes que se lanzan, controles incapacitantes con tope de 1 s e inmunidad, retratos propios.
1. **Remodelación de habilidades** (sin tocar Spider-Man ni Batman): láser de Superman, flecha explosiva, dash de
   Black Widow, escudo encadenado y protección de la pelota del Capitán, repulsor y misil de Iron Man, Flash más
   rápido con estela que acelera y frena de verdad, Mjolnir electrificado y rayo paralizante de Thor, rebobinar y
   portal al arco de Doctor Strange; aturdimiento con inmunidad, opción «Sin cooldowns», efectos reducidos y
   visuales nuevos con áreas iguales a las reales.
1. **Contacto con la pelota**: corrección medida de la hitbox y del alcance de patada, con capa de depuración.
2. **Cuentas recuperables** (Better Auth) con persistencia en PostgreSQL; el invitado sigue pudiendo jugar.
3. **Economía en el servidor**: HeroCoins, Fragmentos, cofres con probabilidades publicadas y garantías,
   duplicados, desbloqueo; idempotencia, bloqueo por billetera y registro sólo de agregado.
4. **Partidas oficiales autoritativas** con recompensas, tope diario, objetivos diario/semanal y reglas anti-abuso;
   el anfitrión P2P no puede emitir recompensas.
5. **Administración y moderación por roles** asignados desde el servidor: entregas con vista previa y motivo,
   correcciones compensatorias, avisos al destinatario. Se eliminó la clave privada guardada en el navegador.
6. **Ocho héroes nuevos** (Hawkeye, Black Widow, Capitán América, Black Panther, Iron Man, Flash, Thor, Doctor
   Strange) con versión Súper, bots y balance medido.
7. **Interfaz con pestañas**: colección, cofres con apertura recuperable, perfil con objetivos e historial.
8. **Pulido**: HUD con nombre y estado de cada poder en texto, mayor contraste y texto secundario más grande,
   nombres accesibles en botones de icono, indicador de partida oficial/casual, cuentas verificadas (✔), texto de
   entrenamiento corregido, diseño móvil vertical, bots con los 12 héroes.

## Pruebas

```bash
npm test          # 262 pruebas (incluye PostgreSQL embebido real en tests/db.test.ts)
npm run typecheck
```

Última ejecución: 15 archivos, 262 pruebas, todas pasan. `tests/render.test.ts` dibuja partidas con todos los efectos nuevos sobre un canvas simulado. `tests/newheroes.test.ts` cubre los seis personajes
nuevos en Héroes y Súper, el autoapuntado (pelota, rivales, aliados, pelota protegida, poste, fuera de alcance,
punto de caída de la TNT), las tres balas y la recarga de CJ, rosquilla, charco, crecimiento sin superposición,
quiz (respuesta, error, tiempo, inmunidad, bots), TNT al reiniciar y al desconectarse, historial que no cruza
jugadas, ilusión sin efecto físico, Gema del Espacio sin superposición, Gema de la Mente con tope y
determinismo. En `tests/db.test.ts`: asignación y retiro de Thanos (permisos, motivo, vista previa, duplicados,
auditoría inmodificable, avisos), sin desbloqueo ni cofres, y salas del servidor (casual y oficial) que lo aceptan
sólo para la cuenta dueña. En `tests/admin.test.ts`: la firma de secretos en salas P2P (válida sólo para esa clave,
conexión y lista; nunca como permiso de moderador). `tests/rework.test.ts` cubre cada habilidad remodelada en
Héroes y Súper (impulso efectivo igual al configurado, radio y ancho reales), dash y carrera sin atravesar, escudo
sin bucles y con elección determinista, protección contra todos los poderes, misil con sorteo único y el mismo
resultado en dos clientes en red, electricidad una vez por jugador, aturdimiento e inmunidad, rebobinar (inicio,
cerca del arco, después de un gol, lugar ocupado), portal (ambas mitades, línea central, destino bloqueado),
«Sin cooldowns» (pulsaciones rápidas, tecla mantenida, topes, sala, sin recompensas), limpieza y espectadores.
El resto cubre física y poderes (incluido el balance), protocolo y salas, y contra PostgreSQL real: registro y bienvenida única, recuperación de cuenta en otro
navegador y restablecimiento de contraseña, persistencia tras reiniciar, compras y aperturas concurrentes y con
doble clic, fallo de red después de abrir, saldo insuficiente y sin cofres, ambas garantías y su prioridad,
duplicados y desbloqueo por Fragmentos, objetivos y tope diario, rivales repetidos, resultados P2P falsificados
rechazados, entregas administrativas (vista previa, idempotencia, auditoría, aviso offline, límites, autoentrega),
registro inmodificable, héroes bloqueados rechazados en salas oficiales, invitados sólo espectadores, partido
oficial completo con aviso por WebSocket y sin recompensa al detener o reiniciar. En el cliente: operación sin
respuesta que se confirma con la misma clave.

## Pendientes reales

- **Backend no desplegado públicamente.** El código, las migraciones y la configuración están listos, pero no hay
  servidor ni base de datos en Internet, así que en https://kamuluuuu-ai.github.io/heroball/ la economía **no está
  disponible**. Falta elegir hosting (Node + PostgreSQL con HTTPS), cargar las variables y crear `VITE_API_URL`.
- **Correo**: sin `SMTP_URL` real la recuperación de contraseña sólo funciona leyendo el enlace en la consola del
  servidor. No se probó con un proveedor SMTP real.
- **Moderación en el sitio público**: el acceso con la clave privada en el navegador se quitó a propósito. Hasta que
  haya backend con `MODERATOR_SIGNING_KEY`, no hay moderador global en las salas P2P de Pages.
- No verificado en el navegador: el aviso de recompensa al terminar una partida oficial entre dos personas reales
  (sí está cubierto por una prueba automatizada que juega el partido por WebSocket); controles táctiles en un
  teléfono físico (sólo emulación de tamaño).
- El límite de intentos de inicio de sesión es en memoria (un solo proceso). Con varias instancias haría falta un
  almacenamiento compartido.
- Salas en memoria: se pierden al reiniciar el servidor (las cuentas y la economía no).

## Licencia

MIT. Ver [LICENSE](LICENSE). HeroBall es un proyecto independiente; HaxBall es una marca de sus respectivos dueños.
