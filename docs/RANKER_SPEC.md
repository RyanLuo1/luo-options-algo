# Luo Capital — Learned Setup Ranker: Technical Specification

**Status:** Draft v2 (flat-files probe resolved) · **Owner:** Ryan Luo · **Last updated:** 2026-07-19

---

## 1. Goal

Build a machine-learned ranking model that orders the Call Spread Risk Reversal
setups produced by the existing screener **more accurately than the current
hand-written score** (`net_premium / spread_width`), where "more accurately"
means: the model's top-ranked setups realize better outcomes (win rate, capture
efficiency, P&L) than the score's top-ranked setups, **out of sample, within
each scan day**.

The deterministic screener remains the candidate generator. The model is a
re-ranker on top of it. The model never invents trades; it only re-orders
structurally valid, liquidity-guarded, threshold-passing setups.

### Non-goals

- Not building a new strategy. The structure (3-leg CSRR, held to expiration)
  and its filters (min premium $5, min P(profit) 50%, delta windows,
  quote/spread guards) are fixed inputs.
- Not predicting individual trade outcomes accurately. Single-trade P&L is
  noise-dominated; the target is systematically better *ordering*, not
  clairvoyance. If individual-outcome accuracy ever looks high, treat it as a
  leakage alarm, not a success.
- Not delta-hedging, Greek-exposure management, or portfolio construction.
  Single-setup selection only.
- Not autonomous execution. Output is a ranking a human reads.

---

## 2. Current state (what exists as of this spec)

| Component | State |
|---|---|
| Screener (`screener.py`) | Quote-priced (bid to sell / ask to buy), liquidity guards (two-sided quote, spread ≤ 15% of mid), monotonicity check, delta-window leg selection. Fair-value no-op removed. |
| Data plan | Massive Options Advanced: real-time NBBO quotes; historical tick quotes via REST (verified incl. expired contracts) AND via **flat files** (S3, verified entitled: `us_options_opra/quotes_v1`, 2022-03 → present ≈ 4.4 yrs, ~100 GB/day compressed; cross-validated identical to REST to the nanosecond). Also entitled: trades/minute_aggs/day_aggs flat files back to 2014. **No historical Greeks/IV anywhere** — must be computed (Phase A). |
| Live collection | Cron on EC2: 2 scans/day (10:00 & 15:30 ET), market-day guarded, 11 sectors × 118 tickers, top-5-distinct per sector (per-ticker cap 2), best flagged. Writes `ml_dataset` + `sector_scan_runs`. |
| Labels | `backfill_ml_outcomes.py`: fills outcome columns at expiration. Shares payoff code with tradebook backfill. |
| Dataset | Pre-2026-07-20 rows = **pilot** (last-trade priced, NOT trainable). Post-migration rows = real basis. Live accrual ≈ 60–110 rows/day, labels lag by weeks (W1–W12 expirations). |
| Review tooling | `view_sector_scans.py` (per-day), `view_outcomes.py` (tradebook). |

**Data boundary rule:** every analysis/training query on `ml_dataset` includes
`scan_date >= '2026-07-20'` (quote-basis cutover) OR `source = 'backtest'`.
Pilot rows are documentation of the stale-pricing bug, nothing more.

---

## 3. Architecture overview

