# SyncAI Bolt DB Schema Snapshot
**Date:** 2026-03-22
**Project:** dguwgnxjdivsrekjarlp (Bolt.new Supabase)
**Tables:** 50
**Purpose:** Track schema changes during Bolt buildout for migration planning

---

## agent_conversations

| Column | Type | Required |
|--------|------|----------|
| agent_type | text | ✅ |
| completion_tokens | integer |  |
| confidence_score | double precision |  |
| content | text | ✅ |
| created_at | timestamp with time zone |  |
| entities_extracted | jsonb |  |
| id | uuid | ✅ |
| intent_detected | text |  |
| model_used | text |  |
| prompt_tokens | integer |  |
| response_time_ms | integer |  |
| retrieval_scores | double precision[] |  |
| retrieved_chunks | uuid[] |  |
| role | text | ✅ |
| session_id | uuid | ✅ |
| tenant_id | uuid | ✅ |
| total_tokens | integer |  |
| user_id | uuid |  |

## agent_feedback

| Column | Type | Required |
|--------|------|----------|
| conversation_id | uuid | ✅ |
| corrected_response | text |  |
| created_at | timestamp with time zone |  |
| feedback_text | text |  |
| feedback_type | text | ✅ |
| id | uuid | ✅ |
| issue_category | text |  |
| rating | integer |  |
| resolved_issue | boolean |  |
| tenant_id | uuid | ✅ |
| user_id | uuid |  |
| was_helpful | boolean |  |

## ai_agent_logs

| Column | Type | Required |
|--------|------|----------|
| agent_type | text | ✅ |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| industry | text |  |
| processing_time_ms | integer |  |
| query | text | ✅ |
| response | text |  |
| user_id | text |  |

## approval_workflows

| Column | Type | Required |
|--------|------|----------|
| approval_level | integer |  |
| approver_id | uuid |  |
| comments | text |  |
| created_at | timestamp with time zone |  |
| decision_id | uuid |  |
| id | uuid | ✅ |
| responded_at | timestamp with time zone |  |
| status | text |  |

## asset_health_monitoring

| Column | Type | Required |
|--------|------|----------|
| ai_analysis | text |  |
| anomaly_detected | boolean |  |
| asset_id | uuid |  |
| health_score | numeric |  |
| id | uuid | ✅ |
| predicted_failure_date | timestamp with time zone |  |
| recommendations | jsonb |  |
| recorded_at | timestamp with time zone |  |
| sensor_data | jsonb |  |

## asset_snapshots

| Column | Type | Required |
|--------|------|----------|
| asset_count | integer | ✅ |
| captured_at | timestamp with time zone | ✅ |
| id | bigint | ✅ |
| site_breakdown | jsonb |  |
| tenant_id | uuid | ✅ |

## assets

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| criticality | text |  |
| id | uuid | ✅ |
| location | text |  |
| name | text | ✅ |
| status | text | ✅ |
| type | text | ✅ |
| updated_at | timestamp with time zone |  |

## autonomous_actions

| Column | Type | Required |
|--------|------|----------|
| action_data | jsonb |  |
| action_type | text | ✅ |
| error_message | text |  |
| executed_at | timestamp with time zone |  |
| id | uuid | ✅ |
| success | boolean |  |
| target_id | uuid |  |
| triggered_by | text |  |

## autonomous_decisions

| Column | Type | Required |
|--------|------|----------|
| approval_deadline | timestamp with time zone |  |
| approved_by | uuid |  |
| confidence_score | numeric |  |
| created_at | timestamp with time zone |  |
| decision_data | jsonb | ✅ |
| decision_type | text | ✅ |
| executed_at | timestamp with time zone |  |
| id | uuid | ✅ |
| requires_approval | boolean |  |
| status | text |  |

## billing_invoices

| Column | Type | Required |
|--------|------|----------|
| asset_count | integer |  |
| asset_uplift_cad | numeric | ✅ |
| base_amount_cad | numeric | ✅ |
| created_at | timestamp with time zone |  |
| credits_consumed | bigint |  |
| id | uuid | ✅ |
| meta | jsonb |  |
| paid_at | timestamp with time zone |  |
| period_end | timestamp with time zone | ✅ |
| period_start | timestamp with time zone | ✅ |
| status | text | ✅ |
| stripe_hosted_url | text |  |
| stripe_invoice_id | text |  |
| subscription_id | uuid | ✅ |
| subtotal_cad | numeric | ✅ |
| tax_cad | numeric | ✅ |
| total_cad | numeric | ✅ |
| usage_overage_cad | numeric | ✅ |

