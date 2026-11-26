"""Unit + end-to-end tests. Uses a small generated fixture (NOT real data) and fake prices,
so it runs offline. Run:  pytest -q"""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app import create_app
from app.config import WEIGHTS
from app.extensions import db
from app.models import Price, Stock
from pipeline.outcomes import evaluate, is_hit, split_factor


# ---------------- unit tests ----------------
def test_hit_rules():
    assert is_hit("BUY", 0.05) and not is_hit("BUY", -0.01)
    assert is_hit("SELL", -0.2) and not is_hit("SELL", 0.01)
    assert is_hit("HOLD", 0.08) and not is_hit("HOLD", -0.15)


def test_split_factor():
    s = {"2023-06-01": 2.0, "2024-06-01": 5.0}
    assert split_factor(s, date(2022, 1, 1)) == 10.0
    assert split_factor(s, date(2023, 12, 1)) == 5.0
    assert split_factor(s, date(2025, 1, 1)) == 1.0


def _series(start, n, p0=1.0, step=0.001):
    days = pd.bdate_range(start, periods=n)
    return pd.Series(p0 * np.exp(step * np.arange(n)), index=days.date)


def test_evaluate_statuses_and_splits():
    s = _series("2019-01-01", 1800)
    recs = pd.DataFrame([
        {"id": 1, "stock_id": 1, "report_date": date(2021, 3, 1), "rating": "BUY", "target_price": 99.0},
        {"id": 2, "stock_id": 1, "report_date": max(s.index) - timedelta(days=30), "rating": "SELL", "target_price": None},
        {"id": 3, "stock_id": 2, "report_date": date(2021, 3, 1), "rating": "HOLD", "target_price": 1.0},
    ])
    # 2-for-1 split on 2022-01-03: price as quoted on 2021-03-01 is 2x the Yahoo-adjusted price
    out = evaluate(recs, {1: s}, {1: {"2022-01-03": 2.0}}, as_of=max(s.index)).set_index("id")
    assert out.loc[1, "status"] == "evaluated" and out.loc[1, "hit"] is True
    adj_entry = s[s.index >= date(2021, 3, 1)].iloc[0]
    assert out.loc[1, "entry_price"] == pytest.approx(2 * adj_entry, rel=1e-3)
    assert out.loc[2, "status"] == "in_window"
    assert out.loc[3, "status"] == "no_price"
    assert out.loc[1, "volatility"] is not None


def test_delisted_exit():
    s = _series("2019-01-01", 600)            # series stops in mid-2021
    recs = pd.DataFrame([{"id": 1, "stock_id": 1, "report_date": date(2021, 1, 4), "rating": "BUY", "target_price": 5.0}])
    out = evaluate(recs, {1: s}, {}, as_of=date(2026, 1, 1))
    assert out.loc[0, "status"] == "evaluated" and out.loc[0, "note"] == "delisted_exit"


# ---------------- end-to-end ----------------
def make_fixture(tmp_path, n_analysts=12, n_stocks=10, n_calls=1500, seed=7):
    rng = np.random.default_rng(seed)
    codes = [f"{1000 + i:04d}" for i in range(n_stocks)]
    sectors = ["Financial Services", "Technology", "Energy"]
    rows = []
    for _ in range(n_calls):
        a = int(rng.integers(n_analysts))
        c = int(rng.integers(n_stocks))
        d = date(2020, 4, 20) + timedelta(days=int(rng.integers(0, 2190)))
        rating = rng.choice(["BUY", "OUTPERFORM", "HOLD", "SELL", "NOT RATED"], p=[.55, .15, .18, .1, .02])
        rows.append({"Date": d.strftime("%d/%m/%Y"), "Stock": f"Fixture Co {c}", "Code": int(codes[c]),
                     "Analyst": f"Analyst {a}", "Broker": f"Broker {a % 4}" if rng.random() < .8 else f"BROKER {a % 4}", "Rating": rating,
                     "Target Price": None if rng.random() < 0.05 else round(float(rng.uniform(1, 3)), 2),
                     "EPS(F)": None, "DPS(F)": None})
    path = tmp_path / "fixture.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    prices = {}
    for i, code in enumerate(codes):
        days = pd.bdate_range("2019-01-01", "2026-09-30")
        walk = np.exp(np.cumsum(rng.normal(0.0002, 0.015 + 0.002 * i, len(days))))
        prices[code] = (pd.Series(2.0 * walk, index=days.date), sectors[i % 3])
    return path, prices


