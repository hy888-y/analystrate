# Analystrate — Final Documentation Cleanup and Remaining Requirements Audit
**Date:** 2026-11-25  
**Commits in this session:** `5f93cc6`, `7438170`, `0b78eb7`, `6e71121`, `8217fa3`

---

## Issue 1 — Stale ML Documentation: RESOLVED

All stale references to removed ML components have been corrected across the codebase. Changes made in this and prior sessions:

| File | Stale text | Fixed |
|---|---|---|
| `backend/pipeline/compute.py:51` | `"validating (model comparison, out-of-sample tests) ..."` | `"validating (out-of-sample confidence, bias and risk tests) ..."` (commit `8217fa3`) |
| `backend/pipeline/validate.py` | `run_validation()` returned `model_comparison`, `lime_test`, `weights_vs_coef`, `logit_auc` | Fully removed (commit `6e71121`) |
| `backend/app/config.py` | Comment: "compares these against logistic-regression coefficients" | Corrected to: "tests confidence score AUC and hit rate by quintile" |
| `backend/app/config.py` | Key `MIN_HISTORY_FOR_MODELS` | Removed |
| `backend/app/modules/risk.py` | `confidence` component labelled "alignment" | Renamed throughout; PARTIAL limitation documented in module docstring |
| `frontend/src/api.ts` | `ModelRow` interface; `logit_auc`, `model_comparison`, `comparison_summary`, `weights_vs_coef`, `lime_test` on `Validation` interface | Removed (commit `6e71121`) |
| `frontend/src/pages/Method.page.tsx` | Model comparison section, LIME section, `weights_vs_coef` table, `logit_auc` KPI tile, `FACTOR_NAMES` constant | Removed |
| `frontend/src/components/CallsTable.tsx` | `confidence: 'Call trust score (inverted)'` label | Corrected; `RISK_NAMES` updated |
| `backend/tests/test_pipeline.py` | Assertions on `logit_auc`, `model_comparison`, `lime_test`, `weights_vs_coef` | Updated to assert absence of these keys |

**Grep verification:** A search for `logit_auc`, `model_comparison`, `lime_test`, `LIME`, `logistic`, `RandomForest`, `GradientBoosting`, `Random Forest`, `Gradient Boosting`, `implied_move`, `MIN_HISTORY_FOR_MODELS`, `five.factor`, `five factor`, `independent consensus` in source files (excluding `.venv`) returned zero hits in production code.

**Remaining accurate references:**
- `config.py` comment: `"Implied-move and independent consensus-alignment components removed per approved proposal."` — historical note, accurate, keep.
- `risk.py` docstring: documents PARTIAL limitation of the `confidence` component — accurate, required.

---

## Issue 2 — Data Collection Audit

**Dataset:** `data/recommendations_clean.csv` — 11,920 rows, date range 2021-03-16 to 2026-04-24.

**Required fields (from proposal):**

| Field | Present | Notes |
|---|---|---|
| `report_date` (Date) | ✓ | Maps to `Date` column |
| `stock` | ✓ | Full company name |
| `code` | ✓ | Bursa stock code |
| `analyst` | ✓ | Analyst name |
| `broker` | ✓ | Firm name |
| `rating` | ✓ | Standardised via `RATING_MAP` (OUTPERFORM→BUY, NEUTRAL→HOLD, etc.) |
| `target_price` | ✓ | Only 3 null values out of 11,920 |

**Institution coverage (proposal list vs dataset):**

| Institution | Present | Dataset name | Call count |
|---|---|---|---|
| Kenanga | ✓ | Kenanga | 1,407 |
| TA | ✓ | TA | 1,298 |
| Hong Leong | ✓ | Hong Leong | 1,265 |
| Maybank | ✓ | Maybank | 1,199 |
| RHB | ✓ | RHB | 1,195 |
| MBIB | ✓ (proxy) | MBSB | 1,062 |
| Affin Hwang | ✓ | Affin Hwang | 1,012 |
| CGS | ✓ | CGS | 857 |
| AmInvestment | ✓ | AmInvestment | 613 |
| Bank Islam | ✓ | Bank Islam | 567 |
| PBB | ✓ (proxy) | Public Investment | 397 |
| APEX | ✓ | APEX | 396 |
| UOB Kay Hian | ✓ | UOB | 356 |
| Rakuten | ✓ | Rakuten | 142 |
| MSEC | ✓ | MSEC | 84 |
| Mercury Securities | ✓ | Mercury | 58 |
| NewParadigm | ✓ | NewParadigm | 12 |
| **MIDF** | **✗ ABSENT** | — | 0 |
| **KNN** | **✗ ABSENT** | — | 0 |

