-- Personajes secretos (Thanos): nunca salen en cofres ni se desbloquean con
-- Fragmentos; sólo un administrador de economía los asigna o retira, con
-- motivo obligatorio. La propiedad vive en hero_unlock (source = 'admin') y
-- cada asignación o retiro queda en esta auditoría de sólo inserción.
CREATE TABLE hero_grant (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  hero text NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hero_grant_user ON hero_grant (user_id, id);
CREATE TRIGGER hero_grant_append_only BEFORE UPDATE ON hero_grant
  FOR EACH ROW EXECUTE FUNCTION heroball_append_only();