@pytest.fixture()
def app(tmp_path):
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 't.db'}", "TESTING": True})
    with app.app_context():
        path, prices = make_fixture(tmp_path)
        from pipeline.compute import run_all
        from pipeline.load_dataset import import_dataset, read_dataset
        res = import_dataset(read_dataset(path))
        assert res["brokers"] == 4 and res["stocks"] == 10
        for st in Stock.query.all():
            s, sector = prices[st.code]
            db.session.bulk_save_objects([Price(stock_id=st.id, date=d, close=float(v)) for d, v in s.items()])
            st.has_prices, st.sector = True, sector
        db.session.commit()
        app.config["RESULT"] = run_all(as_of=date(2026, 9, 30))
    yield app


def test_end_to_end(app):
    res = app.config["RESULT"]
    assert res["summary"]["status"]["evaluated"] > 500
    assert res["validation"]["status"] == "ok"
    c = app.test_client()

    s = c.get("/api/summary").get_json()
    assert s["analysts"] == 12 and s["market_bias"]["buy_to_sell"] > 1

    lst = c.get("/api/analysts?min_calls=30").get_json()
    assert lst["count"] > 0
    scores = [x["score"] for x in lst["items"]]
    assert scores == sorted(scores, reverse=True)

    d = c.get(f"/api/analysts/{lst['items'][0]['id']}").get_json()
    assert sum(f["points"] for f in d["factors"]) == pytest.approx(d["score"], abs=0.05)
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9
    assert set(d["bias"]) >= {"buy_share", "sell_share", "tp_overshoot", "flags"}

    recs = c.get(f"/api/analysts/{d['id']}/recommendations?limit=10").get_json()
    assert recs["total"] > 10
    r = recs["items"][0]
    assert r["risk_level"] in {"Low", "Moderate", "Elevated", "High"}
    assert set(r["risk"]["components"]) == {"track", "volatility", "implied_move", "confidence", "alignment"}

    # Objective 3: every call carries its own trust score, explained factor by factor
    assert r["confidence_score"] is not None and len(r["confidence"]) == 5
    assert sum(f["points"] for f in r["confidence"]) == pytest.approx(r["confidence_score"], abs=0.05)
    assert all(f["evidence"] for f in r["confidence"])

    m = c.get("/api/meta").get_json()
    v = m["validation"]
    assert len(m["weights"]) == 5 and "logit_auc" in v
    assert {x["key"] for x in v["model_comparison"]} == {"weighted", "logit", "rf", "gb"}
    assert [x["factor"] for x in v["weights_vs_coef"]] == list(WEIGHTS)
    assert v["lime_test"]["transparent_fidelity_r2"] == 1.0 and v["min_calls"]["rows"]
    assert {b["flag"] for b in v["bias_test"]} == {"Optimism bias", "Sell avoidance", "Inflated targets"}
    assert v["cohorts"] and v["risk_test"]


def test_stock_brokers_exports_feedback(app):
    c = app.test_client()
    code = c.get("/api/stocks").get_json()[0]["code"]
    st = c.get(f"/api/stocks/{code}").get_json()
    cov = st["covering"][0]
    assert {"calls", "evaluated", "hits"} <= set(cov["on_stock"])        # IR 1.2: record on this stock

    b = c.get("/api/brokers").get_json()["items"]
    assert len(b) == 4 and sum(x["calls"] for x in b) == c.get("/api/summary").get_json()["recommendations"]

    # downloads are switched off on the public site (config.OPEN_DATA = False)
    assert c.get("/api/export/recommendations.csv").status_code == 404
    assert c.get("/api/export/analysts.csv").status_code == 404

    assert c.post("/api/feedback", json={"page": "analysts", "clarity": 4, "useful": 5}).status_code == 201
    assert c.post("/api/feedback", json={"page": "analysts", "clarity": 9}).status_code == 400
    assert c.get("/api/feedback/summary").get_json()["responses"] == 1

    s = c.get("/api/summary").get_json()
    assert "not a stock recommender" in s["disclaimer"] and "financial advice" in s["disclaimer"]


def test_analyst_is_one_person_across_brokers(tmp_path):
    """IR Table 3: the analyst (a person) is the unit of evaluation, even after moving broker."""
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'p.db'}", "TESTING": True})
    rows = [{"Date": "01/03/2024", "Stock": "A", "Code": 1, "Analyst": "Tan Ali", "Broker": "RHB", "Rating": "BUY", "Target Price": 1},
            {"Date": "01/06/2025", "Stock": "A", "Code": 1, "Analyst": "Tan Ali ", "Broker": "Kenanga", "Rating": "HOLD", "Target Price": 1}]
    path = tmp_path / "two.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    with app.app_context():
        from app.models import Analyst
        from pipeline.load_dataset import import_dataset, read_dataset
        res = import_dataset(read_dataset(path))
        assert res["analysts"] == 1
        a = Analyst.query.one()
        assert a.brokers == ["RHB", "Kenanga"] and a.broker.name == "Kenanga"


