"""Step 3 - 12-month realised outcome of every recommendation (IR 2.2.3, CRISP-DM Modelling).

The forward-window evaluation is adapted from `calculate_performance()` in
dbondi/analyst_recommendation_performance (MIT licence, (c) 2021 Daniel Bondi):
price at the report date vs price `performance_test_period` months later, matched to the
nearest trading day. Changes for this project: fixed 12-month window, BUY/HOLD/SELL hit
rules, split adjustment of the broker's target price, a rule for delisted/suspended stocks,
and the target-price error metric |P12 - TP| / P0 from omerdr/stocks (rank_analysts.py).
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.config import CONSENSUS_WINDOW_DAYS, EVAL_MONTHS, HOLD_BAND, PRICE_MATCH_DAYS, VOL_LOOKBACK_DAYS

OUTCOME_COLS = ["status", "eval_end_date", "entry_price", "price_12m", "return_12m", "hit",
                "tp_error", "volatility", "note"]


def split_factor(splits: dict | None, d: date) -> float:
    """Yahoo divides prices before a split by its ratio. Multiply an adjusted price at date d by
    this factor to get the price as quoted on day d (the basis the broker's target was set on)."""
    f = 1.0
    for iso, ratio in (splits or {}).items():
        if date.fromisoformat(iso) > d and ratio > 0:
            f *= ratio
    return f


def is_hit(rating: str, ret: float) -> bool:
    if rating == "BUY":
        return ret > 0
    if rating == "SELL":
        return ret < 0
    return abs(ret) <= HOLD_BAND


def evaluate(recs: pd.DataFrame, prices: dict[int, pd.Series], splits: dict[int, dict], as_of: date) -> pd.DataFrame:
    """recs needs: id, stock_id, report_date (date), rating, target_price.
    prices: stock_id -> close Series indexed by date (ascending). Returns recs + OUTCOME_COLS."""
    out = recs.copy()
    for c in OUTCOME_COLS:
        out[c] = None
    tol = np.timedelta64(PRICE_MATCH_DAYS, "D")

    for stock_id, grp in out.groupby("stock_id"):
        s = prices.get(stock_id)
        for i, r in grp.iterrows():
            d = r["report_date"]
            end = (pd.Timestamp(d) + pd.DateOffset(months=EVAL_MONTHS)).date()
            out.at[i, "eval_end_date"] = end
            if s is None or s.empty:
                out.at[i, "status"], out.at[i, "note"] = "no_price", "no_price_history"
                continue
            idx = np.asarray(pd.to_datetime(s.index).values, dtype="datetime64[D]")
            vals = s.to_numpy(dtype=float)
            d64, end64 = np.datetime64(d, "D"), np.datetime64(end, "D")

            p = int(np.searchsorted(idx, d64, "left"))      # first trading day on/after the report
            if p >= len(idx) or idx[p] - d64 > tol:
                out.at[i, "status"], out.at[i, "note"] = "no_price", "no_price_at_report_date"
                continue
            f = split_factor(splits.get(stock_id), d)
            entry = vals[p] * f
            out.at[i, "entry_price"] = round(entry, 4)

            window = vals[max(0, p - VOL_LOOKBACK_DAYS): p + 1]
            if len(window) >= 60:
                lr = np.diff(np.log(window[window > 0]))
                out.at[i, "volatility"] = float(lr.std(ddof=1) * np.sqrt(252)) if len(lr) > 2 else None

            if end > as_of:
                out.at[i, "status"] = "in_window"
                continue
            q = int(np.searchsorted(idx, end64, "right")) - 1  # last trading day on/before the end date
            note = None
            if idx[-1] < end64 - tol:                          # series stopped: delisted / suspended
                q, note = len(idx) - 1, "delisted_exit"
            if q < p:
                out.at[i, "status"], out.at[i, "note"] = "no_price", "no_price_at_end_date"
                continue
            p12 = vals[q] * f
            ret = p12 / entry - 1
            tp = r["target_price"]
            out.at[i, "status"] = "evaluated"
            out.at[i, "price_12m"] = round(p12, 4)
            out.at[i, "return_12m"] = float(ret)
            out.at[i, "hit"] = bool(is_hit(r["rating"], ret))
            out.at[i, "tp_error"] = min(1.0, float(abs(p12 - tp) / entry)) if pd.notna(tp) and tp else None
            out.at[i, "note"] = note if note else (None if pd.notna(tp) and tp else "no_target")
    return out


def add_consensus(df: pd.DataFrame) -> pd.DataFrame:
    """Consensus = other analysts' calls on the same stock within +/-CONSENSUS_WINDOW_DAYS.
    consensus_agree: own rating equals the peers' most common rating (used for the analyst-level factor).
    consensus_tp_error: |P12 - mean peer target| / P0 (omerdr/stocks relative accuracy, r_c).

    Point-in-time version (used by the per-call trust score and the risk meter, so nothing from the
    future is used): only peers whose call was published in the CONSENSUS_WINDOW_DAYS *strictly before*
    this call (same-day peers excluded, as publication timestamps within a day are unavailable),
    keeping each peer analyst's latest view.
      peer_n      number of other analysts with a view on the stock at the call date
      peer_share  share of them holding the same rating as this call (0-1)
      peer_view   the peers' most common rating"""
    out = df.copy()
    for c in ("consensus_agree", "consensus_tp_error", "peer_n", "peer_share", "peer_view"):
        out[c] = None
    win = np.timedelta64(CONSENSUS_WINDOW_DAYS, "D")
    for _, g in out.groupby("stock_id"):
        g = g.sort_values("report_date")
        dates = pd.to_datetime(g["report_date"]).to_numpy().astype("datetime64[D]")
        analysts = g["analyst_id"].to_numpy()
        ratings = g["rating"].to_numpy()
        for pos, (i, r) in enumerate(g.iterrows()):
            d = dates[pos]
            other = analysts != r["analyst_id"]
            # two-sided window (analyst-level consensus factor, as before)
            mask = (np.abs(dates - d) <= win) & other
            peers = g[mask]
            if not peers.empty:
                counts = peers["rating"].value_counts()
                modes = set(counts[counts == counts.max()].index)
                out.at[i, "consensus_agree"] = r["rating"] in modes
                tps = peers["target_price"].dropna()
                if r.get("status") == "evaluated" and len(tps) and r["entry_price"]:
                    out.at[i, "consensus_tp_error"] = min(1.0, float(abs(r["price_12m"] - tps.mean()) / r["entry_price"]))
            # backward-looking window (point-in-time)
            back = other & (dates < d) & (dates >= d - win)
            if back.any():
                latest = {}
                for a, rt in zip(analysts[back], ratings[back]):   # dates ascending -> last write = latest view
                    latest[a] = rt
                views = pd.Series(list(latest.values()))
                out.at[i, "peer_n"] = int(len(views))
                out.at[i, "peer_share"] = float((views == r["rating"]).mean())
                out.at[i, "peer_view"] = views.value_counts().idxmax()
    return out
