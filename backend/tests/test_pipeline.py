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
    assert set(r["risk"]["components"]) == {"track", "volatility", "confidence"}

    # Objective 3: every call carries its own trust score, explained factor by factor
    assert r["confidence_score"] is not None and len(r["confidence"]) == 4
    assert sum(f["points"] for f in r["confidence"]) == pytest.approx(r["confidence_score"], abs=0.05)
    assert all(f["evidence"] for f in r["confidence"])

    m = c.get("/api/meta").get_json()
    v = m["validation"]
    assert len(m["weights"]) == 4 and "weighted_auc" in v
    assert "model_comparison" not in v and "lime_test" not in v and "weights_vs_coef" not in v
    assert v["min_calls"]["rows"]
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


def test_fix_b_resolved_calls_evidence_is_point_in_time():
    """resolved_calls in evidence must only count analyst calls resolved before report_date (no look-ahead)."""
    from app.modules.confidence import call_level_scores
    df = _minimal_df(n_analysts=3, n_calls=12)
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
    # The very first call must have resolved_calls == 0 (no prior evaluated calls exist)
    first_i = out.sort_values("report_date").index[0]
    factors = out.loc[first_i, "confidence_factors"]
    assert factors["evidence"]["resolved_calls"] == 0


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


def test_confidence_score_unchanged_by_future_calls():
    """call_level_scores() confidence_score must not change when future calls are appended."""
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
        s_base = out_base.loc[out_base["id"] == rid, "confidence_score"].iloc[0]
        s_ext = out_ext.loc[out_ext["id"] == rid, "confidence_score"].iloc[0]
        assert s_base == pytest.approx(s_ext, abs=1e-6), f"confidence_score changed for id={rid}"


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
    """Scoring weights must remain exactly as approved in proposal: 4 factors at 25% each."""
    from app.config import WEIGHTS, RISK_WEIGHTS
    _THIRD = 1.0 / 3.0
    expected_weights = {"success": 0.25, "tp_accuracy": 0.25, "sector": 0.25, "consensus": 0.25}
    expected_risk = {"track": _THIRD, "volatility": _THIRD, "confidence": _THIRD}
    assert WEIGHTS == expected_weights
    assert RISK_WEIGHTS == pytest.approx(expected_risk)
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9
    assert abs(sum(RISK_WEIGHTS.values()) - 1.0) < 1e-9


def test_experience_not_in_confidence_score():
    """Experience depth must not be a scoring factor (proposal: 4 factors only)."""
    from app.config import WEIGHTS
    assert "experience" not in WEIGHTS


def test_risk_has_exactly_three_components():
    """Risk meter must have exactly three components (proposal: track, volatility, confidence)."""
    from app.config import RISK_WEIGHTS
    assert set(RISK_WEIGHTS.keys()) == {"track", "volatility", "confidence"}


def test_implied_move_not_in_risk_components():
    """implied_move must not be a risk component (removed per proposal)."""
    from app.config import RISK_WEIGHTS
    assert "implied_move" not in RISK_WEIGHTS


def test_alignment_not_in_risk_components():
    """alignment must not be a risk component (removed per proposal)."""
    from app.config import RISK_WEIGHTS
    assert "alignment" not in RISK_WEIGHTS


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


# ---- logistic regression tests ----

def _lr_df(n_calls=500, n_analysts=10, seed=99):
    """Minimal DataFrame with confidence_factors (PIT values), status, hit, and report_date."""
    rng = np.random.default_rng(seed)
    base = date(2020, 1, 1)
    rows = []
    for i in range(n_calls):
        d = base + timedelta(days=int(rng.integers(0, 1800)))
        is_ev = rng.random() > 0.2
        hit = bool(rng.random() > 0.4) if is_ev else None
        f_vals = {
            "success":     float(rng.uniform(20, 90)),
            "tp_accuracy": float(rng.uniform(20, 90)),
            "sector":      float(rng.uniform(20, 90)),
            "consensus":   float(rng.uniform(20, 90)),
        }
        rows.append({
            "id": i + 1,
            "analyst_id": i % n_analysts + 1,
            "report_date": d,
            "rating": "BUY",
            "status": "evaluated" if is_ev else "in_window",
            "hit": hit,
            "confidence_score": sum(0.25 * v for v in f_vals.values()),
            "confidence_factors": {"values": f_vals, "evidence": {}},
            "risk_score": float(rng.uniform(20, 80)),
            "risk_level": rng.choice(["Low", "Moderate", "Elevated", "High"]),
            "eval_end_date": d + timedelta(days=365),
        })
    return pd.DataFrame(rows)


