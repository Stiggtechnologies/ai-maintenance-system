
/*
  # Fix audit trigger function schema mismatch
  
  The log_audit_event() trigger function was trying to insert into audit_events with
  columns that don't exist (event_type, actor_type, actor_id, event_time).
  The actual audit_events table has: action_type, user_id, old_values, new_values.
  
  This migration fixes the trigger to match the actual schema.
*/

CREATE OR REPLACE FUNCTION log_audit_event() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_events (
    organization_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    old_values,
    new_values
  ) VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