## billing_plans

| Column | Type | Required |
|--------|------|----------|
| asset_uplift_cad | numeric | ✅ |
| base_price_cad | numeric | ✅ |
| code | text | ✅ |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| included_assets | integer | ✅ |
| included_credits | bigint | ✅ |
| is_active | boolean |  |
| max_sites | integer | ✅ |
| name | text | ✅ |
| overage_per_credit_cad | numeric | ✅ |

## billing_subscriptions

| Column | Type | Required |
|--------|------|----------|
| cancel_at_period_end | boolean |  |
| created_at | timestamp with time zone |  |
| currency | text | ✅ |
| current_period_end | timestamp with time zone | ✅ |
| current_period_start | timestamp with time zone | ✅ |
| id | uuid | ✅ |
| metadata | jsonb |  |
| plan_id | uuid | ✅ |
| status | text | ✅ |
| stripe_customer_id | text |  |
| stripe_subscription_id | text |  |
| tenant_id | uuid | ✅ |
| updated_at | timestamp with time zone |  |

## cost_budgets

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| enforce_hard_limit | boolean |  |
| id | uuid | ✅ |
| max_cost_usd | numeric |  |
| max_total_tokens | bigint |  |
| period_end | date | ✅ |
| period_start | date | ✅ |
| period_type | text | ✅ |
| status | text |  |
| tenant_id | uuid | ✅ |
| used_cost_usd | numeric |  |
| used_total_tokens | bigint |  |

## data_sources

| Column | Type | Required |
|--------|------|----------|
| config | jsonb | ✅ |
| created_at | timestamp with time zone |  |
| documents_synced | integer |  |
| enabled | boolean |  |
| id | uuid | ✅ |
| last_sync_at | timestamp with time zone |  |
| name | text | ✅ |
| source_type | text | ✅ |
| tenant_id | uuid | ✅ |

## document_uploads

| Column | Type | Required |
|--------|------|----------|
| agent_type | text |  |
| analysis_result | jsonb |  |
| created_at | timestamp with time zone |  |
| file_name | text | ✅ |
| file_path | text | ✅ |
| file_size | bigint | ✅ |
| file_type | text | ✅ |
| id | uuid | ✅ |
| uploaded_by | uuid |  |

## fine_tuning_datasets

| Column | Type | Required |
|--------|------|----------|
| assistant_message | text | ✅ |
| created_at | timestamp with time zone |  |
| dataset_name | text | ✅ |
| dataset_type | text | ✅ |
| id | uuid | ✅ |
| quality_score | double precision |  |
| source | text |  |
| system_prompt | text |  |
| tenant_id | uuid | ✅ |
| training_run_id | text |  |
| used_in_training | boolean |  |
| user_message | text | ✅ |
| verified_by | uuid |  |

## ft_models

| Column | Type | Required |
|--------|------|----------|
| base_model | text |  |
| canary_pct | integer |  |
| created_at | timestamp with time zone |  |
| created_by | uuid |  |
| dataset_id | uuid |  |
| deployed | boolean |  |
| eval_summary | jsonb |  |
| fine_tuning_method | text |  |
| id | uuid | ✅ |
| model_name | text | ✅ |
| model_ref | text | ✅ |
| notes | text |  |
| tags | text[] |  |
| tenant_id | uuid | ✅ |
| training_completed_at | timestamp with time zone |  |
| training_examples_count | integer |  |
| updated_at | timestamp with time zone |  |

## gainshare_runs

| Column | Type | Required |
|--------|------|----------|
| approved_at | timestamp with time zone |  |
| approved_by | uuid |  |
| calculated_savings_cad | numeric | ✅ |
| created_at | timestamp with time zone |  |
| fee_cad | numeric | ✅ |
| id | uuid | ✅ |
| invoice_id | uuid |  |
| method | text | ✅ |
| period_end | date | ✅ |
| period_start | date | ✅ |
| report | jsonb |  |
| share_pct | numeric | ✅ |
| status | text | ✅ |
| tenant_id | uuid | ✅ |
| updated_at | timestamp with time zone |  |

## graph_entities

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| embedding | extensions.vector(1536) |  |
| entity_name | text | ✅ |
| entity_type | text | ✅ |
| id | uuid | ✅ |
| mention_count | integer |  |
| properties | jsonb |  |
| source_chunk_ids | uuid[] |  |
| tenant_id | uuid | ✅ |

## graph_relationships

