"""Endpoints behind the TradingView-style pages: insights home, stock workspace, call screener, search."""
from datetime import timedelta

from flask import abort, jsonify, request
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import Analyst, AnalystScore, Broker, Price, Recommendation, Stock
from pipeline.outcomes import split_factor

from .routes import REC_LOAD, api, meta, rec_row


@api.get("/insights")
def insights():
    """Home page: most recent day of calls, counts, top analysts, latest rating changes."""
    last = db.session.query(func.max(Recommendation.report_date)).scalar()
    if last is None:
        return jsonify({"date": None, "calls": [], "counts": {}, "top": [], "changes": []})
    days = request.args.get("days", type=int, default=1)
    since = last - timedelta(days=days - 1)
    calls = (Recommendation.query.options(*REC_LOAD).filter(Recommendation.report_date >= since)
             .order_by(Recommendation.report_date.desc(), Recommendation.id.desc()).all())
    counts = {"total": len(calls)}
    for r in ("BUY", "HOLD", "SELL"):
        counts[r] = sum(c.rating == r for c in calls)

    top = (db.session.query(Analyst, AnalystScore).join(AnalystScore).options(joinedload(Analyst.broker))
           .filter(AnalystScore.n_evaluated >= 30).order_by(AnalystScore.score.desc()).limit(6).all())

    # rating changes: an analyst's call differs from their previous call on the same stock.
    # One light query of every call, then compare in Python (instead of one query per call).
    light = (db.session.query(Recommendation.id, Recommendation.analyst_id, Recommendation.stock_id,
                              Recommendation.report_date, Recommendation.rating)
             .order_by(Recommendation.report_date, Recommendation.id).all())
    prev_of, last_seen = {}, {}
    for rid, aid, sid, _d, rating in light:
        if (aid, sid) in last_seen:
            prev_of[rid] = last_seen[(aid, sid)]
        last_seen[(aid, sid)] = rating
    order = {"SELL": 0, "HOLD": 1, "BUY": 2}
    picked = []
    for rid, _aid, _sid, _d, rating in reversed(light):
        p = prev_of.get(rid)
        if p and p != rating:
            picked.append((rid, p, "Upgrade" if order[rating] > order[p] else "Downgrade"))
            if len(picked) >= 8:
                break
    objs = {r.id: r for r in Recommendation.query.options(*REC_LOAD)
            .filter(Recommendation.id.in_([x[0] for x in picked])).all()} if picked else {}
    changes = [rec_row(objs[rid]) | {"from": p, "direction": d} for rid, p, d in picked if rid in objs]
    return jsonify({
        "date": last.isoformat(), "since": since.isoformat(), "counts": counts,
        "calls": [rec_row(c) for c in calls],
        "top": [{"id": a.id, "name": a.name, "broker": a.broker.name, "score": s.score, "grade": s.grade,
                 "hit_rate": s.raw_success, "n_evaluated": s.n_evaluated, "sector": s.primary_sector} for a, s in top],
        "changes": changes,
        "market": meta("market_bias", {}) | {"hit_rate": meta("market_score", {}).get("hit_rate")},
    })


@api.get("/recommendations")
def recommendations():
    """Call screener used by the quick-view chips."""
    q = Recommendation.query.join(Analyst).join(Stock).options(*REC_LOAD)
    if r := request.args.get("rating"):
        q = q.filter(Recommendation.rating == r.upper())
    if v := request.args.get("risk"):
        q = q.filter(Recommendation.risk_level == v)
    if v := request.args.get("status"):
        q = q.filter(Recommendation.status == v)
    if v := request.args.get("hit"):
        q = q.filter(Recommendation.hit.is_(v in ("1", "true")))
    if v := request.args.get("grade"):
        q = q.join(AnalystScore, AnalystScore.analyst_id == Analyst.id).filter(AnalystScore.grade == v)
    sort = request.args.get("sort", "date")
    if sort == "upside":
        q = q.filter(Recommendation.target_price.isnot(None), Recommendation.entry_price > 0)
        q = q.order_by((Recommendation.target_price / Recommendation.entry_price).desc())
    elif sort == "risk":
        q = q.order_by(Recommendation.risk_score.desc().nullslast())
    else:
        q = q.order_by(Recommendation.report_date.desc())
    limit = min(request.args.get("limit", type=int, default=50), 200)
    offset = request.args.get("offset", type=int, default=0)
    total = q.count()
    return jsonify({"total": total, "items": [rec_row(r) for r in q.offset(offset).limit(limit).all()]})