```
                    ┌─────────────────────────────────────┐
                    │ Massive (Options Advanced)          │
                    │ live NBBO (REST) · flat files (S3)  │
                    └──────┬──────────────────┬───────────┘
                           │                  │ ~100 GB/day quote files
                 live scans│                  ▼
                           │        ┌──────────────────────┐
                           │        │ B-extract (EC2):     │
                           │        │ stream → slot snaps  │
                           │        │ + day_aggs (~4 GB/yr)│
                           │        └────────┬─────────────┘
                           ▼                 ▼
              ┌────────────────┐   ┌──────────────────┐
              │ sector_scan.py │   │ B-replay:        │  Phase B
              │ (cron, 2/day)  │   │ scan_ticker on   │
              └───────┬────────┘   │ extracts         │
                      │            │ + BS IV/delta    │  Phase A
                      │            └────────┬─────────┘
                      │                     │
                      ▼                     ▼
              ┌──────────────────────────────────┐
              │ ml_dataset  (features + labels)  │
              │ source: live_open/live_close     │
              │         backtest                 │
              └───────────────┬──────────────────┘
                              │
                   ┌──────────▼───────────┐
                   │ Phase C: analytics   │  descriptive, no ML
                   ├──────────────────────┤
                   │ Phase D: ranker      │  LightGBM, within-day eval
                   ├──────────────────────┤
                   │ Phase E: shadow mode │  model vs score on live data
                   └──────────────────────┘
```

---

## 4. Phases

### Phase A — Black-Scholes IV/delta module  *(prerequisite; ~small)*

The backtester cannot use Massive Greeks (not served historically). Build
`lib/bs.py` (or `pricing.py`):

- `implied_vol(option_type, mid, spot, strike, dte_years, r) -> iv` via
  Newton/Brent on Black-Scholes; robust to deep-ITM/OTM edge cases.
- `delta(option_type, spot, strike, dte_years, r, iv) -> delta`.
- Rate `r`: constant (e.g. 4–5%) is acceptable; document choice. Dividends:
  ignore for v1; document the approximation.

**Acceptance:** for ≥ 500 current contracts across ≥ 5 tickers spanning the
delta windows, computed delta vs Massive's live snapshot delta agrees within
**±0.02 median, ±0.05 p95**. If it doesn't, investigate before Phase B — the
backtest's leg selection depends on this fidelity.

### Phase B — Backtester  *(two-stage: extract, then replay)*

Replays the live scan on historical quote data. Writes `ml_dataset` with
`source='backtest'`. **Redesigned around flat files** (probe 2026-07-19):
`us_options_opra/quotes_v1` is entitled, 2022-03 → present, cross-validated
identical to REST. Defining constraint: ~100 GB/day compressed, gzip
**non-seekable** — every extraction streams a whole day from byte 0. Rows are
sorted (ticker, then timestamp): a ticker's day is contiguous; early-exit
works; no random access.

**B-extract — the acquisition worker (run once per day-file, EC2):**
1. Stream each day's `quotes_v1` file (pigz -d | fast byte-prefix filter —
   Python sustained 15 MB/s locally and becomes the bottleneck on a fast
   pipe; budget for a compiled/optimized filter).
2. Keep, per contract in the 118-ticker universe, the quotes in a **generous
   window around each slot** (≥ 15 min before 10:00 and 15:30 ET; storage is
   trivial — err wide, because a changed window later costs a full re-stream
   of the year). Keep the last few quotes per contract per window (not just
   the last one): quote age, spread stability, and update frequency are
   cheap future features that cannot be recovered from a single quote.
3. Also download `day_aggs_v1` in full (4 MB/day): solves historical
   volume-filter checks and per-day contract discovery locally, replacing
   REST aggs calls entirely.
4. Output: local slot-snapshot store, ~10–15 MB/day → **~3–4 GB/year total**
   (vs 27.5 TB raw). Per-day extraction is independent → parallelize by day;
   a temporary beefy EC2/spot worker does the year in a weekend for tens of
   dollars. Resumable: a day-file is done or not.

**B-replay — the backtest proper (local, fast, iterate freely):**
5. **Same code path as live.** `scan_ticker` runs unchanged; the contract
   parser is fed extracted slot-snapshots + Phase-A computed deltas instead
   of the live snapshot. No duplicated scoring/filter logic.
6. **Point-in-time everything.** Chain membership from day_aggs/extracted
   contracts as of that date; spot from historical stock aggs at the slot
   moment; VIX/SPY likewise; earnings/macro proximity from the calendar as
   known then. (REST `list_options_contracts(as_of=...)` remains available
   for membership cross-checks — never combine `as_of` with `expired=True`.)
