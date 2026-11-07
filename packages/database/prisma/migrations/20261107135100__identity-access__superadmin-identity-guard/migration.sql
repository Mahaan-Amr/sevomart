CREATE FUNCTION identity_guard_last_superadmin_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('identity_platform_superadmins'));
    IF EXISTS (SELECT 1 FROM identity_platform_superadmins WHERE identity_id = OLD.id AND revoked_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM identity_platform_superadmins a
         JOIN identity_identities i ON i.id = a.identity_id
         WHERE a.identity_id <> OLD.id AND a.revoked_at IS NULL AND i.status = 'ACTIVE'
       ) THEN
      RAISE EXCEPTION 'cannot deactivate last active superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_guard_last_superadmin_status_trigger
BEFORE UPDATE OF status ON identity_identities
FOR EACH ROW EXECUTE FUNCTION identity_guard_last_superadmin_status();
