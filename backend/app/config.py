"""Central settings. Every tunable number of the three modules lives here,
so the weights can be changed (and justified in the report) in one place."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")   # read .env BEFORE Config below, so `python wsgi.py` and `flask` use the same DB

# A relative SQLite path ("sqlite:///x.db") would point at different files depending on how the app
# is started, so always resolve it to backend/instance/x.db (where `flask --app wsgi ...` puts it).
_db = os.getenv("DATABASE_URL", "sqlite:///analyst_reliability.db")
# hosting providers hand out postgres:// or postgresql:// URLs; this project uses the psycopg 3 driver
if _db.startswith("postgres://"):
    _db = "postgresql://" + _db[len("postgres://"):]
if _db.startswith("postgresql://"):
    _db = "postgresql+psycopg://" + _db[len("postgresql://"):]
if _db.startswith("sqlite:///") and not os.path.isabs(_db[len("sqlite:///"):]):
    _db = f"sqlite:///{(BASE_DIR / 'instance' / _db[len('sqlite:///'):]).as_posix()}"
    (BASE_DIR / "instance").mkdir(exist_ok=True)


class Config:
    SQLALCHEMY_DATABASE_URI = _db
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    PRICE_CACHE_DIR = os.getenv("PRICE_CACHE_DIR", str(BASE_DIR.parent / "data" / "prices"))


# ---------- Outcome evaluation (IR 2.2.3) ----------
EVAL_MONTHS = 12            # 12-month target-price horizon used by Malaysian brokers
HOLD_BAND = 0.10            # HOLD is a hit if |12m return| <= 10%
PRICE_MATCH_DAYS = 7        # nearest trading day must be within 7 calendar days

# ---------- Explainable Confidence Score (IR 2.2.4 / 2.2.5) ----------
# Transparent weighted-factor model. Weights sum to 1.0.
# Part 2 evaluation compares these against logistic-regression coefficients (pipeline/validate.py).
WEIGHTS = {
    "success": 0.30,      # historical success rate (shrunk toward market mean)
    "tp_accuracy": 0.25,  # target price accuracy
    "experience": 0.15,   # depth of evaluated track record
    "sector": 0.15,       # success inside the analyst's main sector
    "consensus": 0.15,    # agreement with peers on the same stock
}
FACTOR_LABELS = {
    "success": ("Historical success rate", "Share of evaluated calls that played out as stated"),
    "tp_accuracy": ("Target price accuracy", "How close targets landed to the 12-month price"),
    "experience": ("Experience depth", "Number of evaluated calls (log-scaled)"),
    "sector": ("Sector consistency", "Hit rate inside the analyst's main sector"),
    "consensus": ("Consensus consistency", "Agreement with other analysts on the same stock"),
}
SHRINK_K = 20               # Bayesian shrinkage: a thin record is pulled toward the market hit rate
THIN_SAMPLE = 30            # fewer evaluated calls than this -> "thin sample" tag
CONSENSUS_WINDOW_DAYS = 90  # peer calls within +/-90 days count as the consensus

# ---------- Analyst Bias Detection (IR 2.2.2) ----------
BIAS_BUY_EXCESS_PTS = 10.0       # buy share > market + 10 pts -> optimism bias
BIAS_SELL_RATIO = 0.5            # sell share < 50% of market -> sell avoidance
BIAS_TP_EXCESS_PTS = 8.0         # BUY target overshoot > market + 8 pts -> inflated targets

# ---------- Recommendation Risk Meter (IR 2.2.3) ----------
# IR 2.2.3: stock-specific track record, price volatility and score alignment, plus the size of the
# promised move and the call's own trust score. Weights sum to 1.0.
RISK_WEIGHTS = {"track": 0.30, "volatility": 0.25, "implied_move": 0.15, "confidence": 0.15, "alignment": 0.15}
RISK_LEVELS = [(35, "Low"), (50, "Moderate"), (65, "Elevated"), (101, "High")]
VOL_LOOKBACK_DAYS = 252     # trailing trading days used for volatility at the call date
MIN_STOCK_TRACK = 3         # need >=3 earlier evaluated calls on the stock to use stock-level record

# ---------- CRISP-DM Evaluation (IR 3.2.1 Process 5, 2.2.5) ----------
# Time-based split: models and grades are built only from information before this date and tested on
# calls made after it. The dataset is mostly 2023-2026, so the first calls with any resolved history
# appear in 2024; the split sits where both sides have enough evaluated calls with history.
VALIDATION_SPLIT = "2024-10-01"
# The model comparison uses calls whose analyst already had at least this many scored calls on the
# call date; before that every factor is only the market default and carries no information.
MIN_HISTORY_FOR_MODELS = 1

# ---------- Data downloads ----------
# CSV export of all calls / analyst scores. Switched off: the public website does not offer downloads.
OPEN_DATA = False
