"""REST API consumed by the React dashboard."""
from flask import Blueprint, abort, jsonify, request
from sqlalchemy import func, or_

from app.config import FACTOR_LABELS, RISK_LEVELS, RISK_WEIGHTS, THIN_SAMPLE, WEIGHTS
from app.extensions import db
from app.models import Analyst, AnalystScore, Broker, Meta, Recommendation, Stock
from app.modules.confidence import explain, explain_call

api = Blueprint("api", __name__)

# IR 1.5.3: the system rates the reliability of past recommendations; it is not a stock recommender.
DISCLAIMER = ("AnalystRate rates how reliable analysts' past recommendations have been. It is not a stock "
              "recommender and nothing on this website is financial advice.")


def meta(key, default=None):
    m = db.session.get(Meta, key)
    return m.value if m else default


def analyst_row(a: Analyst, s: AnalystScore | None) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "broker": a.broker.name,
        "brokers": a.brokers or [a.broker.name],
        "primary_sector": s.primary_sector if s else None,
        "n_calls": s.n_calls if s else 0,
        "n_evaluated": s.n_evaluated if s else 0,
        "hit_rate": s.raw_success if s else None,
        "score": s.score if s else None,
        "grade": s.grade if s else "N",
        "thin_sample": s.thin_sample if s else True,
        "flags": (s.bias or {}).get("flags", []) if s else [],
    }


@api.get("/health")
def health():
    return {"ok": True, "recommendations": db.session.query(func.count(Recommendation.id)).scalar()}


@api.get("/summary")
def summary():
    return jsonify({
        "brokers": db.session.query(func.count(Broker.id)).scalar(),
        "analysts": db.session.query(func.count(Analyst.id)).scalar(),
        "stocks": db.session.query(func.count(Stock.id)).scalar(),
        "recommendations": db.session.query(func.count(Recommendation.id)).scalar(),
        "pipeline": meta("summary", {}),
        "disclaimer": DISCLAIMER,
        "market_score": meta("market_score", {}),
        "market_bias": meta("market_bias", {}),
    })


@api.get("/meta")
def meta_info():
    sectors = [r[0] for r in db.session.query(AnalystScore.primary_sector).distinct() if r[0]]
    return jsonify({
        "sectors": sorted(sectors),
        "brokers": [b.name for b in Broker.query.order_by(Broker.name)],
        "weights": [{"key": k, "label": FACTOR_LABELS[k][0], "description": FACTOR_LABELS[k][1], "weight": w}
                    for k, w in WEIGHTS.items()],
        "risk_weights": RISK_WEIGHTS,
        "pipeline": meta("summary", {}),
        "market_score": meta("market_score", {}),
        "market_bias": meta("market_bias", {}),
        "risk_levels": [{"below": c, "label": n} for c, n in RISK_LEVELS],
        "thin_sample": THIN_SAMPLE,
        "validation": meta("validation", {"status": "not run"}),
    })


@api.get("/analysts")
def analysts():
    q = request.args.get("q", "").strip()
    sector = request.args.get("sector")
    broker = request.args.get("broker")
    min_calls = request.args.get("min_calls", type=int, default=0)
    sort = request.args.get("sort", "score")
    sort_col = {"score": AnalystScore.score, "hit_rate": AnalystScore.raw_success,
                "n_evaluated": AnalystScore.n_evaluated, "name": Analyst.name}.get(sort, AnalystScore.score)

    query = (db.session.query(Analyst, AnalystScore).join(Broker)
             .outerjoin(AnalystScore, AnalystScore.analyst_id == Analyst.id))
    if q:
        query = query.filter(or_(Analyst.name.ilike(f"%{q}%"), Broker.name.ilike(f"%{q}%")))
    if sector:
        query = query.filter(AnalystScore.primary_sector == sector)
    if broker:
        query = query.filter(Broker.name == broker)
    if min_calls:
        query = query.filter(AnalystScore.n_evaluated >= min_calls)
    query = query.order_by(sort_col.asc() if sort == "name" else sort_col.desc().nullslast())
    rows = [analyst_row(a, s) for a, s in query.all()]
    return jsonify({"count": len(rows), "items": rows})


