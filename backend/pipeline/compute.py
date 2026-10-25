"""Step 4 - run outcomes + the three modules over the whole database and store the results."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd

from app.extensions import db, json_safe
from app.models import AnalystScore, Meta, Price, Recommendation, Stock
from app.modules.bias import compute_bias
from app.modules.confidence import breakdowns, call_level_scores, compute_scores
from app.modules.risk import compute_risk

from .outcomes import add_consensus, evaluate
from .validate import run_validation


def load_prices() -> tuple[dict[int, pd.Series], date | None]:
    rows = db.session.query(Price.stock_id, Price.date, Price.close).order_by(Price.stock_id, Price.date).all()
    if not rows:
        return {}, None
    p = pd.DataFrame(rows, columns=["stock_id", "date", "close"])
    series = {sid: g.set_index("date")["close"] for sid, g in p.groupby("stock_id")}
    return series, p["date"].max()


def run_all(as_of: date | None = None) -> dict:
    recs = pd.read_sql(
        db.select(Recommendation.id, Recommendation.analyst_id, Recommendation.stock_id,
                  Recommendation.report_date, Recommendation.rating, Recommendation.target_price),
        db.engine,
    )
    if recs.empty:
        raise RuntimeError("No recommendations in the database.")
    recs["report_date"] = pd.to_datetime(recs["report_date"]).dt.date

    prices, last_price_date = load_prices()
    as_of = as_of or last_price_date or date.today()
    stocks = Stock.query.all()
    splits = {s.id: s.splits for s in stocks}
    sector_of = {s.id: s.sector for s in stocks}

    print(f"evaluating {len(recs)} calls (prices up to {as_of}) ...")
    df = evaluate(recs, prices, splits, as_of)
    df = add_consensus(df)
    scores, market_score = compute_scores(df, sector_of)                      # Module 1, analyst level
    df = call_level_scores(df, sector_of, market_score["experience_ref_calls"])  # Module 1, per call (trust score)
    bias, market_bias = compute_bias(df)                                        # Module 2
    df = compute_risk(df, market_score["hit_rate"] / 100)                       # Module 3
    parts = breakdowns(df, sector_of)
    print("validating (model comparison, out-of-sample tests) ...")
    validation = run_validation(df)                                             # CRISP-DM Evaluation

    # ---- write back ----
    cols = ["status", "eval_end_date", "entry_price", "price_12m", "return_12m", "hit", "tp_error",
            "consensus_tp_error", "consensus_agree", "volatility", "note",
            "confidence_score", "confidence_factors", "risk_score", "risk_level", "risk_components"]

    def clean(v):
        if isinstance(v, (dict, list)):
            return json_safe(v)
        return None if v is None or (not isinstance(v, (str, bool, date)) and pd.isna(v)) else v

    mappings = [{"id": int(r["id"]), **{c: clean(r[c]) for c in cols}} for _, r in df.iterrows()]
    db.session.bulk_update_mappings(Recommendation, mappings)

    db.session.query(AnalystScore).delete()
    now = datetime.now(UTC).replace(tzinfo=None)
    for aid, s in scores.iterrows():
        b = dict(bias[int(aid)])
        b["tp_vs_consensus"] = s["tp_vs_consensus"]
        db.session.add(AnalystScore(
            analyst_id=int(aid), n_calls=int(s["n_calls"]), n_evaluated=int(s["n_evaluated"]),
            primary_sector=s["primary_sector"], raw_success=json_safe(s["raw_success"]), factors=json_safe(s["factors"]),
            score=float(s["score"]), grade=s["grade"], thin_sample=bool(s["thin_sample"]),
            bias=json_safe(b), breakdown=json_safe(parts.get(int(aid))), computed_at=now,
        ))

    status = df["status"].value_counts().to_dict()
    summary = {
        "as_of": as_of.isoformat(),
        "computed_at": now.isoformat(timespec="seconds"),
        "calls": int(len(df)),
        "status": {k: int(v) for k, v in status.items()},
        "first_call": str(df["report_date"].min()),
        "last_call": str(df["report_date"].max()),
        "risk_levels": {k: int(v) for k, v in df["risk_level"].value_counts().items()},
        "analysts": int(df["analyst_id"].nunique()),
        "stocks": int(df["stock_id"].nunique()),
    }
    for key, value in {"market_score": market_score, "market_bias": market_bias,
                       "validation": validation, "summary": summary}.items():
        db.session.merge(Meta(key=key, value=json_safe(value)))
    db.session.commit()
    v = validation
    short = {k: v.get(k) for k in ("status", "split_date", "n_train", "n_test", "weighted_auc", "logit_auc",
                                     "risk_meter_auc")}
    return {"summary": summary, "validation": short, "_full_validation": v}