7. Replay runs read only local extracts — no network, no rate limits,
   perfectly reproducible (the extracts are immutable). Iterating on the
   delta solver or leg logic re-runs the year in minutes, not weekends.

**Validation gate (unchanged, now cheaper):** before extracting the full
year, extract + replay the **overlap window** — the live quote-priced cron
days (2026-07-20 onward, ~10 day-files). Backtest picks vs live cron picks
must substantially agree (same best ticker per sector on a strong majority of
sector-slots; disagreements explained by delta drift at window boundaries or
quote timing). **Do not stream the year until this gate passes.**

**Survivorship note (v1 accepts, documents):** using today's universe.json for
historical dates biases toward names that became mega-caps. Acceptable for a
1-year window; multi-year backtests (the data now reaches 2022) require
point-in-time universe reconstruction (historical index membership + caps).
Logged as future work.

**Acceptance:** overlap-window gate passed; 1 year of `source='backtest'` rows
written with outcomes backfilled (all expirations historical → labels complete
immediately); zero no-arb violations; replay fully reproducible from the
extract store.

### Phase C — Descriptive analytics  *(cheap, high-insight; before any ML)*

On the labeled backtest corpus (~2,500+ best rows + runners-up):

- Win rate & capture by **score decile** — does the existing score predict at all?
- **P(profit) calibration** — when the delta model says 50%, does ~50% win?
- `earnings_before_expiry` effect (prior: hurts). Days-to-earnings gradient.
- VIX-regime splits; open vs close slot outcomes (higher scores at close —
  better results, or just different pricing?).
- `setups_qualified` (pick competitiveness) vs outcome — are thin-sector
  picks worse?
- Ticker/sector concentration of realized P&L.

**Deliverable:** a short written findings doc. **Decision point:** if 2–3
features explain most of the variation, consider rule-based filters instead of
(or before) a model — simpler is stronger. Proceed to D only if the signal
looks conditional/interactive enough to warrant learning.

### Phase D — The ranker  *(only after C)*

- **Model:** LightGBM (gradient-boosted trees). Tabular, small-data-robust,
  feature importances. No neural nets.
- **Target:** start with classification P(win); secondary regression on
  capture_pct or pnl. (Learning-to-rank objectives are a later refinement.)
- **Features:** everything at-scan-time in `ml_dataset` incl. the existing
  score as a feature. NOTHING computed post-scan. `source` never a feature.
- **Validation:** walk-forward only (train on months 1–9, test 10–12; roll).
  Never random splits. **Primary metric: within-scan-day ranking** — for each
  day+slot, compare the model's top-k picks vs the score's top-k picks on
  realized outcome. Report win rate / capture / P&L of model-top-k vs
  score-top-k, and within-day rank correlation. Global AUC/RMSE are
  secondary diagnostics only.
- **Baseline to beat:** the existing score's ranking. If the model can't beat
  it out of sample by a meaningful margin, the finding is "the heuristic is
  adequate" — a legitimate, publishable-in-README outcome.
- **Leakage tripwire:** individual-outcome accuracy that looks impressive =
  stop and audit. Expect modest, consistent ranking improvement, not oracle
  behavior.

**Acceptance:** documented walk-forward comparison, model-top-k vs
score-top-k, with feature importances and a written interpretation.

### Phase E — Shadow mode  *(months; patience by design)*

- Score each new live scan's qualified setups with the frozen model; log the
  model's ranking alongside the score's (extend `ml_dataset` or a sibling
  table with `model_score`, `model_version`).
- No behavior change: the screener/UI keeps ranking by score. The model runs
  silently.
- After ≥ 2–3 months of labeled live picks: compare model-top-k vs score-top-k
  on **live, never-seen data**. This is the only evidence that counts.
- Retraining cadence: quarterly, or on regime shift; every model version
  tagged, comparisons always version-pinned.