@api.get("/stocks/<code>")
def stock(code):
    s = Stock.query.filter_by(code=code.zfill(4)).first() or abort(404)
    recs = (Recommendation.query.options(*REC_LOAD).filter_by(stock_id=s.id)
            .order_by(Recommendation.report_date.desc(), Recommendation.id.desc()).all())
    rows = [rec_row(r) for r in recs]
    # chart targets are put on Yahoo's split-adjusted basis
    for row, r in zip(rows, recs):
        f = split_factor(s.splits, r.report_date)
        row["target_chart"] = r.target_price / f if r.target_price else None

    counts = {"total": len(recs), "open": sum(r.status == "in_window" for r in recs)}
    for k in ("BUY", "HOLD", "SELL"):
        counts[k] = sum(r.rating == k for r in recs)

    cons = None
    if recs:
        end = recs[0].report_date
        window = [r for r in recs if r.report_date >= end - timedelta(days=90)]
        latest = {}
        for r in window:                      # newest first: keep each analyst's latest view
            latest.setdefault(r.analyst_id, r)
        views = list(latest.values())
        tps = [r.target_price for r in views if r.target_price]
        c = {k: sum(v.rating == k for v in views) for k in ("BUY", "HOLD", "SELL")}
        n = max(1, len(views))
        net = (c["BUY"] - c["SELL"]) / n
        label = ("Strong Buy" if net >= .75 else "Moderate Buy" if net >= .3 else "Hold" if net > -.3
                 else "Moderate Sell" if net > -.75 else "Strong Sell")
        cons = {"from": (end - timedelta(days=90)).isoformat(), "to": end.isoformat(), "counts": c,
                "label": label, "avg_target": sum(tps) / len(tps) if tps else None, "analysts": len(views)}

    # IR 1.2: how has each covering analyst done on THIS stock and in THIS sector?
    coverage, on_stock, score_of = {}, {}, {}
    for row, r in zip(rows, recs):
        coverage.setdefault(row["analyst_id"], row)
        score_of[r.analyst_id] = r.analyst.score
        st = on_stock.setdefault(r.analyst_id, {"calls": 0, "evaluated": 0, "hits": 0})
        st["calls"] += 1
        if r.status == "evaluated":
            st["evaluated"] += 1
            st["hits"] += int(bool(r.hit))
    covering = []
    for aid, row in coverage.items():
        st = on_stock[aid]
        st["hit_rate"] = round(100 * st["hits"] / st["evaluated"], 1) if st["evaluated"] else None
        sec = None
        sc = score_of.get(aid)
        if sc and sc.breakdown and s.sector:
            sec = next((x for x in sc.breakdown.get("by_sector", []) if x["sector"] == s.sector), None)
        covering.append(row | {"on_stock": st, "in_sector": sec, "overall_hit_rate": sc.raw_success if sc else None})
    covering.sort(key=lambda r: -(r["score"] or 0))

    last_px = (db.session.query(Price.date, Price.close).filter_by(stock_id=s.id)
               .order_by(Price.date.desc()).limit(2).all())
    return jsonify({
        "code": s.code, "name": s.name, "symbol": s.yf_symbol, "sector": s.sector,
        "last": {"date": last_px[0][0].isoformat(), "close": last_px[0][1],
                 "change": last_px[0][1] - last_px[1][1] if len(last_px) > 1 else None} if last_px else None,
        "counts": counts, "consensus": cons, "covering": covering, "recommendations": rows,
    })


@api.get("/stocks/<code>/prices")
def stock_prices(code):
    s = Stock.query.filter_by(code=code.zfill(4)).first() or abort(404)
    rows = db.session.query(Price.date, Price.close).filter_by(stock_id=s.id).order_by(Price.date).all()
    return jsonify([{"time": d.isoformat(), "value": round(c, 4)} for d, c in rows])