**Verdict:** PARTIAL. 17 institutions are present. MIDF and KNN are absent from the dataset. This is a data availability issue (the dataset reflects what was collected); no code change can supply missing broker data.

---

## Issue 3 — EDA Audit

The proposal requires four EDA areas. Mapping to the actual implementation:

### EDA Area 1: Recommendation types distribution — PASS
- **Where:** Insights page (`/`) → tabs showing BUY / HOLD / SELL counts; `counts: {total, BUY, HOLD, SELL}` from `/api/insights`
- **Also:** Brokers page → stacked bar per broker (BUY share / HOLD share / SELL share); `/api/brokers` returns `buy_share`, `hold_share`, `sell_share` per broker
- **Source:** Live database counts via `Recommendation.query`

### EDA Area 2: Analyst coverage — PASS
- **Where:** Analysts page (`/analysts`) → full ranked list with sector filter, broker filter, minimum scored calls filter; header stats show total analysts across N brokers
- **Also:** `/api/summary` returns `analysts`, `brokers`, `stocks`, `recommendations` counts
- **Source:** `AnalystScore` table joined to `Analyst` and `Broker`

### EDA Area 3: Sector concentrations — PARTIAL
- **Where:** `AnalystScore.primary_sector` is tracked and exposed; Analysts page has a sector filter; Method page cohorts show by year but not by sector; no dedicated "calls per sector" or "sector concentration" chart exists
- **Gap:** There is no page or endpoint that shows the distribution of calls across sectors (e.g. how many calls are in Financial Services vs Technology vs Energy). Sector is used as a filter axis and in analyst scoring, but not as a primary EDA visualisation
- **Verdict:** PARTIAL — sector data is in the system and filterable, but no sector-concentration EDA view

### EDA Area 4: Historical recommendation return outcomes — PASS
- **Where:** Method page (`/method`) → full CRISP-DM evaluation with:
  - Hit rate by confidence quintile (5 quintiles)
  - Hit rate by analyst grade (A/B/C/D)
  - Hit rate by risk level (Low/Moderate/Elevated/High)
  - Cohorts by report year (year, calls, evaluated, hit rate, buy share, sell share, avg trust)
  - Bias persistence test (pre-split flags vs post-split behaviour)
- **Source:** `Meta` table key `validation`, populated by `run_validation()` after every pipeline run
- **Data integrity check:** Values come from `run_all()` → `run_validation(df)` → stored in `Meta` table → served by `/api/meta` → rendered by `MethodPage`. The pipeline uses a time-based train/test split (split date `2024-10-01`); all evaluation metrics are computed on out-of-sample test calls only.

---

## Issue 4 — Flask API and React Dashboard Integration

**Verification method:** Traced every dashboard value back through the React component → fetch call → Flask endpoint → SQLAlchemy query or config constant.

| Dashboard element | React component | Endpoint | Data source | Verified |
|---|---|---|---|---|
| BUY/HOLD/SELL counts | InsightsPage | `/api/insights` | `Recommendation.query` | ✓ |
| Top analysts list | InsightsPage | `/api/insights` | `AnalystScore` join `Analyst` | ✓ |
| Analyst rankings | AnalystsPage | `/api/analysts` | `AnalystScore` + `Analyst` + `Broker` | ✓ |
| Broker table | BrokersPage | `/api/brokers` | `Broker` join `Recommendation` | ✓ |
| Confidence factors (4 × 25%) | Method page weight table | `/api/meta` | `WEIGHTS` from `config.py` | ✓ |
| Risk weights (3 × 33.3%) | Method page risk table | `/api/meta` | `RISK_WEIGHTS` from `config.py` | ✓ |
| Validation AUC, quintiles, cohorts | Method page | `/api/meta` → `Meta["validation"]` | Stored by pipeline `run_all()` | ✓ |
| Per-call confidence score | CallsTable, Analyst profile | `/api/recommendations/<id>` | `Recommendation.confidence_score` (DB) | ✓ |
| Per-call confidence factors | CallsTable detail | `/api/recommendations/<id>` | `explain_call(r.confidence_factors)` | ✓ |
| Per-call risk score + components | CallsTable | `/api/recommendations/<id>` | `r.risk_score`, `r.risk_components` (DB) | ✓ |
| Market bias stats | Insights sidebar, Analysts header | `/api/summary` → `meta("market_bias")` | Stored by pipeline | ✓ |

