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


# ---- point-in-time fix regression tests ----

def _minimal_df(n_analysts=2, n_calls=6, seed=42):
    """Return a minimal recommendations DataFrame for unit testing PIT fixes."""
    rng = np.random.default_rng(seed)
    rows = []
    base = date(2021, 1, 1)
    for i in range(n_calls):
        aid = i % n_analysts + 1
        d = base + timedelta(days=i * 60)
        eval_d = d + timedelta(days=365)
        rows.append({
            "id": i + 1,
            "analyst_id": aid,
            "stock_id": 1,
            "report_date": d,
            "rating": "BUY",
            "target_price": 1.1,
            "entry_price": 1.0,
            "price_12m": 1.05,
            "volatility": 0.2 + 0.01 * i,
            "eval_end_date": eval_d,
            "status": "evaluated",
            "hit": bool(i % 2 == 0),
            "tp_error": 0.05,
            "confidence_score": 60.0,
            "peer_n": 0,
            "peer_view": None,
            "peer_share": 0.5,
        })
    return pd.DataFrame(rows)


def test_fix_a_market_baseline_fallback():
    """Fix A: when no prior market outcomes exist, prior_hit_rate must be 0.5."""
    from app.modules.risk import point_in_time_track
    df = _minimal_df()
    out = point_in_time_track(df)
    # The first call (earliest report_date) has no earlier resolved outcomes → fallback 0.5
    first = out.sort_values("report_date").iloc[0]
    assert first["prior_hit_rate"] == pytest.approx(0.5)
    assert first["prior_scope"] == "market"


def test_fix_a_no_future_outcomes_in_market_baseline():
    """Fix A: market baseline for scope='market' must only use outcomes with eval_end_date < report_date."""
    from app.modules.risk import point_in_time_track
    df = _minimal_df(n_calls=6)
    out = point_in_time_track(df)
    ev = df[df["status"] == "evaluated"].copy()
    ev["eval_end_date"] = pd.to_datetime(ev["eval_end_date"])
    for _, row in out[out["prior_scope"] == "market"].iterrows():
        d = pd.Timestamp(row["report_date"])
        prior_ev = ev[ev["eval_end_date"] < d]
        expected = float(prior_ev["hit"].astype(bool).mean()) if len(prior_ev) else 0.5
        assert row["prior_hit_rate"] == pytest.approx(expected, abs=1e-9)


def test_fix_b_ref_n_is_point_in_time():
    """Fix B: ref_n for experience factor must only use analyst counts resolved before report_date."""
    from app.modules.confidence import call_level_scores
    df = _minimal_df(n_analysts=3, n_calls=12)
    # drop columns call_level_scores will produce itself to avoid join collision
    df = df.drop(columns=["confidence_score"], errors="ignore")
    df["sector"] = "Technology"
    df["consensus_agree"] = None
    df["peer_n"] = 0
    df["peer_share"] = 0.5
    df["peer_view"] = None
    sector_of = {1: "Technology"}
    out = call_level_scores(df, sector_of)
    # All calls must have a confidence_score computed (no crash / NaN)
    assert out["confidence_score"].notna().all()
    # Experience factor for the very first call must be 0 (no prior resolved calls)
    first_i = out.sort_values("report_date").index[0]
    factors = out.loc[first_i, "confidence_factors"]
    assert factors["values"]["experience"] == pytest.approx(0.0)


def test_fix_c_same_day_peers_excluded():
    """Fix C: peer_share must not count same-day recommendations as backward-looking peers."""
    from pipeline.outcomes import add_consensus
    # Two analysts publish on the same day: same-day call must NOT see each other in peer_share
    d = date(2022, 6, 1)
    df = pd.DataFrame([
        {"id": 1, "analyst_id": 1, "stock_id": 1, "report_date": d, "rating": "BUY",
         "target_price": 1.1, "entry_price": 1.0, "price_12m": 1.05,
         "status": "evaluated", "hit": True, "eval_end_date": d + timedelta(days=365)},
        {"id": 2, "analyst_id": 2, "stock_id": 1, "report_date": d, "rating": "SELL",
         "target_price": 0.9, "entry_price": 1.0, "price_12m": 1.05,
         "status": "evaluated", "hit": False, "eval_end_date": d + timedelta(days=365)},
    ])
    out = add_consensus(df)
    # Both calls are on the same day — neither should count the other as a prior peer
    assert int(out.loc[0, "peer_n"] or 0) == 0
    assert int(out.loc[1, "peer_n"] or 0) == 0


# ---- _pit_percentile same-date and future-data regression tests ----

def test_pit_percentile_same_date_excluded_from_peer_pool():
    """Same-date recommendations must not influence each other's percentile rank."""
    from app.modules.risk import _pit_percentile
    # Three calls on the same day with different volatilities.
    # Each call's pool = prior calls (none here) + itself, so all three get 100th percentile.
    vals = pd.Series([0.1, 0.5, 0.9])
    dts = pd.Series(["2022-01-01", "2022-01-01", "2022-01-01"])
    result = _pit_percentile(vals, dts)
    # Without same-date peers each call compares only against itself → all 100.0
    assert list(result) == pytest.approx([100.0, 100.0, 100.0])