@api.get("/search")
def search():
    q = request.args.get("q", "").strip()
    if len(q) < 1:
        return jsonify({"stocks": [], "analysts": []})
    st = (Stock.query.filter(or_(Stock.name.ilike(f"%{q}%"), Stock.code.ilike(f"{q}%")))
          .order_by(Stock.name).limit(6).all())
    an = (db.session.query(Analyst, AnalystScore).join(Broker).options(joinedload(Analyst.broker))
          .outerjoin(AnalystScore, AnalystScore.analyst_id == Analyst.id)
          .filter(or_(Analyst.name.ilike(f"%{q}%"), Broker.name.ilike(f"%{q}%")))
          .order_by(AnalystScore.score.desc().nullslast()).limit(6).all())
    return jsonify({
        "stocks": [{"code": x.code, "name": x.name, "sector": x.sector} for x in st],
        "analysts": [{"id": a.id, "name": a.name, "broker": a.broker.name, "grade": sc.grade if sc else "N"}
                     for a, sc in an],
    })


@api.get("/search/analysts")
def search_analysts():
    """Split search endpoint used by the frontend Shell search box."""
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    an = (db.session.query(Analyst, AnalystScore).join(Broker).options(joinedload(Analyst.broker))
          .outerjoin(AnalystScore, AnalystScore.analyst_id == Analyst.id)
          .filter(or_(Analyst.name.ilike(f"%{q}%"), Broker.name.ilike(f"%{q}%")))
          .order_by(AnalystScore.score.desc().nullslast()).limit(6).all())
    return jsonify([{"id": a.id, "name": a.name, "broker": a.broker.name, "grade": sc.grade if sc else "N"}
                    for a, sc in an])


@api.get("/search/stocks")
def search_stocks():
    """Split search endpoint used by the frontend Shell search box."""
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    st = (Stock.query.filter(or_(Stock.name.ilike(f"%{q}%"), Stock.code.ilike(f"{q}%")))
          .order_by(Stock.name).limit(6).all())
    return jsonify([{"code": x.code, "name": x.name, "sector": x.sector} for x in st])


@api.get("/brokers")
def brokers():
    """Institution-level view (IR Table 3: broker 'used for institution-level analysis')."""
    rows = (db.session.query(Broker.id, Broker.name, Recommendation.rating, Recommendation.status,
                             Recommendation.hit, Recommendation.confidence_score, Recommendation.analyst_id)
            .join(Recommendation, Recommendation.broker_id == Broker.id).all())
    agg = {}
    for bid, name, rating, status, hit, trust, aid in rows:
        a = agg.setdefault(bid, {"id": bid, "name": name, "calls": 0, "analysts": set(), "evaluated": 0, "hits": 0,
                                 "BUY": 0, "HOLD": 0, "SELL": 0, "trust_sum": 0.0, "trust_n": 0})
        a["calls"] += 1
        a["analysts"].add(aid)
        a[rating] += 1
        if status == "evaluated":
            a["evaluated"] += 1
            a["hits"] += int(bool(hit))
        if trust is not None:
            a["trust_sum"] += trust
            a["trust_n"] += 1
    out = []
    for a in agg.values():
        n = a["calls"]
        out.append({"id": a["id"], "name": a["name"], "calls": n, "analysts": len(a["analysts"]),
                    "evaluated": a["evaluated"],
                    "hit_rate": round(100 * a["hits"] / a["evaluated"], 1) if a["evaluated"] else None,
                    "buy_share": round(100 * a["BUY"] / n, 1), "hold_share": round(100 * a["HOLD"] / n, 1),
                    "sell_share": round(100 * a["SELL"] / n, 1),
                    "buy_to_sell": round(a["BUY"] / a["SELL"], 1) if a["SELL"] else None,
                    "avg_trust": round(a["trust_sum"] / a["trust_n"], 1) if a["trust_n"] else None})
    out.sort(key=lambda r: -r["calls"])
    return jsonify({"items": out, "market": meta("market_bias", {}) | {"hit_rate": meta("market_score", {}).get("hit_rate")}})