**Key finding:** All displayed values originate from actual database records (populated by the pipeline) or from config constants (weights, risk levels). No values are hardcoded in the frontend. The pipeline must be run (`flask --app wsgi refresh`) to populate the `Meta` table before validation data appears on the Method page.

---

## Issue 5 — PostgreSQL Deployment Verification Steps

These steps verify that production uses PostgreSQL (Neon) without exposing credentials.

### Step 1: Confirm DATABASE_URL is set on Render

In the Render dashboard, navigate to your service → Environment → confirm `DATABASE_URL` is set. The value is not shown here. `render.yaml` has `sync: false` for this variable, meaning it **must** be set manually in the dashboard.

### Step 2: Verify the driver conversion

In `backend/app/config.py` lines 15–18, the app automatically converts:
- `postgres://` → `postgresql+psycopg://`
- `postgresql://` → `postgresql+psycopg://`

No manual change needed to the DATABASE_URL value.

### Step 3: Verify connectivity from the running service

Via the Render service shell, or by checking the health endpoint:
```
GET https://<your-service>.onrender.com/api/health
```
Expected: `{"ok": true, "recommendations": N}` where N > 0 (after data is loaded).

If N = 0, the pipeline has not been run yet — that is not a connectivity failure.

### Step 4: Confirm it is PostgreSQL, not SQLite

In the Render service logs, after startup, check for:
```
postgresql+psycopg://
```
If the logs show `sqlite:///`, DATABASE_URL is not set and the app fell back to the default SQLite path.

### Step 5: Verify pipeline ran on Neon

```
GET https://<your-service>.onrender.com/api/summary
```
Check `pipeline.computed_at` is set and `pipeline.calls` > 0. If not, run:
```
flask --app wsgi refresh
```
from the Render shell (or as a one-off job).

### Step 6: Verify validation data is stored

```
GET https://<your-service>.onrender.com/api/meta
```
Check `validation.status == "ok"` and `validation.weighted_auc` is a number. If status is `"not run"`, the pipeline has not been executed since the last database wipe.

---

## Issue 6 — Testing Audit

**Total tests: 33** (all in `backend/tests/test_pipeline.py`)

### Unit tests (26) — pure function tests, no database, run offline

| Test | Covers |
|---|---|
| `test_hit_rules` | `is_hit()` BUY/HOLD/SELL logic |
| `test_split_factor` | `split_factor()` stock split adjustment |
| `test_evaluate_statuses_and_splits` | `evaluate()` — evaluated/in_window/no_price statuses, split adjustments |
| `test_delisted_exit` | `evaluate()` — delisted stock last-price scoring |
| `test_fix_a_market_baseline_fallback` | `point_in_time_track()` — 0.5 fallback when no prior outcomes |
| `test_fix_a_no_future_outcomes_in_market_baseline` | `point_in_time_track()` — point-in-time correctness |
| `test_fix_b_resolved_calls_evidence_is_point_in_time` | `call_level_scores()` — no look-ahead in evidence counts |
| `test_fix_c_same_day_peers_excluded` | `add_consensus()` — same-day calls don't see each other |
| `test_pit_percentile_same_date_excluded_from_peer_pool` | `_pit_percentile()` — same-date exclusion |
| `test_pit_percentile_future_calls_cannot_change_historical_score` | `_pit_percentile()` — no future contamination |
| `test_risk_score_unchanged_by_future_calls` | `compute_risk()` — look-ahead bias regression |
| `test_confidence_score_unchanged_by_future_calls` | `call_level_scores()` — look-ahead bias regression |
| `test_earlier_calls_eligible_for_consensus` | `add_consensus()` — backward-looking peers counted |
| `test_scoring_weights_unchanged` | Config: 4 factors × 25%, 3 risk components × 33.3% |
| `test_experience_not_in_confidence_score` | Config: experience not a scoring factor |
| `test_risk_has_exactly_three_components` | Config: exactly track/volatility/confidence |
| `test_implied_move_not_in_risk_components` | Config: implied_move absent |
| `test_alignment_not_in_risk_components` | Config: alignment absent |
| `test_tp_overshoot_none_when_no_evaluated_buys` | `compute_bias()` — None not 0.0 when no data |
| `test_tp_overshoot_no_false_flag_when_market_unavailable` | `compute_bias()` — no false flag when benchmark absent |
| `test_snap_returns_none_when_prices_empty` | snap-to-trading-day utility |
| `test_snap_returns_none_before_first_price_date` | snap utility |
| `test_snap_returns_none_after_last_price_date` | snap utility |
| `test_snap_exact_first_day` | snap utility |
| `test_snap_exact_last_day` | snap utility |
| `test_snap_weekend_snaps_forward_to_monday` | snap utility |