| Column | Type | Required |
|--------|------|----------|
| confidence_score | double precision |  |
| created_at | timestamp with time zone |  |
| from_entity_id | uuid | ✅ |
| id | uuid | ✅ |
| relationship_type | text | ✅ |
| tenant_id | uuid | ✅ |
| to_entity_id | uuid | ✅ |

## knowledge_base_chunks

| Column | Type | Required |
|--------|------|----------|
| avg_relevance_score | double precision |  |
| chunk_index | integer | ✅ |
| chunk_metadata | jsonb |  |
| content | text | ✅ |
| content_length | integer | ✅ |
| created_at | timestamp with time zone |  |
| document_id | uuid | ✅ |
| embedding | extensions.vector(1536) |  |
| id | uuid | ✅ |
| last_retrieved_at | timestamp with time zone |  |
| next_chunk_id | uuid |  |
| previous_chunk_id | uuid |  |
| retrieval_count | integer |  |
| tenant_id | uuid | ✅ |
| tsv | tsvector |  |

## knowledge_base_documents

| Column | Type | Required |
|--------|------|----------|
| category | text |  |
| chunk_count | integer |  |
| content | text | ✅ |
| created_at | timestamp with time zone |  |
| created_by | uuid |  |
| document_type | text | ✅ |
| file_path | text |  |
| id | uuid | ✅ |
| is_active | boolean |  |
| iso_55000_category | text |  |
| metadata | jsonb |  |
| processing_status | text |  |
| source_url | text |  |
| tags | text[] |  |
| tenant_id | uuid | ✅ |
| title | text | ✅ |
| updated_at | timestamp with time zone |  |
| version | integer |  |

## kpi_baselines

| Column | Type | Required |
|--------|------|----------|
| baseline_value | numeric | ✅ |
| cost_per_unit | numeric |  |
| created_at | timestamp with time zone |  |
| currency | text |  |
| effective_from | date | ✅ |
| effective_to | date |  |
| id | uuid | ✅ |
| metric | text | ✅ |
| notes | text |  |
| tenant_id | uuid | ✅ |

## kpi_categories

| Column | Type | Required |
|--------|------|----------|
| category_name | text | ✅ |
| color | text |  |
| created_at | timestamp with time zone |  |
| description | text |  |
| icon | text |  |
| id | uuid | ✅ |
| sort_order | integer |  |

## kpi_measurements

| Column | Type | Required |
|--------|------|----------|
| actual_value | numeric | ✅ |
| calculated_by | text |  |
| created_at | timestamp with time zone |  |
| data_source | text |  |
| id | uuid | ✅ |
| kpi_id | uuid | ✅ |
| measurement_date | timestamp with time zone | ✅ |
| metadata | jsonb |  |
| notes | text |  |
| org_unit_id | uuid |  |
| status | text |  |
| target_value | numeric |  |
| trend | text |  |
| variance | numeric |  |
| variance_pct | numeric |  |
| verified | boolean |  |
| verified_by | uuid |  |

## kpis_kois

| Column | Type | Required |
|--------|------|----------|
| accountable_level | uuid |  |
| active | boolean |  |
| automation_possible | boolean |  |
| calculation_formula | text |  |
| category_id | uuid |  |
| consulted_levels | uuid[] |  |
| created_at | timestamp with time zone |  |
| data_sources | text[] |  |
| description | text |  |
| direction | text |  |
| frequency | text |  |
| id | uuid | ✅ |
| industry_specific | text[] |  |
| informed_levels | uuid[] |  |
| kpi_code | text | ✅ |
| kpi_name | text | ✅ |
| kpi_type | text | ✅ |
| metadata | jsonb |  |
| responsible_level | uuid |  |
| target_value | numeric |  |
| threshold_green | numeric |  |
| threshold_red | numeric |  |
| threshold_yellow | numeric |  |
| unit_of_measure | text |  |
| updated_at | timestamp with time zone |  |

## maintenance_metrics

| Column | Type | Required |
|--------|------|----------|
| active_work_orders | integer |  |
| cost_savings | numeric |  |
| efficiency | numeric |  |
| esg_score | numeric |  |
| id | uuid | ✅ |
| recorded_at | timestamp with time zone |  |
| total_assets | integer |  |
| uptime | numeric |  |

## model_deployments

| Column | Type | Required |
|--------|------|----------|
| avg_rating | double precision |  |
| deployed_at | timestamp with time zone |  |
| deployment_type | text | ✅ |
| id | uuid | ✅ |
| model_id | uuid |  |
| rollback_reason | text |  |
| rolled_back | boolean |  |
| status | text | ✅ |
| tenant_id | uuid | ✅ |
| total_requests | integer |  |
| traffic_percentage | integer |  |