# ---------------- CSV export (switched off by OPEN_DATA in config.py) ----------------
def _csv(rows: list[dict], name: str):
    from app.config import OPEN_DATA
    if not OPEN_DATA:
        abort(404)
    import csv
    import io

    from flask import Response
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={name}"})


@api.get("/export/recommendations.csv")
def export_recommendations():
    q = (db.session.query(Recommendation, Analyst, Broker, Stock)
         .join(Analyst, Recommendation.analyst_id == Analyst.id)
         .join(Broker, Recommendation.broker_id == Broker.id)
         .join(Stock, Recommendation.stock_id == Stock.id)
         .order_by(Recommendation.report_date))
    rows = [{"report_date": r.report_date.isoformat(), "stock": st.name, "code": st.code, "yahoo_symbol": st.yf_symbol,
             "sector": st.sector, "analyst": a.name, "broker": b.name, "rating": r.rating,
             "target_price": r.target_price, "eps_f": r.eps_f, "dps_f": r.dps_f, "report_year": r.report_year,
             "eval_end_date": r.eval_end_date.isoformat() if r.eval_end_date else None, "status": r.status,
             "entry_price": r.entry_price, "price_12m": r.price_12m, "return_12m": r.return_12m, "hit": r.hit,
             "tp_error": r.tp_error, "trust_score": r.confidence_score, "risk_score": r.risk_score,
             "risk_level": r.risk_level, "note": r.note}
            for r, a, b, st in q.all()]
    return _csv(rows, "analystrate_recommendations.csv")


@api.get("/export/analysts.csv")
def export_analysts():
    q = (db.session.query(Analyst, AnalystScore).join(AnalystScore, AnalystScore.analyst_id == Analyst.id)
         .options(joinedload(Analyst.broker)).order_by(AnalystScore.score.desc()))
    rows = []
    for a, s in q.all():
        b = s.bias or {}
        rows.append({"analyst": a.name, "broker": a.broker.name, "all_brokers": "; ".join(a.brokers or []),
                     "main_sector": s.primary_sector, "calls": s.n_calls, "scored_calls": s.n_evaluated,
                     "hit_rate": s.raw_success, "confidence_score": s.score, "grade": s.grade,
                     "thin_sample": s.thin_sample, **{f"factor_{k}": v for k, v in (s.factors or {}).items()},
                     "buy_share": b.get("buy_share"), "sell_share": b.get("sell_share"),
                     "buy_to_sell": b.get("buy_to_sell"), "tp_overshoot": b.get("tp_overshoot"),
                     "bias_flags": "; ".join(b.get("flags", []))})
    return _csv(rows, "analystrate_analysts.csv")


# ---------------- usability feedback (IR 4.3) ----------------
@api.post("/feedback")
def feedback():
    from app.models import Feedback
    data = request.get_json(silent=True) or {}
    try:
        clarity = int(data.get("clarity"))
        useful = int(data["useful"]) if data.get("useful") is not None else None
    except (TypeError, ValueError):
        abort(400)
    if not 1 <= clarity <= 5 or (useful is not None and not 1 <= useful <= 5):
        abort(400)
    db.session.add(Feedback(page=str(data.get("page", "unknown"))[:40], clarity=clarity, useful=useful,
                            comment=(str(data.get("comment") or "")[:1000] or None)))
    db.session.commit()
    return {"ok": True}, 201


@api.get("/feedback/summary")
def feedback_summary():
    from app.models import Feedback
    rows = (db.session.query(Feedback.page, func.count(Feedback.id), func.avg(Feedback.clarity), func.avg(Feedback.useful))
            .group_by(Feedback.page).all())
    total = db.session.query(func.count(Feedback.id)).scalar()
    comments = [c for (c,) in db.session.query(Feedback.comment).filter(Feedback.comment.isnot(None))
                .order_by(Feedback.created_at.desc()).limit(10)]
    return jsonify({"responses": total,
                    "by_page": [{"page": p, "responses": n, "clarity": round(float(c), 2) if c else None,
                                 "useful": round(float(u), 2) if u else None} for p, n, c, u in rows],
                    "recent_comments": comments})
