CREATE OR REPLACE FUNCTION notify_api_config_changed()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  action_type TEXT;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    action_type := 'delete';
    payload := json_build_object('action', action_type, 'apiId', OLD.id);
  ELSIF (TG_OP = 'UPDATE' AND OLD.is_active = TRUE AND NEW.is_active = FALSE) THEN
    action_type := 'delete';
    payload := json_build_object('action', action_type, 'apiId', NEW.id);
  ELSE
    action_type := 'upsert';
    payload := json_build_object('action', action_type, 'apiId', NEW.id);
  END IF;
  PERFORM pg_notify('api_config_changed', payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_api_config ON monitored_apis;

CREATE TRIGGER trg_notify_api_config
  AFTER INSERT OR UPDATE OR DELETE
  ON monitored_apis
  FOR EACH ROW
  EXECUTE FUNCTION notify_api_config_changed();
