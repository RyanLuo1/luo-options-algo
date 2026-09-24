-- scan_runs.min_roc: the return-on-collateral floor an Income scan was run under (credit ÷ put strike,
-- per share; 0.01 = 1%). Written only when a floor was set; NULL for older runs and for Upside.
-- Provenance fix 2026-09-24: the floor now runs on the server before sorting and logging, so
-- scan_results holds exactly the rows the user saw, and rank N of M matches the table.
alter table scan_runs add column if not exists min_roc double precision;
