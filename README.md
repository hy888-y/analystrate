# Analyst Recommendation Reliability Rating System (Bursa Malaysia)

FYP Part 2 implementation for Pang Han Yong (TP071603), APU, supervised by Ms. Lai Chew Ping.
Stack from the IR: **Python · Flask · PostgreSQL · React.js · Yahoo Finance API (yfinance)**.

```
fyp-analyst-reliability/
├─ backend/                 Flask REST API + data pipeline
│  ├─ app/
│  │  ├─ config.py          ALL weights / thresholds of the 3 modules (one place to tune)
│  │  ├─ models.py          PostgreSQL schema: broker, analyst, stock, price, recommendation, analyst_score, feedback
│  │  ├─ api/routes.py      /api/... analysts, recommendations, meta
│  │  ├─ api/market.py      /api/... insights, stocks, brokers, CSV export, feedback
│  │  └─ modules/
│  │     ├─ confidence.py   Module 1 – Explainable Confidence Score
│  │     ├─ bias.py         Module 2 – Analyst Bias Detection
│  │     └─ risk.py         Module 3 – Recommendation Risk Meter
│  ├─ pipeline/
│  │  ├─ load_dataset.py    step 1: import the cleaned CSV/XLSX from IR Chapter 3
│  │  ├─ prices.py          step 2: download .KL prices + splits + sectors (yfinance, cached)
│  │  ├─ outcomes.py        step 3: 12-month outcome of every call, consensus
│  │  ├─ compute.py         step 4: runs outcomes + 3 modules and saves results
│  │  ├─ validate.py        CRISP-DM Evaluation: model comparison, out-of-sample tests, LIME, min calls
│  │  └─ copy_db.py         copy the whole database (SQLite -> PostgreSQL, laptop -> hosted)
│  └─ tests/                pytest (offline, uses generated fixture data)
├─ frontend/                React + Vite + Mantine dashboard
│  └─ src/pages/            Insights · Analysts · Analyst profile · Stocks · Brokers · Screener · Method
├─ data/                    put your cleaned dataset here; prices are cached in data/prices/
├─ Dockerfile, render.yaml  public deployment (one server for the website + API)
```

## What the system does, mapped to the IR

| IR promise | Where it is in the system |
|---|---|
| Obj 1: store analyst, bank, stock code, rating, target, date in a relational DB (PostgreSQL, 2.4.5) | `models.py`; runs on PostgreSQL (`DATABASE_URL`), `copy-db` moves existing data |
| Obj 2: Yahoo Finance prices, 12-month outcome of every call | `pipeline/prices.py`, `pipeline/outcomes.py` |
| Obj 3: Explainable Confidence Score, a *recommendation trust score* with factor explanations | analyst score (`compute_scores`) + per-call trust score known on the call date (`call_level_scores`); TRUST column and "Why trust this call?" on every call |
| Obj 4: Bias Detection + Risk Meter, public dashboard (React + Flask) | `bias.py`, `risk.py`; Flask serves the built React site; `Dockerfile` / `render.yaml` |
| 1.2: an analyst's record on the stock / sector you invest in | stock page: "On MAYBANK: 5/10 played out · Financial Services: 61%"; analyst page: record by sector |
| 1.5.3: not a stock recommender, not financial advice | footer on every page, `/api/summary` disclaimer |
| 1.6.1 / 1.5.4: cleaned dataset as a public resource for investors, students, researchers | CSV downloads (`/api/export/...`) |
| 2.2.2: buy share, sell avoidance, average target deviation vs market; buy-to-sell ratio | `bias.py` (average deviation, each capped at ±100%) |
| 2.2.3: risk = stock-specific track record, volatility, score alignment; graded, per call | `risk.py`: track, volatility, implied move, trust score, alignment with consensus |
| 2.2.4: score breakdown panel with each factor's contribution | analyst page "Why this score", call row "Why trust this call?" |
| 2.2.5: weighted-factor model; logistic regression coefficients compared with the weights | Method page: model comparison + weights vs coefficients |
| Table 3: analyst = unit of evaluation; broker for institution-level analysis | one analyst per person (240 after trimming a trailing-space duplicate of the 241 raw names); Brokers page |
| 3.2.1 Process 5: scores, bias detection and risk meter checked against realised 12-month outcomes | `validate.py`: trust-score quintiles, grades, bias persistence, risk levels (time split) |
| 3.2.1 Process 6: deployment + maintenance | `flask --app wsgi refresh`; public deployment below |
| 3.5.9: report year for cohort analysis | Method page cohorts, analyst page "Record by report year" |
| 4.3: delisted rule · weighting validated · LIME compared · min calls for a meaningful score · usability | `delisted_exit` · model comparison · LIME test · min-calls table (30) · "Rate this page" feedback |

## 1. One-time setup (Windows 11, PowerShell)

Install: Python 3.11+, Node.js 20+, PostgreSQL 16 (remember the password you set for `postgres`).

```powershell
# database
psql -U postgres -c "CREATE DATABASE analyst_reliability;"

# backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env        # then edit the password in DATABASE_URL

# frontend
cd ..\frontend
npm install
```