@api.get("/analysts/<int:aid>")
def analyst_detail(aid):
    a = db.session.get(Analyst, aid) or abort(404)
    s = a.score
    out = analyst_row(a, s)
    if s:
        ranked = db.session.query(func.count(AnalystScore.analyst_id)).filter(AnalystScore.score > s.score).scalar()
        factors = explain(s.factors)
        best = max(factors, key=lambda f: f["value"])
        worst = min(factors, key=lambda f: f["value"])
        out.update({
            "rank": ranked + 1,
            "of": db.session.query(func.count(AnalystScore.analyst_id)).scalar(),
            "factors": factors,
            "strongest": best["label"],
            "weakest": worst["label"],
            "bias": s.bias,
            "breakdown": s.breakdown or {},
            "computed_at": s.computed_at.isoformat(timespec="seconds"),
        })
    out["market_bias"] = meta("market_bias", {})
    out["market_score"] = meta("market_score", {})
    return jsonify(out)


def rec_row(r: Recommendation) -> dict:
    return {
        "id": r.id,
        "report_date": r.report_date.isoformat(),
        "stock": r.stock.name,
        "code": r.stock.code,
        "symbol": r.stock.yf_symbol,
        "sector": r.stock.sector,
        "rating": r.rating,
        "target_price": r.target_price,
        "entry_price": r.entry_price,
        "price_12m": r.price_12m,
        "return_12m": r.return_12m,
        "eval_end_date": r.eval_end_date.isoformat() if r.eval_end_date else None,
        "status": r.status,
        "hit": r.hit,
        "note": r.note,
        "consensus_agree": r.consensus_agree,
        "risk_score": r.risk_score,
        "risk_level": r.risk_level,
        "risk": r.risk_components,
        "analyst_id": r.analyst_id,
        "analyst": r.analyst.name,
        "broker": r.broker.name if r.broker else r.analyst.broker.name,
        "confidence_score": r.confidence_score,
        "confidence": explain_call(r.confidence_factors),
        "grade": r.analyst.score.grade if r.analyst.score else "N",
        "score": r.analyst.score.score if r.analyst.score else None,
    }


@api.get("/analysts/<int:aid>/recommendations")
def analyst_recs(aid):
    db.session.get(Analyst, aid) or abort(404)
    limit = min(request.args.get("limit", type=int, default=25), 200)
    offset = request.args.get("offset", type=int, default=0)
    base = Recommendation.query.filter_by(analyst_id=aid)
    rows = base.order_by(Recommendation.report_date.desc()).offset(offset).limit(limit).all()
    return jsonify({"total": base.count(), "items": [rec_row(r) for r in rows]})


@api.get("/recommendations/<int:rid>")
def recommendation(rid):
    r = db.session.get(Recommendation, rid) or abort(404)
    out = rec_row(r)
    out["analyst_info"] = {"id": r.analyst.id, "name": r.analyst.name, "broker": r.analyst.broker.name}
    return jsonify(out)


@api.get("/stocks")
def stocks():
    q = request.args.get("q", "").strip()
    query = (db.session.query(Stock, func.count(Recommendation.id))
             .outerjoin(Recommendation, Recommendation.stock_id == Stock.id).group_by(Stock.id))
    if q:
        query = query.filter(or_(Stock.name.ilike(f"%{q}%"), Stock.code.ilike(f"%{q}%")))
    rows = query.order_by(func.count(Recommendation.id).desc()).limit(30).all()
    return jsonify([{"code": s.code, "name": s.name, "sector": s.sector, "calls": n} for s, n in rows])


from . import market  # noqa: E402,F401  (registers insights/stock/search endpoints)
