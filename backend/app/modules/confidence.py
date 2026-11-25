"""Module 1 - Explainable Confidence Score (Proposal Section 3).

Four equal-weight factors (25% each), all on a 0-100 scale:
  success     — historical recommendation outcome performance
  tp_accuracy — target price realism vs actual 12-month outcome
  sector      — analyst's performance in the relevant sector
  consensus   — consistency with peer analyst views (proxy for market sentiment)

Experience depth (number of evaluated calls) is NOT a scoring factor per the approved
proposal; it is tracked as supporting metadata (thin_sample flag, n_evaluated field,
and resolved_calls in the per-call evidence).  Thin records are shrunk toward the market
rate (Bayesian average, k = SHRINK_K) to prevent misleading scores on few calls.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import FACTOR_LABELS, SHRINK_K, THIN_SAMPLE, WEIGHTS


def shrunk_rate(hits: float, n: float, prior: float, k: float = SHRINK_K) -> float:
    return (hits + k * prior) / (n + k)


def compute_scores(df: pd.DataFrame, sector_of: dict[int, str | None]) -> tuple[pd.DataFrame, dict]:
    """df: recommendations with outcome + consensus columns. Returns (per-analyst table, market stats)."""
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    market_hit = float(ev["hit"].mean()) if len(ev) else 0.5
    agree = df["consensus_agree"].dropna().astype(bool)
    market_agree = float(agree.mean()) if len(agree) else 0.5
    tp_err = ev["tp_error"].dropna().astype(float)
    market_tp_acc = float(100 * (1 - min(1.0, tp_err.mean()))) if len(tp_err) else 50.0

    df = df.assign(sector=df["stock_id"].map(sector_of).fillna("Unclassified"))
    ev = ev.assign(sector=ev["stock_id"].map(sector_of).fillna("Unclassified"))

    rows = []
    for aid, g in df.groupby("analyst_id"):
        e = ev[ev["analyst_id"] == aid]
        n, hits = len(e), int(e["hit"].sum())
        primary = g["sector"].mode().iat[0] if len(g) else None
        es = e[e["sector"] == primary]
        errs = e["tp_error"].dropna().astype(float)
        ag = g["consensus_agree"].dropna().astype(bool)

        # TP accuracy: mean error shrunk toward the market error like the rates
        if len(errs):
            mean_err = (errs.sum() + SHRINK_K * (1 - market_tp_acc / 100)) / (len(errs) + SHRINK_K)
            tp_acc = 100 * (1 - min(1.0, mean_err))
        else:
            tp_acc = market_tp_acc
        c_err = e["consensus_tp_error"].dropna().astype(float)
        both = errs.index.intersection(c_err.index)   # calls with both own and consensus target error
        rel = (float(errs.loc[both].mean() / c_err.loc[both].mean())
               if len(both) and c_err.loc[both].mean() > 0 else None)

        # Four approved factors only (experience excluded from score per proposal).
        f = {
            "success":     100 * shrunk_rate(hits, n, market_hit),
            "tp_accuracy": tp_acc,
            "sector":      100 * shrunk_rate(int(es["hit"].sum()), len(es), market_hit),
            "consensus":   100 * shrunk_rate(int(ag.sum()), len(ag), market_agree),
        }
        f = {k: round(float(v), 2) for k, v in f.items()}
        rows.append({
            "analyst_id": aid,
            "n_calls": int(len(g)),
            "n_evaluated": n,
            "primary_sector": primary,
            "raw_success": round(100 * hits / n, 2) if n else None,
            "factors": f,
            "tp_vs_consensus": round(rel, 3) if rel is not None else None,
            "score": round(sum(WEIGHTS[k] * f[k] for k in WEIGHTS), 2),
            "thin_sample": n < THIN_SAMPLE,
        })
    out = pd.DataFrame(rows).set_index("analyst_id")

    # Grades are relative to peers with a scored record: top 20% A, next 30% B, next 30% C, rest D.
    rated = out[out["n_evaluated"] > 0]["score"]
    q80, q50, q20 = (rated.quantile([0.8, 0.5, 0.2]).tolist() if len(rated) else (0, 0, 0))
    out["grade"] = [
        "N" if n == 0 else "A" if s >= q80 else "B" if s >= q50 else "C" if s >= q20 else "D"
        for s, n in zip(out["score"], out["n_evaluated"])
    ]
    market = {"hit_rate": round(100 * market_hit, 2), "consensus_agree": round(100 * market_agree, 2),
              "n_evaluated": int(len(ev)),
              "tp_accuracy": round(market_tp_acc, 2), "grade_cutoffs": {"A": q80, "B": q50, "C": q20}}
    return out, market


def explain(factors: dict) -> list[dict]:
    """Factor -> label, value, weight, points. Used directly by the API."""
    return [
        {"key": k, "label": FACTOR_LABELS[k][0], "description": FACTOR_LABELS[k][1],
         "value": factors[k], "weight": w, "points": round(factors[k] * w, 2)}
        for k, w in WEIGHTS.items()
    ]


# ---------------------------------------------------------------------------------------------
# Call level: the "recommendation trust score" of IR Objective 3. Same four factors and weights
# as the analyst score, but every factor is measured only from information that existed on the
# call date (calls whose 12-month window had already closed, and peer calls already published),
# so the score shown on a call is exactly what an investor could have known when reading it.
# ---------------------------------------------------------------------------------------------
def call_level_scores(df: pd.DataFrame, sector_of: dict[int, str | None]) -> pd.DataFrame:
    """Adds confidence_score (0-100) and confidence_factors (dict) to every call.

    Four equal-weight factors (25% each). Experience depth is NOT a scoring factor;
    it appears only in the evidence dict as resolved_calls (supporting metadata).
    All factor values are computed point-in-time: only information available on the
    call date is used, preventing look-ahead bias.
    """
    out = df.copy()
    out["sector"] = out["stock_id"].map(sector_of).fillna("Unclassified")
    ev = out[out["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    ev["end"] = pd.to_datetime(ev["eval_end_date"])

    # market baselines known at each date (cumulative over calls already resolved)
    mk = ev.sort_values("end")
    m_end = mk["end"].to_numpy()
    m_hits = np.concatenate([[0], mk["hit"].astype(int).cumsum().to_numpy()])
    err = mk["tp_error"].astype(float)
    m_err_sum = np.concatenate([[0.0], err.fillna(0).cumsum().to_numpy()])
    m_err_n = np.concatenate([[0], err.notna().astype(int).cumsum().to_numpy()])

    def market_at(d):
        k = int(np.searchsorted(m_end, d, "left"))
        hit = m_hits[k] / k if k else 0.5
        e = m_err_sum[k] / m_err_n[k] if m_err_n[k] else 0.5
        return hit, e

    scores, factors = [], []
    idx = []
    for aid, g in out.groupby("analyst_id"):
        e = ev[ev["analyst_id"] == aid].sort_values("end")
        ends = e["end"].to_numpy()
        hits = e["hit"].to_numpy()
        errs = e["tp_error"].astype(float).to_numpy()
        secs = e["sector"].to_numpy()
        for i, r in g.iterrows():
            d = np.datetime64(pd.Timestamp(r["report_date"]))
            k = int(np.searchsorted(ends, d, "left"))            # own calls already resolved
            m_hit, m_err = market_at(d)
            h = int(hits[:k].sum())
            ek = errs[:k][~np.isnan(errs[:k])]
            same = secs[:k] == r["sector"]
            sn, sh = int(same.sum()), int(hits[:k][same].sum())
            pn = r.get("peer_n")
            pn = 0 if pn is None or pd.isna(pn) else int(pn)
            # Four approved factors only; experience (k) stored in evidence as metadata.
            f = {
                "success":     100 * shrunk_rate(h, k, m_hit),
                "tp_accuracy": 100 * (1 - min(1.0, (ek.sum() + SHRINK_K * m_err) / (len(ek) + SHRINK_K))),
                "sector":      100 * shrunk_rate(sh, sn, m_hit),
                "consensus":   100 * float(r["peer_share"]) if pn else 50.0,
            }
            f = {k2: round(float(v), 2) for k2, v in f.items()}
            idx.append(i)
            scores.append(round(sum(WEIGHTS[k2] * f[k2] for k2 in WEIGHTS), 2))
            factors.append({
                "values": f,
                "evidence": {"resolved_calls": k, "resolved_hits": h, "sector": r["sector"],
                             "sector_calls": sn, "sector_hits": sh, "tp_errors": int(len(ek)),
                             "peers": pn, "peer_view": None if not pn else r["peer_view"],
                             "market_hit_rate": round(100 * m_hit, 1)},
            })
    res = pd.DataFrame({"confidence_score": scores, "confidence_factors": factors}, index=idx)
    return out.drop(columns="sector").join(res)


def explain_call(cf: dict | None) -> list[dict]:
    """Per-call factor list for the API (value x weight = points, plus the evidence behind it)."""
    if not cf:
        return []
    v, ev = cf["values"], cf["evidence"]
    why = {
        "success": f"{ev['resolved_hits']} of {ev['resolved_calls']} earlier calls had played out by this date",
        "tp_accuracy": f"based on {ev['tp_errors']} earlier targets that had reached their 12-month date",
        "sector": f"{ev['sector_hits']} of {ev['sector_calls']} earlier calls in {ev['sector']} played out",
        "consensus": (f"{ev['peers']} other analysts had a view; most said {ev['peer_view']}"
                      if ev["peers"] else "no other analyst had a view in the previous 90 days"),
    }
    return [{"key": k, "label": FACTOR_LABELS[k][0], "value": v[k], "weight": w,
             "points": round(v[k] * w, 2), "evidence": why[k]} for k, w in WEIGHTS.items()]


def breakdowns(df: pd.DataFrame, sector_of: dict[int, str | None]) -> dict[int, dict]:
    """Per analyst: record by sector (IR 1.2: performance in the sector the investor is looking at)
    and by report year (IR 3.5.9: cohort analysis)."""
    d = df.assign(sector=df["stock_id"].map(sector_of).fillna("Unclassified"),
                  year=pd.to_datetime(df["report_date"]).dt.year,
                  ev=df["status"] == "evaluated")
    d["h"] = (d["hit"].astype("boolean").fillna(False).astype(bool) & d["ev"]).astype(bool)

    def table(g, key):
        t = g.groupby(key).agg(calls=("id", "size"), evaluated=("ev", "sum"), hits=("h", "sum"))
        rows = []
        for k, r in t.iterrows():
            n = int(r["evaluated"])
            rows.append({key: k if key == "sector" else int(k), "calls": int(r["calls"]), "evaluated": n,
                         "hits": int(r["hits"]), "hit_rate": round(100 * r["hits"] / n, 1) if n else None})
        return sorted(rows, key=lambda x: -x["calls"]) if key == "sector" else rows

    return {int(aid): {"by_sector": table(g, "sector"), "by_year": table(g, "year")}
            for aid, g in d.groupby("analyst_id")}
