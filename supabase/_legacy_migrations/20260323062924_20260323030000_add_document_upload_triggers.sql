/*
  # Document Upload Triggers

  ## Summary
  Adds automatic triggers for document processing when documents are uploaded.

  ## Features
  - Auto-enqueue document processing jobs
  - Auto-trigger RAG embedding generation
  - Event notifications for document processing
*/

CREATE OR REPLACE FUNCTION trigger_document_processing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.processing_status = 'pending' THEN
    PERFORM enqueue_job(
      'process_document',
      jsonb_build_object('document_id', NEW.id),
      6,
      now(),
      NEW.created_by
    );

    PERFORM broadcast_to_channel(
      'system.alerts',
      'document_uploaded',
      jsonb_build_object(
        'document_id', NEW.id,
        'title', NEW.title,
        'document_type', NEW.document_type
      ),
      NEW.created_by,
      'normal'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_process_documents
  AFTER INSERT ON knowledge_base_documents
  FOR EACH ROW
  WHEN (NEW.processing_status = 'pending')
  EXECUTE FUNCTION trigger_document_processing();

CREATE OR REPLACE FUNCTION trigger_runbook_on_asset_failure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_runbook_url TEXT;
BEGIN
  IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
    v_runbook_url := current_setting('app.supabase_url', true) || '/functions/v1/runbook-executor';

    PERFORM net.http_post(
      url := v_runbook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      ),
      body := jsonb_build_object(
        'action', 'trigger',
        'runbook_code', 'DOWNTIME_TRIAGE',
        'trigger_data', jsonb_build_object(
          'asset_id', NEW.id,
          'asset_name', NEW.name,
          'triggered_by', 'asset_status_change',
          'timestamp', now()
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'http') THEN
    DROP TRIGGER IF EXISTS trigger_downtime_runbook ON assets;
    CREATE TRIGGER trigger_downtime_runbook
      AFTER UPDATE ON assets
      FOR EACH ROW
      WHEN (NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed')
      EXECUTE FUNCTION trigger_runbook_on_asset_failure();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trigger_alarm_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_runbook_url TEXT;
BEGIN
  IF NEW.severity = 'critical' AND NOT NEW.acknowledged THEN
    v_runbook_url := current_setting('app.supabase_url', true) || '/functions/v1/runbook-executor';

    PERFORM net.http_post(
      url := v_runbook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      ),
      body := jsonb_build_object(
        'action', 'trigger',
        'runbook_code', 'ALARM_ESCALATION',
        'trigger_data', jsonb_build_object(
          'alert_id', NEW.id,
          'severity', NEW.severity,
          'title', NEW.title,
          'triggered_by', 'critical_alert',
          'timestamp', now()
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'http') THEN
    DROP TRIGGER IF EXISTS trigger_critical_alarm_escalation ON system_alerts;
    CREATE TRIGGER trigger_critical_alarm_escalation
      AFTER INSERT ON system_alerts
      FOR EACH ROW
      WHEN (NEW.severity = 'critical' AND NOT NEW.acknowledged)
      EXECUTE FUNCTION trigger_alarm_escalation();
  END IF;
END $$;