def test_pit_percentile_future_calls_cannot_change_historical_score():
    """Adding a future call must not alter the percentile rank of an earlier call."""
    from app.modules.risk import _pit_percentile
    vals_base = pd.Series([0.2, 0.4])
    dts_base = pd.Series(["2022-01-01", "2022-06-01"])
    result_base = _pit_percentile(vals_base, dts_base)

    # Add a call far in the future with an extreme value
    vals_ext = pd.Series([0.2, 0.4, 0.99])
    dts_ext = pd.Series(["2022-01-01", "2022-06-01", "2025-01-01"])
    result_ext = _pit_percentile(vals_ext, dts_ext)

    # The first two calls' percentiles must be identical with or without the future call
    assert result_base[0] == pytest.approx(result_ext[0])
    assert result_base[1] == pytest.approx(result_ext[1])


def test_risk_score_unchanged_by_future_calls():
    """compute_risk() result for earlier calls must not change when future calls are appended."""
    from app.modules.risk import compute_risk
    df = _minimal_df(n_calls=4)
    df["confidence_score"] = 60.0
    df["peer_n"] = 0
    df["peer_share"] = 0.5
    df["peer_view"] = None
    df = df.drop(columns=["confidence_score"], errors="ignore")
    df["confidence_score"] = 60.0

    out_base = compute_risk(df.copy())

    # Append two calls dated far in the future
    future = df.iloc[:2].copy()
    future["id"] = [999, 998]
    future["report_date"] = [date(2030, 1, 1), date(2030, 6, 1)]
    future["eval_end_date"] = [date(2031, 1, 1), date(2031, 6, 1)]
    df_ext = pd.concat([df, future], ignore_index=True)
    out_ext = compute_risk(df_ext)

    orig_ids = set(df["id"])
    for rid in orig_ids:
        s_base = out_base.loc[out_base["id"] == rid, "risk_score"].iloc[0]
        s_ext = out_ext.loc[out_ext["id"] == rid, "risk_score"].iloc[0]
        assert s_base == pytest.approx(s_ext, abs=1e-6), f"risk_score changed for id={rid}"


def test_confidence_experience_unchanged_by_future_calls():
    """call_level_scores() experience factor must not change when future calls are appended."""
    from app.modules.confidence import call_level_scores
    df = _minimal_df(n_analysts=2, n_calls=6)
    df = df.drop(columns=["confidence_score"], errors="ignore")
    df["sector"] = "Technology"
    df["consensus_agree"] = None
    df["peer_n"] = 0
    df["peer_share"] = 0.5
    df["peer_view"] = None
    sector_of = {1: "Technology"}

    out_base = call_level_scores(df.copy(), sector_of)

    future = df.iloc[:2].copy()
    future["id"] = [997, 996]
    future["report_date"] = [date(2030, 1, 1), date(2030, 6, 1)]
    future["eval_end_date"] = [date(2031, 1, 1), date(2031, 6, 1)]
    df_ext = pd.concat([df, future], ignore_index=True)
    out_ext = call_level_scores(df_ext, sector_of)

    orig_ids = set(df["id"])
    for rid in orig_ids:
        exp_base = out_base.loc[out_base["id"] == rid, "confidence_factors"].iloc[0]["values"]["experience"]
        exp_ext = out_ext.loc[out_ext["id"] == rid, "confidence_factors"].iloc[0]["values"]["experience"]
        assert exp_base == pytest.approx(exp_ext, abs=1e-6), f"experience changed for id={rid}"


def test_earlier_calls_eligible_for_consensus():
    """A call published before another must appear as that later call's backward-looking peer."""
    from pipeline.outcomes import add_consensus
    d_early = date(2022, 1, 1)
    d_late = date(2022, 3, 1)   # 59 days later — within the 90-day window
    df = pd.DataFrame([
        {"id": 1, "analyst_id": 1, "stock_id": 1, "report_date": d_early, "rating": "BUY",
         "target_price": 1.1, "entry_price": 1.0, "price_12m": 1.05,
         "status": "evaluated", "hit": True, "eval_end_date": d_early + timedelta(days=365)},
        {"id": 2, "analyst_id": 2, "stock_id": 1, "report_date": d_late, "rating": "BUY",
         "target_price": 1.1, "entry_price": 1.0, "price_12m": 1.05,
         "status": "evaluated", "hit": True, "eval_end_date": d_late + timedelta(days=365)},
    ])
    out = add_consensus(df)
    # The later call (id=2) must see the earlier call as a peer
    later = out[out["id"] == 2].iloc[0]
    assert int(later["peer_n"] or 0) == 1
    assert float(later["peer_share"]) == pytest.approx(1.0)   # both BUY


def test_scoring_weights_unchanged():
    """Scoring weights must remain exactly as approved in config."""
    from app.config import WEIGHTS, RISK_WEIGHTS
    expected_weights = {"success": 0.30, "tp_accuracy": 0.25, "experience": 0.15, "sector": 0.15, "consensus": 0.15}
    expected_risk = {"track": 0.30, "volatility": 0.25, "implied_move": 0.15, "confidence": 0.15, "alignment": 0.15}
    assert WEIGHTS == expected_weights
    assert RISK_WEIGHTS == expected_risk
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9
    assert abs(sum(RISK_WEIGHTS.values()) - 1.0) < 1e-9


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
