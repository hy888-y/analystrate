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

from app.config import FACTOR_LABELS, RISK_LEVELS, SHRINK_K, THIN_SAMPLE, VALIDATION_SPLIT, WEIGHTS


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
def logistic_regression_test(df, ev, train, test, split):
    """IR 2.2.5 Part 2: fit a Logistic Regression on the four PIT confidence factors and
    compare its coefficients with the scoring model's equal factor weights.

    Features are the four values from confidence_factors["values"] already stored on each
    call by call_level_scores() — computed point-in-time with no look-ahead.  The model is
    trained exclusively on pre-split evaluated calls and tested on post-split evaluated calls.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                                  precision_score, recall_score, roc_auc_score)
    from sklearn.preprocessing import StandardScaler

    factor_keys = list(WEIGHTS.keys())   # ["success", "tp_accuracy", "sector", "consensus"]

    def _features(subset):
        rows = []
        for _, r in subset.iterrows():
            cf = r.get("confidence_factors")
            if isinstance(cf, dict) and "values" in cf:
                v = cf["values"]
                rows.append([v.get(k) for k in factor_keys])
            else:
                rows.append([None] * len(factor_keys))
        return pd.DataFrame(rows, columns=factor_keys, index=subset.index).astype(float)

    ev_tr, ev_te = ev[train], ev[test]
    X_tr_raw, X_te_raw = _features(ev_tr), _features(ev_te)

    ok_tr = X_tr_raw.notna().all(axis=1)
    ok_te = X_te_raw.notna().all(axis=1)
    X_tr = X_tr_raw[ok_tr].values
    y_tr = ev_tr.loc[ok_tr, "hit"].astype(int).values
    X_te = X_te_raw[ok_te].values
    y_te = ev_te.loc[ok_te, "hit"].astype(int).values

    n_tr_classes = int(len(np.unique(y_tr))) if len(y_tr) else 0
    n_te_classes = int(len(np.unique(y_te))) if len(y_te) else 0

    if len(X_tr) < 50 or n_tr_classes < 2:
        return {"status": "skipped",
                "reason": f"insufficient training data ({len(X_tr)} rows, {n_tr_classes} classes)"}
    if len(X_te) < 20 or n_te_classes < 2:
        return {"status": "skipped",
                "reason": f"insufficient test data ({len(X_te)} rows, {n_te_classes} classes)"}

    # Standardise features so coefficient magnitudes are comparable across factors.
    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(X_tr)
    X_te_s = scaler.transform(X_te)

    # class_weight="balanced" mitigates any BUY-dominant class imbalance; random_state for reproducibility.
    lr = LogisticRegression(class_weight="balanced", max_iter=1000, random_state=42)
    lr.fit(X_tr_s, y_tr)

    y_pred = lr.predict(X_te_s)
    y_prob = lr.predict_proba(X_te_s)[:, 1]

    auc   = _r(roc_auc_score(y_te, y_prob))
    acc   = _r(accuracy_score(y_te, y_pred))
    prec  = _r(precision_score(y_te, y_pred, zero_division=0))
    rec   = _r(recall_score(y_te, y_pred, zero_division=0))
    f1    = _r(f1_score(y_te, y_pred, zero_division=0))
    cm    = confusion_matrix(y_te, y_pred).tolist()

    coefs = lr.coef_[0]
    comparison = []
    for i, k in enumerate(factor_keys):
        c = float(coefs[i])
        comparison.append({
            "factor": k,
            "label": FACTOR_LABELS[k][0],
            "lr_coef": _r(c),
            "model_weight": _r(WEIGHTS[k]),
            "coef_positive": bool(c > 0),
            # Weight is always positive (0.25); LR agrees when its coefficient is also positive.
            "direction_agrees": bool(c > 0),
        })
    coef_rank = sorted(factor_keys, key=lambda k: -abs(float(coefs[factor_keys.index(k)])))

    return {
        "status": "ok",
        "n_train": int(len(X_tr)),
        "n_test": int(len(X_te)),
        "features": factor_keys,
        "metrics": {
            "auc": auc, "accuracy": acc, "precision": prec, "recall": rec,
            "f1": f1, "confusion_matrix": cm,
        },
        "coefficients": {k: _r(float(coefs[i])) for i, k in enumerate(factor_keys)},
        "intercept": _r(float(lr.intercept_[0])),
        "comparison": comparison,
        "coef_rank": coef_rank,
        "note": (
            "Coefficients are from a logistic regression trained on standardised features "
            "(mean 0, sd 1). A positive coefficient means the factor moves the predicted "
            "probability of success in the same direction as the scoring model. The scoring "
            "model assigns all four factors equal 25% weights by design; the LR coefficients "
            "reflect what the data supports and are not expected to be numerically equal."
        ),
    }


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
    logit = logistic_regression_test(df, ev, train, test, split_date)
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
        "logit_test": logit,
    }
