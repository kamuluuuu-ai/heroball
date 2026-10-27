-- Economía, colección, partidas oficiales, roles y auditoría de HeroBall.
-- Los saldos viven en wallet; cada cambio queda en ledger (sólo inserción).

-- Roles: se asignan únicamente con el procedimiento de servidor
-- (npm run admin:grant-role), nunca desde la API pública.
CREATE TABLE user_role (
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('moderator', 'economy_admin')),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE wallet (
  user_id text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  coins bigint NOT NULL DEFAULT 0 CHECK (coins >= 0),
  fragments bigint NOT NULL DEFAULT 0 CHECK (fragments >= 0),
  standard_chests integer NOT NULL DEFAULT 0 CHECK (standard_chests >= 0),
  elite_chests integer NOT NULL DEFAULT 0 CHECK (elite_chests >= 0),
  -- garantías compartidas entre ambos tipos de cofre
  pity_epic integer NOT NULL DEFAULT 0 CHECK (pity_epic >= 0),
  pity_legendary integer NOT NULL DEFAULT 0 CHECK (pity_legendary >= 0),
  equipped_hero text NOT NULL DEFAULT 'spider',
  -- última apertura ya presentada al jugador (para recuperar una animación interrumpida)
  last_seen_opening bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hero_unlock (
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  hero text NOT NULL,
  source text NOT NULL CHECK (source IN ('chest', 'fragments', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hero)
);

-- Libro mayor: cada movimiento con su saldo resultante, motivo y autor.
CREATE TABLE ledger (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'welcome', 'match', 'daily', 'weekly', 'buy_chest', 'open_chest',
    'unlock', 'admin_grant', 'admin_correction'
  )),
  coins_delta bigint NOT NULL DEFAULT 0,
  fragments_delta bigint NOT NULL DEFAULT 0,
  standard_delta integer NOT NULL DEFAULT 0,
  elite_delta integer NOT NULL DEFAULT 0,
  coins_after bigint NOT NULL,
  fragments_after bigint NOT NULL,
  standard_after integer NOT NULL,
  elite_after integer NOT NULL,
  -- referencia única por usuario para recompensas que se entregan una sola vez
  ref text,
  reason text,
  actor_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  economy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_once ON ledger (user_id, ref) WHERE ref IS NOT NULL;
CREATE INDEX ledger_user ON ledger (user_id, id DESC);

-- Aperturas de cofres (resultado ya sorteado y entregado).
CREATE TABLE chest_opening (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  chest_type text NOT NULL CHECK (chest_type IN ('standard', 'elite')),
  rarity text NOT NULL,
  hero text NOT NULL,
  duplicate boolean NOT NULL,
  fragments integer NOT NULL,
  guarantee text,
  pity_before jsonb NOT NULL,
  pity_after jsonb NOT NULL,
  economy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chest_opening_user ON chest_opening (user_id, id DESC);

-- Auditoría inalterable: ni el panel ni la API pueden editar o borrar.
CREATE FUNCTION heroball_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'la tabla % es de sólo inserción', TG_TABLE_NAME;
END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger
  FOR EACH ROW EXECUTE FUNCTION heroball_append_only();
CREATE TRIGGER chest_opening_append_only BEFORE UPDATE OR DELETE ON chest_opening
  FOR EACH ROW EXECUTE FUNCTION heroball_append_only();

-- Idempotencia: la misma clave devuelve la misma respuesta sin repetir la operación.
CREATE TABLE idempotency (
  user_id text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 80),
  op text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Partidas oficiales resueltas por el servidor.
CREATE TABLE official_match (
  id text PRIMARY KEY,
  mode text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_s integer NOT NULL,
  score_red integer NOT NULL,
  score_blue integer NOT NULL,
  winner text,
  kicks_red integer NOT NULL,
  kicks_blue integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_participant (
  match_id text NOT NULL REFERENCES official_match (id),
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  team text NOT NULL,
  hero text NOT NULL,
  active_ratio real NOT NULL,
  eligible boolean NOT NULL,
  reason text,
  won boolean NOT NULL,
  coins integer NOT NULL DEFAULT 0,
  -- rivales de esa partida (para detectar partidas repetidas o pactadas)
  opponents text NOT NULL,
  local_day date NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX match_participant_day ON match_participant (user_id, local_day);

-- Progreso de objetivos por período (fecha local America/Montevideo).
CREATE TABLE objective_progress (
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  period_kind text NOT NULL CHECK (period_kind IN ('daily', 'weekly')),
  period date NOT NULL,
  matches integer NOT NULL DEFAULT 0,
  match_coins integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, period_kind, period)
);

-- Avisos para el destinatario (entregas administrativas, recompensas).
CREATE TABLE notification (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz
);
CREATE INDEX notification_unseen ON notification (user_id) WHERE seen_at IS NULL;
