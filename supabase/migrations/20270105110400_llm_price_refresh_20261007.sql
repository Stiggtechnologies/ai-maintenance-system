-- Refresh the three OpenAI models proposed for the bounded commercial policy.
--
-- USD rates were reverified from the official OpenAI model pages on
-- 2026-10-07 and were unchanged:
--   gpt-5.6-terra  USD 2.00 input / 12.00 output per 1M tokens
--   gpt-5.6-luna   USD 0.20 input /  1.20 output per 1M tokens
--   gpt-4o-mini    USD 0.15 input /  0.60 output per 1M tokens
--
-- The latest available Bank of Canada business-day observation at retrieval
-- was USD/CAD 1.4226 for 2026-10-06. CAD = USD x 1.4226.
-- Historical settled usage retains its own price snapshot. This table is the
-- current price used for new reservations, policy evaluation and settlement.
-- The conflict guard refuses to replace a newer operator-entered observation.

insert into private.llm_prices
  (model, input_cad_per_mtok, output_cad_per_mtok, source, effective_date)
values
  ('gpt-5.6-terra', 2.8452, 17.0712,
   'USD 2.00/12.00 per 1M: https://developers.openai.com/api/docs/models/gpt-5.6-terra (retrieved 2026-10-07); USD/CAD 1.4226 Bank of Canada 2026-10-06',
   '2026-10-07'),
  ('gpt-5.6-luna', 0.28452, 1.70712,
   'USD 0.20/1.20 per 1M: https://developers.openai.com/api/docs/models/gpt-5.6-luna (retrieved 2026-10-07); USD/CAD 1.4226 Bank of Canada 2026-10-06',
   '2026-10-07'),
  ('gpt-4o-mini', 0.21339, 0.85356,
   'USD 0.15/0.60 per 1M: https://developers.openai.com/api/docs/models/gpt-4o-mini (retrieved 2026-10-07); USD/CAD 1.4226 Bank of Canada 2026-10-06',
   '2026-10-07')
on conflict (model) do update set
  input_cad_per_mtok=excluded.input_cad_per_mtok,
  output_cad_per_mtok=excluded.output_cad_per_mtok,
  source=excluded.source,
  effective_date=excluded.effective_date
where private.llm_prices.effective_date<=excluded.effective_date;
