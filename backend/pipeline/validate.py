"""CRISP-DM Evaluation (IR 3.2.1 Process 5, 2.2.5, 4.3).

Everything here is tested out of sample with a time-based split (VALIDATION_SPLIT): anything that is
"learnt" (model weights, analyst grades, bias flags) uses only information available before the split
date, and is then checked against the 12-month outcomes of calls made after it.

  1. model_comparison   the transparent weighted score vs logistic regression, random forest and
                        gradient boosting, all on the same five call-level factors (IR 2.2.5)
  2. weights_vs_coef    logistic-regression coefficients compared with the factor weights (IR 2.2.5)
  3. confidence_test    hit rate by trust-score quintile and by analyst grade (grades from pre-split data)
  4. bias_test          later outcomes of analysts flagged by the bias module vs not flagged
  5. risk_test          hit rate by risk level and risk-meter AUC
  6. lime_test          LIME-style local explanations of the best black-box model compared with the
                        transparent factor breakdown: fidelity, stability, agreement (IR 4.3)
  7. min_calls          how many evaluated calls a score needs to be statistically meaningful (IR 4.3)
  8. cohorts            market results by report year (IR 3.5.9)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import MIN_HISTORY_FOR_MODELS, RISK_LEVELS, SHRINK_K, THIN_SAMPLE, VALIDATION_SPLIT, WEIGHTS

FEATURES = list(WEIGHTS)        # success, tp_accuracy, experience, sector, consensus


def _r(x, n=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def _features(ev: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame([cf["values"] for cf in ev["confidence_factors"]], index=ev.index)[FEATURES].astype(float)


# ------------------------------------------------------------------------------------------------
def model_comparison(ev, train, test):
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
    from sklearn.preprocessing import StandardScaler

    X, y = _features(ev), ev["hit"].astype(int)
    Xtr, Xte, ytr, yte = X[train], X[test], y[train], y[test]
    sc = StandardScaler().fit(Xtr)

    # transparent weighted score: no training. Accuracy uses the cut-off that is best on the training set.
    s_tr, s_te = ev.loc[train, "confidence_score"].astype(float), ev.loc[test, "confidence_score"].astype(float)
    cuts = np.unique(np.round(s_tr, 1))
    best_cut = max(cuts, key=lambda c: accuracy_score(ytr, (s_tr >= c).astype(int))) if len(cuts) else 50
    rows = [{"model": "Weighted factor score (chosen)", "key": "weighted", "trained": False,
             "auc": _r(roc_auc_score(yte, s_te)), "accuracy": _r(accuracy_score(yte, (s_te >= best_cut).astype(int))),
             "brier": None, "explainable": "Exact: every point on screen", "cutoff": _r(best_cut, 1)}]

    models = {
        "logit": ("Logistic regression", LogisticRegression(max_iter=1000), True, "Global coefficients"),
        "rf": ("Random forest", RandomForestClassifier(n_estimators=300, min_samples_leaf=25, random_state=0, n_jobs=-1),
               False, "Black box (needs LIME/SHAP)"),
        "gb": ("Gradient boosting", HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300,
                                                                   random_state=0), False, "Black box (needs LIME/SHAP)"),
    }
    fitted = {}
    for key, (name, m, scaled, expl) in models.items():
        a, b = (sc.transform(Xtr), sc.transform(Xte)) if scaled else (Xtr.values, Xte.values)
        m.fit(a, ytr)
        p = m.predict_proba(b)[:, 1]
        fitted[key] = m
        rows.append({"model": name, "key": key, "trained": True, "auc": _r(roc_auc_score(yte, p)),
                     "accuracy": _r(accuracy_score(yte, (p >= 0.5).astype(int))),
                     "brier": _r(brier_score_loss(yte, p)), "explainable": expl})

    logit = fitted["logit"]
    coef = dict(zip(FEATURES, logit.coef_[0]))
    tot = sum(abs(v) for v in coef.values()) or 1
    rf_imp = dict(zip(FEATURES, fitted["rf"].feature_importances_))
    weights_vs_coef = [{"factor": f, "weight": WEIGHTS[f], "coefficient": _r(coef[f]),
                        "coef_share": _r(abs(coef[f]) / tot), "rf_importance": _r(rf_imp[f]),
                        "same_direction": bool(coef[f] > 0)} for f in FEATURES]
    best = max(rows, key=lambda r: r["auc"] or 0)
    chosen = rows[0]
    return rows, weights_vs_coef, fitted, sc, {"best_auc_model": best["model"],
                                              "auc_gap_vs_best": _r((best["auc"] or 0) - (chosen["auc"] or 0))}


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
def lime_test(ev, train, test, model, n_cases=150, n_samples=600, seed=0):
    """Ribeiro et al. (2016) LIME, implemented directly: perturb one call's five factors, ask the black
    box for predictions, weight samples by closeness, fit a weighted linear model. Compared with the
    transparent score, whose breakdown is exact by construction."""
    from sklearn.linear_model import Ridge

    X = _features(ev)
    mu, sd = X[train].mean(), X[train].std().replace(0, 1)
    Z_test = ((X[test] - mu) / sd).to_numpy()
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(Z_test), size=min(n_cases, len(Z_test)), replace=False)
    width = 0.75 * np.sqrt(len(FEATURES))

    def explain(z, s):
        r = np.random.default_rng(s)
        Zs = z + r.normal(0, 1, size=(n_samples, len(FEATURES)))
        Zs[0] = z
        p = model.predict_proba(Zs * sd.to_numpy() + mu.to_numpy())[:, 1]
        dist = np.sqrt(((Zs - z) ** 2).sum(1))
        w = np.exp(-(dist ** 2) / width ** 2)
        lin = Ridge(alpha=1.0).fit(Zs, p, sample_weight=w)
        pred = lin.predict(Zs)
        r2 = 1 - (w * (p - pred) ** 2).sum() / max(1e-12, (w * (p - np.average(p, weights=w)) ** 2).sum())
        return lin.coef_, r2

    fid, same_top, agree = [], 0, 0
    Xt = X[test].to_numpy()
    wvec = np.array([WEIGHTS[f] for f in FEATURES])
    mean_tr = mu.to_numpy()
    for j in pick:
        c1, r2 = explain(Z_test[j], seed + j)
        c2, _ = explain(Z_test[j], seed + j + 10_000)
        fid.append(r2)
        same_top += int(np.argmax(np.abs(c1)) == np.argmax(np.abs(c2)))
        # transparent explanation: which factor moves this call's score most vs an average call
        contrib = wvec * (Xt[j] - mean_tr)
        agree += int(np.argmax(np.abs(c1 * sd.to_numpy())) == np.argmax(np.abs(contrib)))
    n = len(pick)
    return {
        "cases": int(n),
        "lime_fidelity_r2": _r(float(np.mean(fid)), 3),
        "lime_top_factor_stable_pct": _r(100 * same_top / n, 1),
        "lime_agrees_with_transparent_pct": _r(100 * agree / n, 1),
        "transparent_fidelity_r2": 1.0,
        "transparent_stable_pct": 100.0,
        "note": "Same call explained twice with different random samples; the transparent breakdown is exact and identical every time.",
    }


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

    hist = ev["confidence_factors"].map(lambda c: c["evidence"]["resolved_calls"] >= MIN_HISTORY_FOR_MODELS)
    htrain, htest = train & hist, test & hist
    if htrain.sum() < 100 or htest.sum() < 50:
        htrain, htest = train, test
    comp, wvc, fitted, _, summary = model_comparison(ev, htrain, htest)
    conf, _ = confidence_test(df, ev, htest, split_date, test_all=test)
    risk_rows, risk_auc = risk_test(ev, test)
    best_bb = max((r for r in comp if r["key"] in ("rf", "gb")), key=lambda r: r["auc"] or 0)
    logit = next(r for r in comp if r["key"] == "logit")
    weighted = comp[0]
    return {
        "status": "ok",
        "split_date": split_date,
        "n_train": int(train.sum()),
        "n_test": int(test.sum()),
        "base_rate_test": _r(y[test].mean()),
        "model_calls": {"min_history": MIN_HISTORY_FOR_MODELS, "n_train": int(htrain.sum()), "n_test": int(htest.sum()),
                        "base_rate_test": _r(y[htest].mean())},
        # headline numbers (kept under the old names so earlier pages and the report still match)
        "weighted_auc": weighted["auc"],
        "logit_auc": logit["auc"],
        "logit_accuracy": logit["accuracy"],
        "risk_meter_auc": risk_auc,
        "standardised_coefficients": {r["factor"]: r["coefficient"] for r in wvc},
        "model_comparison": comp,
        "comparison_summary": summary,
        "weights_vs_coef": wvc,
        "confidence_test": conf,
        "bias_test": bias_test(df, ev, test, split_date),
        "risk_test": risk_rows,
        "lime_test": lime_test(ev, htrain, htest, fitted[best_bb["key"]]) | {"model": best_bb["model"]},
        "min_calls": min_calls(ev),
        "cohorts": cohorts(df),
    }
