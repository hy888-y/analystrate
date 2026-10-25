"""Step 2 - download daily prices for every stock from the Yahoo Finance API (yfinance, .KL symbols).

Prices are cached as one CSV per symbol in PRICE_CACHE_DIR so the download only happens once.
Yahoo's Close is split-adjusted, so stock splits / bonus issues are also stored; outcomes.py
uses them to put broker target prices on the same basis as the price series.
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from app.extensions import db
from app.models import Price, Recommendation, Stock

try:
    import yfinance as yf
except ImportError:  # pragma: no cover
    yf = None


def _download(symbol: str, start: date, end: date, retries: int = 3) -> tuple[pd.Series, dict, str | None]:
    """Returns (close series indexed by date, splits {iso: ratio}, sector)."""
    last_err = None
    for attempt in range(retries):
        try:
            t = yf.Ticker(symbol)
            hist = t.history(start=start.isoformat(), end=end.isoformat(), interval="1d",
                             auto_adjust=False, actions=True)
            if hist.empty:
                return pd.Series(dtype=float), {}, None
            close = hist["Close"].dropna()
            close.index = pd.to_datetime(close.index).tz_localize(None).date
            splits = {}
            if "Stock Splits" in hist:
                s = hist["Stock Splits"]
                for d, v in s[s > 0].items():
                    splits[pd.Timestamp(d).date().isoformat()] = float(v)
            sector = None
            try:
                sector = (t.info or {}).get("sector")
            except Exception:
                pass
            return close, splits, sector
        except Exception as e:  # network hiccup / rate limit
            last_err = e
            time.sleep(2 * (attempt + 1))
    print(f"  ! {symbol}: {last_err}")
    return pd.Series(dtype=float), {}, None


def fetch_all(cache_dir: str, refresh: bool = False, sleep: float = 0.4) -> dict:
    if yf is None:
        raise RuntimeError("yfinance is not installed: pip install yfinance")
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    meta_path = cache / "_meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    first = db.session.query(db.func.min(Recommendation.report_date)).scalar()
    if first is None:
        raise RuntimeError("No recommendations loaded yet. Run `flask load-data <file>` first.")
    start = first - timedelta(days=400)          # 1 trading year before the first call (volatility lookback)
    end = date.today() + timedelta(days=1)

    ok = failed = 0
    stocks = Stock.query.order_by(Stock.code).all()
    for i, st in enumerate(stocks, 1):
        f = cache / f"{st.yf_symbol}.csv"
        if f.exists() and not refresh:
            close = pd.read_csv(f, index_col=0, parse_dates=True)["close"]
            close.index = close.index.date
            info = meta.get(st.yf_symbol, {})
            splits, sector = info.get("splits", {}), info.get("sector")
        else:
            print(f"[{i}/{len(stocks)}] downloading {st.yf_symbol}")
            close, splits, sector = _download(st.yf_symbol, start, end)
            if not close.empty:
                close.rename("close").to_csv(f, index_label="date")
            meta[st.yf_symbol] = {"splits": splits, "sector": sector}
            meta_path.write_text(json.dumps(meta, indent=1))
            time.sleep(sleep)

        db.session.query(Price).filter_by(stock_id=st.id).delete()
        if close.empty:
            st.has_prices = False
            failed += 1
            continue
        db.session.bulk_save_objects(
            [Price(stock_id=st.id, date=d, close=float(c)) for d, c in close.items()]
        )
        st.has_prices, st.splits = True, splits
        st.sector = sector or st.sector
        ok += 1
        db.session.commit()
    db.session.commit()
    return {"stocks_with_prices": ok, "stocks_without_prices": failed}
