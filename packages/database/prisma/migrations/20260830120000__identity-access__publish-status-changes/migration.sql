ALTER TABLE "identity_identities"
ADD COLUMN "status_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "identity_identities"
ADD CONSTRAINT "identity_identities_status_version_check"
CHECK ("status_version" >= 0);

CREATE OR REPLACE FUNCTION identity_publish_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  produced_event_id UUID := gen_random_uuid();
  produced_correlation_id UUID := gen_random_uuid();
  produced_causation_id UUID := gen_random_uuid();
  produced_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  NEW.status_version := OLD.status_version + 1;
  INSERT INTO platform_outbox_events
    (event_id, envelope_version, event_type, aggregate_id, aggregate_version,
     occurred_at, correlation_id, causation_id, actor_type, actor_id, payload)
  VALUES
    (produced_event_id, 1, 'IdentityStatusChanged.v1', NEW.id,
     NEW.status_version, produced_at, produced_correlation_id, produced_causation_id,
     'SYSTEM', NULL,
     jsonb_build_object(
       'status', CASE WHEN NEW.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
       'statusVersion', NEW.status_version
     ));
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_status_change_outbox
BEFORE UPDATE OF "status" ON "identity_identities"
FOR EACH ROW
EXECUTE FUNCTION identity_publish_status_change();