# ---- search endpoints ----

def test_search_analysts_endpoint(app):
    """GET /search/analysts?q= must return a list of analyst objects."""
    c = app.test_client()
    r = c.get("/api/search/analysts?q=Analyst").get_json()
    assert isinstance(r, list)
    if r:
        assert {"id", "name", "broker", "grade"} <= set(r[0])

def test_search_stocks_endpoint(app):
    """GET /search/stocks?q= must return a list of stock objects."""
    c = app.test_client()
    r = c.get("/api/search/stocks?q=Fixture").get_json()
    assert isinstance(r, list)
    if r:
        assert {"code", "name"} <= set(r[0])

def test_search_short_query_returns_empty(app):
    """Queries shorter than 2 characters must return empty lists."""
    c = app.test_client()
    assert c.get("/api/search/analysts?q=A").get_json() == []
    assert c.get("/api/search/stocks?q=F").get_json() == []

def test_search_no_results(app):
    """Query that matches nothing must return an empty list, not an error."""
    c = app.test_client()
    assert c.get("/api/search/analysts?q=ZZZNOMATCH").get_json() == []
    assert c.get("/api/search/stocks?q=ZZZNOMATCH").get_json() == []


# ---- bias tp_overshoot benchmark ----

def test_tp_overshoot_none_when_no_evaluated_buys():
    """compute_bias must return market tp_overshoot=None when no data, not 0.0."""
    from app.modules.bias import compute_bias
    df = pd.DataFrame([
        {"analyst_id": 1, "rating": "BUY", "status": "in_window", "target_price": 1.1,
         "price_12m": None, "hit": None},
    ])
    _, market = compute_bias(df)
    assert market["tp_overshoot"] is None

def test_tp_overshoot_no_false_flag_when_market_unavailable():
    """Analysts must NOT be flagged for 'Inflated targets' when the market benchmark is None."""
    from app.modules.bias import compute_bias
    from app.config import BIAS_TP_EXCESS_PTS
    df = pd.DataFrame([
        # analyst 1 has a high overshoot on an evaluated BUY; market has no evaluated BUYs from analyst 2
        {"analyst_id": 1, "rating": "BUY", "status": "evaluated", "target_price": 2.0,
         "price_12m": 1.0, "hit": False},
        {"analyst_id": 2, "rating": "HOLD", "status": "in_window", "target_price": None,
         "price_12m": None, "hit": None},
    ])
    per, market = compute_bias(df)
    # The market has an evaluated BUY here (analyst 1), so benchmark should exist
    # The flag should only appear when analyst overshoot exceeds market + threshold
    assert market["tp_overshoot"] is not None
    # Now test with truly empty market benchmark
    df2 = pd.DataFrame([
        {"analyst_id": 1, "rating": "BUY", "status": "in_window", "target_price": 5.0,
         "price_12m": None, "hit": None},
    ])
    per2, market2 = compute_bias(df2)
    assert market2["tp_overshoot"] is None
    assert "Inflated targets" not in per2[1]["flags"]


def _snap(date_str: str, price_days: list) -> "str | None":
    """Python mirror of frontend/src/utils/snap.ts snapToTradingDay."""
    if not price_days:
        return None
    if date_str < price_days[0]:
        return None
    if date_str > price_days[-1]:
        return None
    return next((t for t in price_days if t >= date_str), None)


def test_snap_returns_none_when_prices_empty():
    assert _snap("2024-01-01", []) is None


def test_snap_returns_none_before_first_price_date():
    days = ["2024-01-10", "2024-01-11", "2024-01-12"]
    assert _snap("2024-01-09", days) is None   # one day before first price


def test_snap_returns_none_after_last_price_date():
    days = ["2024-01-10", "2024-01-11", "2024-01-12"]
    assert _snap("2024-01-13", days) is None   # one day after last price


def test_snap_exact_first_day():
    days = ["2024-01-10", "2024-01-11", "2024-01-12"]
    assert _snap("2024-01-10", days) == "2024-01-10"


def test_snap_exact_last_day():
    days = ["2024-01-10", "2024-01-11", "2024-01-12"]
    assert _snap("2024-01-12", days) == "2024-01-12"


def test_snap_weekend_snaps_forward_to_monday():
    # 2024-01-13 is Saturday; next trading day is 2024-01-15 (Monday)
    days = ["2024-01-12", "2024-01-15", "2024-01-16"]
    assert _snap("2024-01-13", days) == "2024-01-15"