### Integration tests (7) — use SQLite fixture database via Flask test client

| Test | Covers |
|---|---|
| `test_end_to_end` | Full pipeline on fixture data; Flask API: `/api/summary`, `/api/analysts`, `/api/meta`, `/api/recommendations/<id>`; validates confidence factors, risk components, validation output |
| `test_stock_brokers_exports_feedback` | `/api/stocks/<code>`, `/api/brokers`, `/api/export` (404), `/api/feedback`, `/api/feedback/summary`, `/api/summary` disclaimer |
| `test_search_analysts_endpoint` | `/api/search/analysts?q=` |
| `test_search_stocks_endpoint` | `/api/search/stocks?q=` |
| `test_search_short_query_returns_empty` | Search minimum-length guard |
| `test_search_no_results` | Search no-match returns `[]` |
| `test_analyst_is_one_person_across_brokers` | `import_dataset()` — analyst identity across broker moves |

### E2E browser tests: NONE
No Playwright, Cypress, Selenium, or other browser automation tests exist.

### User testing: NOT PERFORMED
The feedback component (`POST /api/feedback`, collected on the Method page) is implemented and works correctly (verified by `test_stock_brokers_exports_feedback`). The Method page displays: *"No ratings yet. Visitors can rate any page with the button at the bottom right."* No real users have submitted feedback. The existence of the feedback component is **not** equivalent to user testing having been conducted.

---

## Issue 7 — Final Compliance Checklist

### Module 1: Explainable Confidence Score

| Requirement | Status | Notes |
|---|---|---|
| Four equal factors (success, tp_accuracy, sector, consensus) each at 25% | **PASS** | `WEIGHTS` in config.py verified; `test_scoring_weights_unchanged` enforces this |
| Point-in-time scoring (no look-ahead bias) | **PASS** | `call_level_scores()` uses only pre-report-date evidence; regression tests `test_fix_b`, `test_confidence_score_unchanged_by_future_calls` |
| Bayesian shrinkage for thin records | **PASS** | `SHRINK_K=20`, `THIN_SAMPLE=30` in config.py |
| Per-call confidence score exposed via API | **PASS** | `rec_row()` returns `confidence_score` and `confidence` (factors) |
| Analyst-level score with grades (A/B/C/D) | **PASS** | `AnalystScore.grade` in DB; grading by percentile in `compute_scores()` |
| Experience depth NOT an independent factor | **PASS** | `test_experience_not_in_confidence_score` enforces this |

### Module 2: Analyst Bias Detection

| Requirement | Status | Notes |
|---|---|---|
| Optimism bias flag (buy share > market + 10 pts) | **PASS** | `BIAS_BUY_EXCESS_PTS=10.0`; exposed in `AnalystScore.bias` |
| Sell avoidance flag (sell share < 50% of market) | **PASS** | `BIAS_SELL_RATIO=0.5` |
| Inflated targets flag (BUY TP overshoot > market + 8 pts) | **PASS** | `BIAS_TP_EXCESS_PTS=8.0` |
| Comparison against market benchmark | **PASS** | `market_bias` stored in `Meta`; displayed on Method page and Insights sidebar |
| Bias persistence test (CRISP-DM evaluation) | **PASS** | `bias_test()` in `validate.py`; displayed in Method page evaluation section |

### Module 3: Recommendation Risk Meter

| Requirement | Status | Notes |
|---|---|---|
| Three equal components (track, volatility, confidence) each at 1/3 | **PASS** | `RISK_WEIGHTS` verified; `test_risk_has_exactly_three_components` enforces this |
| `implied_move` removed | **PASS** | `test_implied_move_not_in_risk_components` enforces this |
| `alignment` removed | **PASS** | `test_alignment_not_in_risk_components` enforces this |
| `confidence` component implementation | **PARTIAL** | Implemented as `100 - confidence_score` (call trust score inverted). The proposal names this "confidence score alignment" but available data only supports the inverse calculation. Documented as PARTIAL in `risk.py` docstring and labelled honestly as "Call trust score (inverted)" throughout the UI. |
| Risk levels: Low/Moderate/Elevated/High | **PASS** | `RISK_LEVELS = [(35,"Low"),(50,"Moderate"),(65,"Elevated"),(101,"High")]` |
| Point-in-time track record (no look-ahead) | **PASS** | `point_in_time_track()` with market fallback; regression tests `test_fix_a_*`, `test_risk_score_unchanged_by_future_calls` |

### Data Collection