## 2. Load your data and compute the ratings

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
flask --app wsgi load-data ..\data\recommendations_clean.csv    # your 11,920-row file (.csv or .xlsx)
flask --app wsgi fetch-prices      # first run downloads ~426 stocks from Yahoo (10–20 min), then cached
flask --app wsgi compute           # outcomes + confidence + bias + risk + validation
```

`load-data` matches column names loosely (Date, Stock, Code, Analyst, Broker, Rating, Target Price, EPS(F), DPS(F)),
so the export from the Chapter 3 notebook works as-is. Re-run `compute` whenever you change a weight in `app/config.py`.
Maintenance: `flask --app wsgi refresh` downloads the newest prices and recomputes everything.

### Moving existing data into PostgreSQL

If your data is already computed in SQLite, copy it instead of recomputing:

```powershell
flask --app wsgi copy-db "postgresql://postgres:YOUR_PASSWORD@localhost:5432/analyst_reliability"
```

then set that URL as `DATABASE_URL` in `backend\.env`.

## 3. Run the website

Two terminals:

```powershell
# terminal 1
cd backend; .\.venv\Scripts\Activate.ps1; python wsgi.py     # API on http://127.0.0.1:5000

# terminal 2
cd frontend; npm run dev                                       # site on http://localhost:5173
```

## 4. Public website (IR Objective 4), free

Free combination: **Render** free web service (runs the Dockerfile: React site + Flask API on one URL;
sleeps after ~15 min idle, ~1 min to wake) + **Neon** free PostgreSQL (1 GB, does not expire).
Render's own free PostgreSQL is deleted after 30 days, so it is not used.

1. Neon (neon.com): sign up → create a project → copy the connection string (`postgresql://...`).
2. Load your computed data into it, from the laptop:
   ```powershell
   cd backend; .\.venv\Scripts\Activate.ps1
   python -m flask --app wsgi copy-db "<Neon connection string>"
   ```
3. Push the project to GitHub (data/prices, *.db and .env are excluded by .gitignore).
4. Render (render.com): New → **Blueprint** → pick the repo → paste the Neon string as `DATABASE_URL`.
5. The public address looks like `https://analystrate.onrender.com`.

Without Docker, `npm run build` once in `frontend` and `python wsgi.py` also serves the full site on http://127.0.0.1:5000.

## 5. Tests

```powershell
cd backend; pytest -q
```

## API

| Endpoint | Returns |
|---|---|
| `GET /api/summary` | dataset counts, market hit rate, market buy-to-sell |
| `GET /api/analysts?q=&sector=&broker=&min_calls=&sort=score` | ranked analysts |
| `GET /api/analysts/{id}` | score + factor breakdown (value × weight = points), bias vs market |
| `GET /api/analysts/{id}/recommendations?limit=&offset=` | calls with outcome and risk meter |
| `GET /api/stocks?q=` / `GET /api/stocks/{code}` | stock search / all calls on a stock |
| `GET /api/meta` | weights, risk levels, full evaluation (model comparison, tests, LIME, min calls, cohorts) |
| `GET /api/brokers` | per-broker calls, hit rate, rating mix, average trust |
| `GET /api/export/recommendations.csv` · `/api/export/analysts.csv` | open data downloads |
| `POST /api/feedback` · `GET /api/feedback/summary` | anonymous usability ratings |

## Design decisions to justify in the final report

- **No look-ahead in the risk meter**: an analyst's track record for a call only uses calls whose 12-month window had already closed before that call date.
- **Thin samples**: hit rates are shrunk toward the market rate (Bayesian average, k = 20). This answers IR 4.3's "how many calls are needed" point. Fewer than 30 scored calls gets a "thin sample" tag.
- **Stock splits/bonus issues**: Yahoo prices are split-adjusted, broker targets are not. Targets are put on the same basis using Yahoo's split history.
- **Delisted/suspended stocks** (IR 4.3): scored at the last traded price and tagged `delisted_exit`.
- **Grades** are relative to peers: A top 20%, B next 30%, C next 30%, D bottom 20%.
- **Weights** are the hand-set values in `config.py`. `validate.py` uses a time split (`VALIDATION_SPLIT`, 1 Oct 2024): the weighted score, logistic regression, random forest and gradient boosting are compared on the same five call-level factors, and every check (grades, bias flags, risk levels) uses only information from before the split.
- **Trust score per call** uses only information available on the call date (resolved calls, peers' views in the previous 90 days), so it can be shown on any call without hindsight.

## Credits (open-source code and ideas reused)

- **dbondi/analyst_recommendation_performance** (MIT, © 2021 Daniel Bondi). The forward-window outcome method in `pipeline/outcomes.py` is adapted from its `calculate_performance()`. https://github.com/dbondi/analyst_recommendation_performance
- **omerdr/stocks**. The target-price error metric |P12 − TP| / P0 and the comparison against consensus error (`rank_analysts.py`, `calc_normalized_accuracy.py`). Only the formula is reused; no code was copied, since the repo has no licence. https://github.com/omerdr/stocks
- **mantinedev/vite-template**. The frontend scaffold (React + Vite + TypeScript + Mantine). https://github.com/mantinedev/vite-template
- **Mantine** (MIT) UI and charts, **Flask** application-factory pattern from the official Flask tutorial, **yfinance** (Apache-2.0).

This system rates the reliability of published analyst recommendations. It is not a stock recommender and not financial advice.
