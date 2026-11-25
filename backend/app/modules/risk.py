"""Module 3 - Recommendation Risk Meter (IR 2.2.3): a graded risk level per call, not pass/fail.

Components (all 0-100, higher = riskier):
  track        100 - the analyst's hit rate known AT THE CALL DATE (only calls whose 12-month
               window had already closed, so there is no look-ahead). Stock-level record if
               >= MIN_STOCK_TRACK such calls exist, else the analyst's overall record (shrunk).
  volatility   percentile of the stock's trailing 1-year volatility at the call date
  implied_move percentile of |TP / P0 - 1| (bigger promised move = riskier)
  confidence   100 - the call's trust score (Explainable Confidence Score measured at the call date)
  alignment    score alignment with the market consensus: 100 - share of other analysts who held the
               same view in the previous 90 days (a call against the crowd is riskier; 50 if no peers)
Missing components are dropped and the remaining weights re-normalised.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import MIN_STOCK_TRACK, RISK_LEVELS, RISK_WEIGHTS, SHRINK_K


def level_of(score: float) -> str:
    for cut, name in RISK_LEVELS:
        if score < cut:
            return name
    return RISK_LEVELS[-1][1]


def point_in_time_track(df: pd.DataFrame, market_hit: float) -> pd.DataFrame:
    """Adds prior_n, prior_hit_rate, prior_scope for every call."""
    out = df.copy()
    out["prior_n"], out["prior_hit_rate"], out["prior_scope"] = 0, market_hit, "market"
    ev = df[df["status"] == "evaluated"]
    for aid, g in df.groupby("analyst_id"):
        e = ev[ev["analyst_id"] == aid].sort_values("eval_end_date")
        ends = pd.to_datetime(e["eval_end_date"]).to_numpy()
        cum = np.concatenate([[0], e["hit"].astype(int).cumsum().to_numpy()])
        for i, r in g.iterrows():
            d = np.datetime64(pd.Timestamp(r["report_date"]))
            k = int(np.searchsorted(ends, d, "left"))      # calls already resolved before this one
            same = e.iloc[:k]
            same = same[same["stock_id"] == r["stock_id"]]
            if len(same) >= MIN_STOCK_TRACK:
                out.loc[i, ["prior_n", "prior_hit_rate", "prior_scope"]] = [len(same), same["hit"].astype(bool).mean(), "stock"]
            elif k > 0:
                rate = (cum[k] + SHRINK_K * market_hit) / (k + SHRINK_K)
                out.loc[i, ["prior_n", "prior_hit_rate", "prior_scope"]] = [k, rate, "analyst"]
    return out


def _pit_percentile(series: pd.Series, dates: pd.Series) -> pd.Series:
    """Percentile rank of each value against only rows whose report_date is on or before
    its own date — no future information used (IR 2.2.3 point-in-time requirement)."""
    vals = series.to_numpy(dtype=float)
    dts = pd.to_datetime(dates).to_numpy().astype("datetime64[D]")
    result = np.full(len(vals), np.nan)
    for d in np.unique(dts):
        pool = vals[dts <= d]
        pool_valid = pool[~np.isnan(pool)]
        if not len(pool_valid):
            continue
        for i in np.where(dts == d)[0]:
            if not np.isnan(vals[i]):
                result[i] = 100.0 * float(np.mean(pool_valid <= vals[i]))
    return pd.Series(result, index=series.index)


def compute_risk(df: pd.DataFrame, market_hit: float) -> pd.DataFrame:
    out = point_in_time_track(df, market_hit)
    entry = out["entry_price"].astype(float).where(lambda x: x > 0)
    out["implied_move"] = (out["target_price"].astype(float) / entry - 1).abs()
    # Point-in-time percentiles: each call ranked only against calls on or before
    # its own report_date, so no future observations influence a historical risk score.
    vol_pct = _pit_percentile(out["volatility"].astype(float), out["report_date"])
    move_pct = _pit_percentile(out["implied_move"], out["report_date"])

    scores, levels, comps = [], [], []
    for i, r in out.iterrows():
        c = {
            "track": 100 * (1 - float(r["prior_hit_rate"])),
            "volatility": None if pd.isna(vol_pct[i]) else float(vol_pct[i]),
            "implied_move": None if pd.isna(move_pct[i]) else float(move_pct[i]),
            "confidence": 100 - float(r["confidence_score"]) if pd.notna(r.get("confidence_score")) else None,
            "alignment": 100 - 100 * float(r["peer_share"]) if pd.notna(r.get("peer_share")) else 50.0,
        }
        w = {k: RISK_WEIGHTS[k] for k, v in c.items() if v is not None}
        s = sum(c[k] * w[k] for k in w) / sum(w.values())
        scores.append(round(s, 2))
        levels.append(level_of(s))
        comps.append({
            "components": {k: (None if v is None else round(v, 1)) for k, v in c.items()},
            "weights_used": {k: round(v / sum(w.values()), 3) for k, v in w.items()},
            "prior_hit_rate": round(100 * float(r["prior_hit_rate"]), 1),
            "prior_n": int(r["prior_n"]),
            "prior_scope": r["prior_scope"],
            "volatility_annual": None if pd.isna(r["volatility"]) else round(100 * float(r["volatility"]), 1),
            "implied_move_pct": None if pd.isna(r["implied_move"]) else round(100 * float(r["implied_move"]), 1),
            "confidence_score": None if pd.isna(r.get("confidence_score")) else float(r["confidence_score"]),
            "peers": 0 if pd.isna(r.get("peer_n")) else int(r["peer_n"]),
            "peer_view": None if pd.isna(r.get("peer_view")) else r["peer_view"],
            "peer_share": None if pd.isna(r.get("peer_share")) else round(100 * float(r["peer_share"]), 1),
        })
    out["risk_score"], out["risk_level"], out["risk_components"] = scores, levels, comps
    return out
