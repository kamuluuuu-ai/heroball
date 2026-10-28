-- La auditoría de asignaciones de personajes también es inborrable (0003 sólo
-- impedía modificarla).
DROP TRIGGER hero_grant_append_only ON hero_grant;
CREATE TRIGGER hero_grant_append_only BEFORE UPDATE OR DELETE ON hero_grant
  FOR EACH ROW EXECUTE FUNCTION heroball_append_only();