def test_logit_excludes_unevaluated_calls():
    """LR training must use only evaluated calls; n_train <= number of evaluated pre-split calls."""
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=500)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    split = pd.Timestamp("2022-07-01")
    train, test = when < split, when >= split
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    if res["status"] == "ok":
        # n_train comes from evaluated calls only, so it cannot exceed train.sum()
        assert res["n_train"] <= int(train.sum())
        assert res["n_test"] <= int(test.sum())
        # Non-evaluated calls must not appear (n_train is bounded by evaluated-only subset)
        assert res["n_train"] <= int((ev["status"] == "evaluated").sum())


def test_logit_chronological_split_no_overlap():
    """Train and test masks must be mutually exclusive with no call in both partitions."""
    df = _lr_df(n_calls=500)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    split = pd.Timestamp("2022-07-01")
    train, test = when < split, when >= split
    assert not (train & test).any()
    assert (when[train] < split).all()
    assert (when[test] >= split).all()


def test_logit_features_are_pit_factor_keys():
    """Feature names must match exactly the four approved factor keys from WEIGHTS."""
    from app.config import WEIGHTS
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=500)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    if res["status"] == "ok":
        assert set(res["features"]) == set(WEIGHTS.keys())


def test_logit_metrics_all_present():
    """When status is ok, all required evaluation metrics must be present."""
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=600)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    if res["status"] == "ok":
        m = res["metrics"]
        assert all(k in m for k in ("auc", "accuracy", "precision", "recall", "f1", "confusion_matrix"))
        # confusion matrix is a 2x2 list
        assert isinstance(m["confusion_matrix"], list) and len(m["confusion_matrix"]) == 2
        assert len(m["confusion_matrix"][0]) == 2


def test_logit_coefficients_match_features():
    """Coefficients dict must have exactly the same keys as the features list."""
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=600)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    if res["status"] == "ok":
        assert set(res["coefficients"].keys()) == set(res["features"])


def test_logit_comparison_covers_all_factors():
    """Comparison list must have one entry per approved factor with required fields."""
    from app.config import WEIGHTS
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=600)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    if res["status"] == "ok":
        factors_compared = {c["factor"] for c in res["comparison"]}
        assert factors_compared == set(WEIGHTS.keys())
        for c in res["comparison"]:
            assert all(k in c for k in ("factor", "label", "lr_coef", "model_weight", "direction_agrees"))
            assert isinstance(c["direction_agrees"], bool)


def test_logit_handles_insufficient_data():
    """LR must return status='skipped' when training data has fewer than 50 rows."""
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=20)
    ev = df[df["status"] == "evaluated"].copy()
    ev["hit"] = ev["hit"].astype(bool)
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    assert res["status"] == "skipped"
    assert "reason" in res


def test_logit_handles_single_class_training():
    """LR must return status='skipped' when all training labels are the same class."""
    from pipeline.validate import logistic_regression_test
    df = _lr_df(n_calls=400)
    ev = df[df["status"] == "evaluated"].copy()
    ev = ev.copy()
    ev["hit"] = True   # force single class
    when = pd.to_datetime(ev["report_date"])
    train = when < pd.Timestamp("2022-07-01")
    test  = when >= pd.Timestamp("2022-07-01")
    res = logistic_regression_test(df, ev, train, test, "2022-07-01")
    assert res["status"] == "skipped"


def test_logit_in_end_to_end(app):
    """run_all() must include logit_test in the validation output stored in /api/meta."""
    m = app.test_client().get("/api/meta").get_json()
    v = m["validation"]
    assert "logit_test" in v
    lt = v["logit_test"]
    assert lt["status"] in ("ok", "skipped")
    if lt["status"] == "ok":
        from app.config import WEIGHTS
        assert lt["metrics"]["auc"] is not None
        assert len(lt["comparison"]) == len(WEIGHTS)
        assert set(lt["coefficients"].keys()) == set(WEIGHTS.keys())