## model_evaluations

| Column | Type | Required |
|--------|------|----------|
| baseline_value | double precision |  |
| evaluated_at | timestamp with time zone |  |
| evaluated_by | uuid |  |
| evaluation_name | text | ✅ |
| evaluation_type | text | ✅ |
| id | uuid | ✅ |
| improvement_pct | double precision |  |
| metric_name | text | ✅ |
| metric_value | double precision | ✅ |
| model_version | text | ✅ |
| notes | text |  |
| passed | boolean |  |
| tenant_id | uuid | ✅ |
| test_set_description | text |  |
| test_set_size | integer |  |

## organizational_levels

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| description | text |  |
| focus_area | text |  |
| id | uuid | ✅ |
| level_code | text | ✅ |
| level_name | text | ✅ |
| level_order | integer | ✅ |
| typical_roles | text[] |  |

## organizational_units

| Column | Type | Required |
|--------|------|----------|
| active | boolean |  |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| industry | text |  |
| level_id | uuid |  |
| location | text |  |
| manager_id | uuid |  |
| metadata | jsonb |  |
| parent_unit_id | uuid |  |
| unit_code | text | ✅ |
| unit_name | text | ✅ |
| unit_type | text | ✅ |
| updated_at | timestamp with time zone |  |

## performance_dashboards

| Column | Type | Required |
|--------|------|----------|
| active | boolean |  |
| created_at | timestamp with time zone |  |
| dashboard_name | text | ✅ |
| dashboard_type | text | ✅ |
| id | uuid | ✅ |
| industry | text |  |
| kpi_ids | uuid[] |  |
| layout_config | jsonb |  |
| level_id | uuid |  |
| refresh_interval | integer |  |

## performance_targets

| Column | Type | Required |
|--------|------|----------|
| active | boolean |  |
| approved_at | timestamp with time zone |  |
| approved_by | uuid |  |
| baseline_value | numeric |  |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| kpi_id | uuid | ✅ |
| org_unit_id | uuid |  |
| rationale | text |  |
| set_by | uuid |  |
| stretch_goal | numeric |  |
| target_period_end | date | ✅ |
| target_period_start | date | ✅ |
| target_value | numeric | ✅ |

## rag_search_logs

| Column | Type | Required |
|--------|------|----------|
| clicked_rank | integer |  |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| num_results | integer |  |
| query_embedding | extensions.vector(1536) |  |
| query_text | text | ✅ |
| result_was_helpful | boolean |  |
| retrieval_method | text |  |
| retrieval_time_ms | integer |  |
| retrieved_chunk_ids | uuid[] |  |
| similarity_scores | double precision[] |  |
| tenant_id | uuid | ✅ |
| user_clicked_result | boolean |  |
| user_id | uuid |  |

## safety_checks

| Column | Type | Required |
|--------|------|----------|
| action | text |  |
| check_type | text | ✅ |
| confidence_score | double precision |  |
| conversation_id | uuid |  |
| created_at | timestamp with time zone |  |
| findings | jsonb |  |
| id | uuid | ✅ |
| passed | boolean | ✅ |
| tenant_id | uuid | ✅ |

## subscription_limits

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| included_assets | integer | ✅ |
| included_credits | bigint | ✅ |
| last_reset_at | timestamp with time zone | ✅ |
| remaining_credits | bigint | ✅ |
| subscription_id | uuid | ✅ |
| updated_at | timestamp with time zone |  |

## sync_jobs

| Column | Type | Required |
|--------|------|----------|
| completed_at | timestamp with time zone |  |
| created_at | timestamp with time zone |  |
| id | uuid | ✅ |
| job_type | text | ✅ |
| new_items | integer |  |
| source_id | uuid | ✅ |
| started_at | timestamp with time zone |  |
| status | text | ✅ |
| tenant_id | uuid | ✅ |
| updated_items | integer |  |

## system_alerts

| Column | Type | Required |
|--------|------|----------|
| acknowledged | boolean |  |
| alert_type | text | ✅ |
| created_at | timestamp with time zone |  |
| description | text |  |
| id | uuid | ✅ |
| resolved | boolean |  |
| resolved_at | timestamp with time zone |  |
| severity | text | ✅ |
| target_users | uuid[] |  |
| title | text | ✅ |

## tool_definitions

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| description | text | ✅ |
| enabled | boolean |  |
| handler_function | text | ✅ |
| id | uuid | ✅ |
| parameters_schema | jsonb | ✅ |
| requires_approval | boolean |  |
| risk_level | text |  |
| tenant_id | uuid |  |
| tool_name | text | ✅ |
| tool_type | text | ✅ |