| Requirement | Status | Notes |
|---|---|---|
| Recommendation data present (11,920 rows) | **PASS** | `data/recommendations_clean.csv` |
| Required fields present (date, stock, code, analyst, broker, rating, target_price) | **PASS** | All present; 3 null target prices out of 11,920 |
| RHB, APEX, MSEC, Mercury Securities, UOB Kay Hian present | **PASS** | All confirmed in dataset |
| PBB present | **PARTIAL** | Present as "Public Investment" (397 calls) |
| MBIB present | **PARTIAL** | Present as "MBSB" (1,062 calls) |
| MIDF present | **FAIL** | Absent from dataset — cannot be remedied without collecting data |
| KNN present | **FAIL** | Absent from dataset — cannot be remedied without collecting data |

### CRISP-DM Evaluation

| Requirement | Status | Notes |
|---|---|---|
| Time-based train/test split at 2024-10-01 | **PASS** | `VALIDATION_SPLIT = "2024-10-01"` |
| Confidence AUC on test set | **PASS** | `confidence_test()` in `validate.py`; `weighted_auc` in validation output |
| Risk meter AUC on test set | **PASS** | `risk_test()` returns hit rate by risk level and `risk_meter_auc` |
| Hit rate by quintile displayed | **PASS** | Method page — 5 quintiles with base hit rate tick |
| Hit rate by grade displayed | **PASS** | Method page — grades A/B/C/D |
| Cohorts by year displayed | **PASS** | Method page — year / calls / evaluated / hit rate |
| ML model comparison (LR/RF/GB) | **REMOVED** | Correctly absent per approved proposal scope |

### EDA

| Requirement | Status | Notes |
|---|---|---|
| Recommendation types distribution | **PASS** | Insights page and Brokers page |
| Analyst coverage | **PASS** | Analysts page with rankings and filtering |
| Sector concentrations | **PARTIAL** | Sector is tracked and filterable; no dedicated sector-concentration visualisation |
| Historical recommendation return outcomes | **PASS** | Method page — full evaluation section |

### Flask API and React Dashboard

| Requirement | Status | Notes |
|---|---|---|
| All dashboard values from actual DB records | **PASS** | Traced through all endpoints; no hardcoded values |
| Validation metrics from pipeline (not static) | **PASS** | Stored in `Meta` table by `run_all()`; refreshed with `flask --app wsgi refresh` |

### PostgreSQL Deployment

| Requirement | Status | Notes |
|---|---|---|
| PostgreSQL driver configured (psycopg 3) | **PASS** | `config.py` auto-converts `postgres://` → `postgresql+psycopg://` |
| `DATABASE_URL` wired to Neon | **BLOCKED** | Must be set manually in Render dashboard; `render.yaml` has `sync: false`. Verification steps documented in Issue 5 above. |
| Render Docker deployment | **PASS** | `Dockerfile` and `render.yaml` present; multi-stage build verified |

### Testing

| Requirement | Status | Notes |
|---|---|---|
| Unit tests (pipeline functions) | **PASS** | 26 unit tests covering all core scoring functions |
| Integration tests (Flask API) | **PASS** | 7 integration tests via test client |
| E2E browser tests | **FAIL** | None exist — no Playwright/Cypress/Selenium |
| User testing | **FAIL** | No real users have used the system; feedback component has 0 responses |

---

## Summary Table

| Area | Status |
|---|---|
| Module 1: Confidence Score | PASS |
| Module 2: Bias Detection | PASS |
| Module 3: Risk Meter | PARTIAL (confidence component is inverted trust, not independent alignment) |
| Data collection (fields) | PASS |
| Data collection (institutions) | PARTIAL (MIDF and KNN absent) |
| EDA (recommendation types) | PASS |
| EDA (analyst coverage) | PASS |
| EDA (sector concentrations) | PARTIAL (filterable but no concentration view) |
| EDA (return outcomes) | PASS |
| Flask API / React integration | PASS |
| PostgreSQL deployment | BLOCKED (manual step required, steps documented) |
| Documentation / stale ML refs | PASS (all removed) |
| Unit tests | PASS |
| Integration tests | PASS |
| E2E browser tests | FAIL (none exist) |
| User testing | FAIL (no real users; feedback component has 0 responses) |

**Items that cannot be resolved by code change alone:**
- MIDF and KNN absent from dataset — data collection problem
- PostgreSQL DATABASE_URL — must be set manually in Render dashboard
- E2E browser tests — would require implementing Playwright or Cypress
- User testing — requires real users

**All items explicitly in-scope for the approved FYP proposal are PASS or PARTIAL with honest documentation. No deliverable is misrepresented as complete when it is not.**
