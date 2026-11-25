"""CRISP-DM Evaluation (IR 3.2.1 Process 5, 2.2.5, 4.3).

Everything here is tested out of sample with a time-based split (VALIDATION_SPLIT): anything that is
"learnt" (analyst grades, bias flags) uses only information available before the split date, and is
then checked against the 12-month outcomes of calls made after it.

  1. confidence_test    hit rate by trust-score quintile and by analyst grade (grades from pre-split data)
  2. bias_test          later outcomes of analysts flagged by the bias module vs not flagged
  3. risk_test          hit rate by risk level and risk-meter AUC
  4. min_calls          how many evaluated calls a score needs to be statistically meaningful (IR 4.3)
  5. cohorts            market results by report year (IR 3.5.9)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import RISK_LEVELS, SHRINK_K, THIN_SAMPLE, VALIDATION_SPLIT, WEIGHTS


def _r(x, n=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


# ------------------------------------------------------------------------------------------------
def confidence_test(df, ev, test, split, test_all=None):
    from app.modules.confidence import compute_scores

    out = {}
    t = ev[test].copy()
    t["q"] = pd.qcut(t["confidence_score"].astype(float).rank(method="first"), 5, labels=[1, 2, 3, 4, 5])
    out["by_quintile"] = [{"quintile": int(q), "calls": int(len(g)), "hit_rate": _r(100 * g["hit"].mean(), 1),
                           "avg_score": _r(g["confidence_score"].mean(), 1)} for q, g in t.groupby("q", observed=True)]

    # grades exactly as the website computes them, but only from what was known at the split date
    split_ts = pd.Timestamp(split)
    before = df[pd.to_datetime(df["report_date"]) < split_ts].copy()
    resolved = pd.to_datetime(before["eval_end_date"]) < split_ts
    before.loc[~resolved & (before["status"] == "evaluated"), "status"] = "in_window"
    from app.models import Stock
    sector_of = {s.id: s.sector for s in Stock.query.all()}
    pre, _ = compute_scores(before, sector_of)
    grade_of = pre["grade"].to_dict()
    t = ev[test if test_all is None else test_all].copy()
    t["grade"] = t["analyst_id"].map(grade_of).fillna("N")
    out["by_grade"] = [{"grade": g, "analysts": int(x["analyst_id"].nunique()), "calls": int(len(x)),
                        "hit_rate": _r(100 * x["hit"].mean(), 1)}
                       for g, x in t.groupby("grade") if g in "ABCDN"]
    out["by_grade"].sort(key=lambda r: "ABCDN".index(r["grade"]))
    return out, pre


def bias_test(df, ev, test, split):
    """Is a bias flag a stable behaviour, and does it matter? Flags come from pre-split calls only.
    Persistence: the flagged group's later calls still show the behaviour (higher buy share, lower sell
    share, larger BUY target overshoot). Outcome: BUY hit rate of their later evaluated calls."""
    from app.modules.bias import compute_bias

    split_ts = pd.Timestamp(split)
    when = pd.to_datetime(df["report_date"])
    before = df[when < split_ts].copy()
    before.loc[(pd.to_datetime(before["eval_end_date"]) >= split_ts) & (before["status"] == "evaluated"),
               "status"] = "in_window"
    per, _ = compute_bias(before)
    after = df[when >= split_ts].copy()
    after = after[after["analyst_id"].isin(per)]
    after["flags"] = after["analyst_id"].map(lambda a: per[int(a)]["flags"])
    evb = after[(after["status"] == "evaluated") & (after["rating"] == "BUY")].copy()
    evb["over"] = (evb["target_price"].astype(float) / evb["price_12m"].astype(float) - 1).clip(-1, 1) * 100
    evb["hit"] = evb["hit"].astype(bool)

    def grp(mask_all, mask_buy, label):
        g, b = after[mask_all], evb[mask_buy]
        return {"group": label, "analysts": int(g["analyst_id"].nunique()), "calls": int(len(g)),
                "buy_share": _r(100 * (g["rating"] == "BUY").mean(), 1) if len(g) else None,
                "sell_share": _r(100 * (g["rating"] == "SELL").mean(), 1) if len(g) else None,
                "avg_overshoot": _r(b["over"].mean(), 1) if b["over"].notna().any() else None,
                "buy_hit_rate": _r(100 * b["hit"].mean(), 1) if len(b) else None, "buy_calls": int(len(b))}

    measure = {"Optimism bias": ("buy_share", 1), "Sell avoidance": ("sell_share", -1),
               "Inflated targets": ("avg_overshoot", 1)}
    rows = []
    for flag, (key, sign) in measure.items():
        fa = after["flags"].map(lambda f, fl=flag: fl in f)
        fb = evb["flags"].map(lambda f, fl=flag: fl in f)
        f, n = grp(fa, fb, "flagged"), grp(~fa, ~fb, "not flagged")
        persists = None
        if f[key] is not None and n[key] is not None:
            persists = bool(sign * (f[key] - n[key]) > 0)
        rows.append({"flag": flag, "measure": key, "flagged": f, "not_flagged": n, "persists": persists})
    return rows


def risk_test(ev, test):
    from sklearn.metrics import roc_auc_score
    t = ev[test]
    order = [n for _, n in RISK_LEVELS]
    rows = [{"level": lv, "calls": int(len(g)), "hit_rate": _r(100 * g["hit"].mean(), 1)}
            for lv in order if len(g := t[t["risk_level"] == lv])]
    auc = roc_auc_score(t["hit"].astype(int), 100 - t["risk_score"].astype(float))
    return rows, _r(auc)


# ------------------------------------------------------------------------------------------------
def min_calls(ev, seed=0):
    """Two checks per sample size n: the 95% confidence-interval half-width of a hit rate at the market
    rate, and split-half reliability (correlation between two disjoint sets of n calls per analyst)."""
    rng = np.random.default_rng(seed)
    p = float(ev["hit"].mean())
    groups = {a: g["hit"].astype(int).to_numpy() for a, g in ev.groupby("analyst_id")}
    rows = []
    for n in (5, 10, 20, 30, 50, 75, 100):
        half = 196 * np.sqrt(p * (1 - p) / n)
        pool = [h for h in groups.values() if len(h) >= 2 * n]
        rel = None
        if len(pool) >= 8:
            cors = []
            for _ in range(60):
                a, b = [], []
                for h in pool:
                    s = rng.permutation(h)
                    a.append(s[:n].mean())
                    b.append(s[n:2 * n].mean())
                if np.std(a) > 0 and np.std(b) > 0:
                    cors.append(np.corrcoef(a, b)[0, 1])
            rel = float(np.mean(cors)) if cors else None
        # Spearman-Brown: reliability of the full n-call score from the half-length correlation
        sb = None if rel is None else 2 * rel / (1 + rel) if rel > -1 else None
        rows.append({"n": n, "ci_half_width_pts": _r(half, 1), "analysts_with_2n": len(pool),
                     "split_half_r": _r(rel, 3), "reliability": _r(sb, 3)})
    ok = [r["n"] for r in rows if r["ci_half_width_pts"] is not None and r["ci_half_width_pts"] <= 18
          and (r["reliability"] is None or r["reliability"] >= 0.5)]
    return {"rows": rows, "market_hit_rate": _r(100 * p, 1), "threshold_used": THIN_SAMPLE,
            "rule": "smallest n with a 95% CI of at most +/-18 points and reliability >= 0.5",
            "suggested": ok[0] if ok else None, "shrink_k": SHRINK_K}


def cohorts(df):
    d = df.assign(year=pd.to_datetime(df["report_date"]).dt.year)
    rows = []
    for y, g in d.groupby("year"):
        e = g[g["status"] == "evaluated"]
        rows.append({"year": int(y), "calls": int(len(g)), "evaluated": int(len(e)),
                     "hit_rate": _r(100 * e["hit"].astype(bool).mean(), 1) if len(e) else None,
                     "buy_share": _r(100 * (g["rating"] == "BUY").mean(), 1),
                     "sell_share": _r(100 * (g["rating"] == "SELL").mean(), 1),
                     "avg_trust": _r(g["confidence_score"].astype(float).mean(), 1)})
    return rows


# ------------------------------------------------------------------------------------------------
def run_validation(df: pd.DataFrame, split_date: str = VALIDATION_SPLIT) -> dict:
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    if len(ev) < 200 or ev["hit"].nunique() < 2:
        return {"status": "skipped", "reason": f"only {len(ev)} evaluated calls"}
    when = pd.to_datetime(ev["report_date"])
    train, test = when < pd.Timestamp(split_date), when >= pd.Timestamp(split_date)
    y = ev["hit"]
    if train.sum() < 100 or test.sum() < 50 or y[train].nunique() < 2 or y[test].nunique() < 2:
        return {"status": "skipped", "reason": "not enough calls on each side of the split date"}

    conf, _ = confidence_test(df, ev, test, split_date, test_all=test)
    risk_rows, risk_auc = risk_test(ev, test)
    weighted_auc = _r(
        __import__("sklearn.metrics", fromlist=["roc_auc_score"]).roc_auc_score(
            y[test].astype(int), ev.loc[test, "confidence_score"].astype(float)
        )
    )
    return {
        "status": "ok",
        "split_date": split_date,
        "n_train": int(train.sum()),
        "n_test": int(test.sum()),
        "base_rate_test": _r(y[test].mean()),
        "weighted_auc": weighted_auc,
        "risk_meter_auc": risk_auc,
        "confidence_test": conf,
        "bias_test": bias_test(df, ev, test, split_date),
        "risk_test": risk_rows,
        "min_calls": min_calls(ev),
        "cohorts": cohorts(df),
    }