## tool_executions

| Column | Type | Required |
|--------|------|----------|
| created_at | timestamp with time zone |  |
| execution_time_ms | integer |  |
| id | uuid | ✅ |
| input_params | jsonb | ✅ |
| output_result | jsonb |  |
| status | text | ✅ |
| tenant_id | uuid | ✅ |
| tool_id | uuid | ✅ |
| user_id | uuid |  |

## usage_events

| Column | Type | Required |
|--------|------|----------|
| asset_id | uuid |  |
| created_at | timestamp with time zone |  |
| credits_consumed | bigint | ✅ |
| event_type | text | ✅ |
| id | bigint | ✅ |
| meta | jsonb |  |
| occurred_at | timestamp with time zone | ✅ |
| site_id | uuid |  |
| subscription_id | uuid | ✅ |
| tenant_id | uuid | ✅ |
| units | bigint | ✅ |

## user_kpi_dashboard

| Column | Type | Required |
|--------|------|----------|
| category_name | text |  |
| email | text |  |
| full_name | text |  |
| kpi_code | text |  |
| kpi_id | uuid |  |
| kpi_name | text |  |
| kpi_type | text |  |
| last_updated | timestamp with time zone |  |
| latest_value | numeric |  |
| level_code | text |  |
| org_level | text |  |
| org_unit | text |  |
| role | text |  |
| status | text |  |
| target_value | numeric |  |
| trend | text |  |
| user_id | uuid |  |

## user_profiles

| Column | Type | Required |
|--------|------|----------|
| certifications | text[] |  |
| competency_level | text |  |
| created_at | timestamp with time zone |  |
| email | text | ✅ |
| full_name | text |  |
| id | uuid | ✅ |
| job_title | text |  |
| kpi_access_level | text |  |
| org_level_id | uuid |  |
| org_unit_id | uuid |  |
| preferences | jsonb |  |
| role | text |  |
| updated_at | timestamp with time zone |  |

## v_asset_latest

| Column | Type | Required |
|--------|------|----------|
| asset_count | integer |  |
| captured_at | timestamp with time zone |  |
| tenant_id | uuid |  |

## v_billable_overage

| Column | Type | Required |
|--------|------|----------|
| included_credits | bigint |  |
| month | timestamp with time zone |  |
| overage_amount_cad | numeric |  |
| overage_credits | numeric |  |
| overage_per_credit_cad | numeric |  |
| subscription_id | uuid |  |
| tenant_id | uuid |  |
| total_credits_used | numeric |  |

## v_current_period_usage

| Column | Type | Required |
|--------|------|----------|
| credits_used | bigint |  |
| current_period_end | timestamp with time zone |  |
| current_period_start | timestamp with time zone |  |
| included_credits | bigint |  |
| overage_credits | bigint |  |
| remaining_credits | bigint |  |
| status | text |  |
| subscription_id | uuid |  |
| tenant_id | uuid |  |

## v_monthly_usage_summary

| Column | Type | Required |
|--------|------|----------|
| credits_used | numeric |  |
| event_count | bigint |  |
| has_overage | boolean |  |
| included_credits | bigint |  |
| month | timestamp with time zone |  |
| overage_credits | numeric |  |
| remaining_credits | bigint |  |
| subscription_id | uuid |  |
| tenant_id | uuid |  |

## v_subscription_credit_summary

| Column | Type | Required |
|--------|------|----------|
| credits_used | bigint |  |
| current_period_end | timestamp with time zone |  |
| current_period_start | timestamp with time zone |  |
| included_credits | bigint |  |
| overage_credits | bigint |  |
| plan_code | text |  |
| plan_name | text |  |
| remaining_credits | bigint |  |
| subscription_id | uuid |  |
| tenant_id | uuid |  |

## v_tenant_monthly_usage

| Column | Type | Required |
|--------|------|----------|
| event_count | bigint |  |
| month | timestamp with time zone |  |
| subscription_id | uuid |  |
| tenant_id | uuid |  |
| total_credits | numeric |  |

## work_orders

| Column | Type | Required |
|--------|------|----------|
| asset_id | uuid |  |
| assigned_to | text |  |
| completed_at | timestamp with time zone |  |
| created_at | timestamp with time zone |  |
| description | text |  |
| id | uuid | ✅ |
| priority | text |  |
| status | text |  |
| title | text | ✅ |
| updated_at | timestamp with time zone |  |
