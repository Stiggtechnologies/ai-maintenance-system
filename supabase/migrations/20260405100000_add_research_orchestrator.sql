-- SyncAI Research Orchestrator
-- Internal experimentation system for optimizing prompts, scoring, thresholds, and diagnostics
-- Inspired by Karpathy's autoresearch pattern: propose → experiment → score → keep/discard → log

BEGIN;

-- Research programs: the "program.md" equivalent — defines what the orchestrator optimizes
CREATE TABLE IF NOT EXISTS research_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code TEXT NOT NULL UNIQUE,
  program_name TEXT NOT NULL,
  description TEXT,
  -- What domain this program optimizes
  domain TEXT NOT NULL CHECK (domain IN (
    'recommendation_quality', 'oee_diagnosis', 'kpi_thresholds',
    'deployment_templates', 'agent_routing', 'anomaly_detection',
    'gainshare_formulas', 'onboarding_sequence', 'executive_summaries',
    'prioritization_ranking'
  )),
  -- The markdown instruction document (equivalent to program.md)
  program_instructions TEXT NOT NULL,
  -- What surfaces are mutable (prompt files, config keys, threshold values)
  mutable_surfaces JSONB NOT NULL DEFAULT '[]',
  -- What surfaces are fixed (never touched by research)
  fixed_surfaces JSONB NOT NULL DEFAULT '[]',
  -- Success metrics definitions
  success_metrics JSONB NOT NULL DEFAULT '[]',
  -- Benchmark dataset references
  benchmark_dataset_ids UUID[] DEFAULT '{}',
  -- Experiment budget
  max_experiment_duration_minutes INTEGER NOT NULL DEFAULT 10,
  max_concurrent_experiments INTEGER NOT NULL DEFAULT 1,
  -- Status
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Benchmark datasets: fixed evaluation data for reproducible experiments
CREATE TABLE IF NOT EXISTS research_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_code TEXT NOT NULL UNIQUE,
  benchmark_name TEXT NOT NULL,
  description TEXT,
  domain TEXT NOT NULL,
  -- The dataset (anonymized historical events, synthetic plant data, replay logs)
  dataset_type TEXT NOT NULL CHECK (dataset_type IN (
    'historical_events', 'synthetic_plant', 'replay_logs',
    'kpi_targets', 'oee_targets', 'recommendation_outcomes',
    'approval_outcomes', 'agent_conversations'
  )),
  -- Actual data or reference to data location
  dataset JSONB NOT NULL DEFAULT '{}',
  -- Expected baseline scores
  baseline_scores JSONB DEFAULT '{}',
  -- Size metadata
  record_count INTEGER DEFAULT 0,
  -- Version tracking
  version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Research variants: candidate changes to test (prompt, config, threshold, weight)
CREATE TABLE IF NOT EXISTS research_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES research_programs(id),
  variant_code TEXT NOT NULL,
  description TEXT,
  -- What changed vs baseline
  variant_type TEXT NOT NULL CHECK (variant_type IN (
    'prompt_change', 'config_change', 'threshold_change',
    'weight_change', 'template_change', 'ranking_change',
    'formula_change', 'sequence_change'
  )),
  -- The actual change payload (e.g., new prompt text, new threshold values)
  change_payload JSONB NOT NULL,
  -- Diff from baseline for review
  diff_summary TEXT,
  -- Origin: how this variant was created
  origin TEXT NOT NULL CHECK (origin IN ('ai_proposed', 'human_proposed', 'hybrid')),
  -- Status
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'testing', 'tested', 'promoted', 'discarded', 'archived'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, variant_code)
);

-- Research runs: individual experiment executions
CREATE TABLE IF NOT EXISTS research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES research_programs(id),
  variant_id UUID NOT NULL REFERENCES research_variants(id),
  benchmark_id UUID NOT NULL REFERENCES research_benchmarks(id),
  -- Run metadata
  run_number INTEGER NOT NULL,
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  -- Budget tracking
  budget_minutes INTEGER NOT NULL,
  budget_exceeded BOOLEAN DEFAULT false,
  -- Status
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled'
  )),
  error_message TEXT,
  -- Configuration snapshot (frozen at run time for reproducibility)
  config_snapshot JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Research results: scored outcomes per run
CREATE TABLE IF NOT EXISTS research_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES research_runs(id),
  -- Metrics scored
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  baseline_value NUMERIC,
  improvement_pct NUMERIC,
  -- Whether this metric improved
  improved BOOLEAN NOT NULL DEFAULT false,
  -- Detailed breakdown
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Promotion candidates: variants that passed benchmarks and await human review
CREATE TABLE IF NOT EXISTS promotion_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES research_variants(id),
  program_id UUID NOT NULL REFERENCES research_programs(id),
  -- Aggregate scores across all benchmark runs
  aggregate_scores JSONB NOT NULL DEFAULT '{}',
  -- How many benchmarks passed
  benchmarks_passed INTEGER NOT NULL DEFAULT 0,
  benchmarks_total INTEGER NOT NULL DEFAULT 0,
  -- Net improvement summary
  net_improvement_pct NUMERIC,
  -- Governance checks
  governance_check_passed BOOLEAN DEFAULT false,
  governance_check_details JSONB DEFAULT '{}',
  -- Review status
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'under_review', 'approved', 'rejected', 'promoted_to_staging',
    'promoted_to_production', 'rolled_back'
  )),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_comments TEXT,
  -- Target environment
  target_environment TEXT DEFAULT 'staging' CHECK (target_environment IN ('staging', 'production')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Research run log: detailed step-by-step execution log (equivalent to autoresearch's experiment log)
CREATE TABLE IF NOT EXISTS research_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES research_runs(id),
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN (
    'load_benchmark', 'apply_variant', 'execute_experiment',
    'score_results', 'compare_baseline', 'decision', 'log_outcome'
  )),
  step_data JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_research_runs_program ON research_runs(program_id);
CREATE INDEX IF NOT EXISTS idx_research_runs_variant ON research_runs(variant_id);
CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status);
CREATE INDEX IF NOT EXISTS idx_research_results_run ON research_results(run_id);
CREATE INDEX IF NOT EXISTS idx_research_variants_program ON research_variants(program_id);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_status ON promotion_candidates(review_status);

-- RLS (internal-only, restrict to admin/research roles)
ALTER TABLE research_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_run_log ENABLE ROW LEVEL SECURITY;

-- Policies: only users with admin or research roles can access
DO $$ BEGIN
  CREATE POLICY "research_programs_admin" ON research_programs
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "research_benchmarks_admin" ON research_benchmarks
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "research_variants_admin" ON research_variants
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "research_runs_admin" ON research_runs
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "research_results_admin" ON research_results
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "promotion_candidates_admin" ON promotion_candidates
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "research_run_log_admin" ON research_run_log
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON ura.role_id = r.id
        WHERE ura.user_id = auth.uid()
        AND r.code IN ('ADMIN', 'EXEC', 'RESEARCHER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