- **Only if** shadow mode shows sustained improvement: surface the model score
  in the UI **next to** the algorithmic score (never replacing it), with
  disagreement highlighting.

---

## 5. Risks & honest expectations

| Risk | Stance |
|---|---|
| No exploitable signal beyond the score | Entirely possible. Mega-cap vanilla options are efficiently priced. Outcome is still valuable: a validated "heuristic suffices" + reusable infra. |
| One-regime training data | The backtest year is likely regime-homogeneous. Multi-year extension (with PIT universe) is the fix; until then, hold conclusions loosely and say so. |
| Leakage in the backtester | The central threat. Mitigations: PIT discipline, the live-overlap validation gate, the too-good-to-be-true tripwire. One stale-pricing burn already; carry the scar. |
| Computed-delta drift vs historical "truth" | Bounded by Phase A acceptance; residual boundary-flip noise documented, mirrors live Greek drift already observed. |
| Label lag on live data | W1–W12 expirations mean live labels trail by weeks; shadow-mode evaluation timelines must respect this. |
| Cost | $199/mo data + EC2. Justified while this is an active research system; first cut if shelved. |

**Best realistic outcome:** model-top-k beats score-top-k by a modest,
sustained margin out of sample (e.g. +3–6pts win rate / +3–5pts capture on top
picks) → a validated selection layer on a risk-premium strategy, plus a
demonstrated end-to-end research process (pipeline → corruption discovery →
honest repricing → leakage-gated backtest → out-of-sample-validated model).
The process artifact is valuable independent of the P&L answer.

---

## 6. Open questions (resolve before/during Phase B)

1. ~~**Flat files:** does Massive serve bulk historical option quotes?~~
   **RESOLVED (probe 2026-07-19):** yes — `us_options_opra/quotes_v1` entitled
   on our tier, 2022-03 → present, ~100 GB/day, layout
   `quotes_v1/YYYY/MM/YYYY-MM-DD.csv.gz`, schema
   `ticker,ask_exchange,ask_price,ask_size,bid_exchange,bid_price,bid_size,
   sequence_number,sip_timestamp` (ns; 0 = one-sided). Cross-validated
   identical to REST to the nanosecond. Phase B redesigned around it.
2. Risk-free rate & dividend handling in Phase A — constant r acceptable?
   (v1: yes, documented.)
3. Runners-up in the backtest: top-5-distinct like live or best-only for v1?
   Default: match live (top-5) so distributions are comparable. (Extraction
   cost is identical either way — the decision is replay-side only.)
4. ~~Concurrency ceiling on Massive REST~~ **MOOT** — flat files remove the
   bulk REST load; REST remains only for live scans and spot cross-checks.
5. **Extraction window design (decide BEFORE the year-scale stream):** window
   width per slot (default ≥15 min), how many quotes kept per contract per
   window (default: last 3–5 + summary stats), and whether to add a third
   mid-day window for future robustness checks. Wrong choices here cost a
   full re-stream (~a weekend + tens of dollars) — err generous.

---

## 7. Sequencing summary

```
A   BS IV/delta module + live-snapshot validation     (small; CRITICAL PATH —
                                                       flat files carry prices
                                                       only, nothing replays
                                                       without deltas)
B1a Extraction worker (stream day-files → slot        (build + overlap-window
    snapshots + day_aggs; EC2)                         days first)
B1b Replay core (scan_ticker on extracts +            (the crux; gate: backtest
    computed deltas)                                   ≈ live on overlap days)
B2  Stream the year on a spot worker; replay;         (a weekend + tens of $;
    backfill labels                                    extraction window per
                                                       open question 5 FIRST)
C   Descriptive analytics + findings doc              (days, high value)
D   LightGBM ranker, walk-forward, vs-score eval      (only if C warrants)
E   Shadow mode on live scans                         (months, by design)
```

Each phase has an exit gate. Phases C and D can conclude "stop here" honestly
— that is a feature of the plan, not a failure of it.
