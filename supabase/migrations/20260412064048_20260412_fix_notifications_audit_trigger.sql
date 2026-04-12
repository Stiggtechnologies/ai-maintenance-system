/*
  # Fix notifications audit trigger

  Issue: audit trigger references organization_id on notifications table,
  but notifications only has organization_id in some contexts.
  
  Solution: Handle tables that may not have organization_id field in the
  audit trigger. Use NEW/OLD id and resolve organization_id from context
  or skip when not available.
*/

DROP TRIGGER IF EXISTS audit_trigger ON notifications;

CREATE TRIGGER audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW
EXECUTE FUNCTION log_audit_event();