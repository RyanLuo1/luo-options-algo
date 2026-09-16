# Screener end-to-end checks

Plain Node scripts on Playwright (no test runner). They drive the real app: real sign-in, real scans against the Massive-backed API, real Tradebook writes.

```
cd web
npx playwright install chromium          # once
npm run test:e2e -- http://127.0.0.1:5002   # local (Flask serving the built app)
npm run test:e2e -- https://luo-capital.com # live
```

Each script prints `PASS` / `FAIL` lines and exits non-zero on any failure. Screenshots land in `tests/e2e/out/` (gitignored).

- `auth.mjs` — the login card at 390: focus, Enter submits, bad email shape, bad login (one message, both recoveries), weak password, Show/Hide, create account → /app, log out, log in, existing email on sign-up, bounce from /tradebook → login lands on /tradebook, forgot-password request notice, a real recovery link (admin `generate_link`) → set a new password → /app, expired-link strip; 1440 captures. Needs `<base>/login` in Supabase's Redirect URLs for the recovery step.
- `states.mjs` — defaults (the dual-gate credit floors), grouped view + expanders + flat toggle, the live return floor, loading (results dimmed, progress strip), a failed rescan (kept results, dismissable strip), cause-specific no-results, keyboard, sort override, idempotent Save, filter-empty.
- `flow.mjs` — fresh account → watchlist → scan → grouped results → sort → select → save → toast → Tradebook → DB provenance.
- `modes.mjs` — Income · Upside: the mode control and help text, the gate-row swap (return floor ↔ minimum upside per $ of collateral, credit $0), an Upside scan with every row stamped, the max-profit-per-$-of-collateral bar and Move-to-max column, two head rows (Income pick / Upside pick) on a shared ticker, the gauge = 1 − δ_B − δ_C, an Upside save labelled Upside in the Tradebook (needs the `mode` columns from `docs/scan_mode_migration.sql`), 1100 overflow.
- `tradebook.mjs` — empty state → save from the Screener → appears first as open → provenance pill + Rerun → edit with replace (count unchanged, original gone) → edit without replace → delete with confirm → seeded graded + grading-pending rows render (service key; cleaned up) → summary matches → read-only editor for graded → sort + keyboard.
- `shots.mjs` — captures at 1440 and 1100 with overflow and font checks.

**Accounts.** Each script creates a throwaway account through the public sign-up API using `../.env` (service key for cleanup) and `web/.env` (anon key), and deletes it and its rows at the end. Set `E2E_EMAIL` / `E2E_PASSWORD` to use an existing account instead (nothing is deleted then). Scans need the server's Massive key; the checks assume at least one of NVDA / AMD / MU clears the default floors.
