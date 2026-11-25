"""Module 2 - Analyst Bias Detection (IR 2.2.2: Michaely & Womack 1999; Lim 2001).

Each bias driver becomes a measurable behaviour compared with the market average:
  buy share (optimism), sell share (sell avoidance), and target overshoot on BUY calls:
  the average deviation of the target price from the realised 12-month price, TP / P12 - 1, on
  evaluated BUYs (how far targets ran ahead of reality). Each deviation is capped at +/-100%, the same
  cap used for target-price error, so one stale target cannot dominate the average.
"""
from __future__ import annotations

import pandas as pd

from app.config import BIAS_BUY_EXCESS_PTS, BIAS_SELL_RATIO, BIAS_TP_EXCESS_PTS


def _overshoot(g: pd.DataFrame) -> float | None:
    b = g[(g["status"] == "evaluated") & (g["rating"] == "BUY") & g["target_price"].notna()]
    b = b[b["price_12m"].astype(float) > 0]
    if b.empty:
        return None
    dev = (b["target_price"].astype(float) / b["price_12m"].astype(float) - 1).clip(-1.0, 1.0)
    return float(dev.mean() * 100)


def compute_bias(df: pd.DataFrame) -> tuple[dict[int, dict], dict]:
    share = df["rating"].value_counts(normalize=True) * 100
    market_overshoot = _overshoot(df)   # None when no evaluated BUY calls with targets exist
    market = {
        "buy_share": round(float(share.get("BUY", 0)), 2),
        "hold_share": round(float(share.get("HOLD", 0)), 2),
        "sell_share": round(float(share.get("SELL", 0)), 2),
        "tp_overshoot": None if market_overshoot is None else round(market_overshoot, 2),
    }
    market["buy_to_sell"] = round(market["buy_share"] / market["sell_share"], 2) if market["sell_share"] else None

    per = {}
    for aid, g in df.groupby("analyst_id"):
        s = g["rating"].value_counts(normalize=True) * 100
        b = {
            "buy_share": round(float(s.get("BUY", 0)), 2),
            "hold_share": round(float(s.get("HOLD", 0)), 2),
            "sell_share": round(float(s.get("SELL", 0)), 2),
            "tp_overshoot": None if (o := _overshoot(g)) is None else round(o, 2),
        }
        b["buy_to_sell"] = round(b["buy_share"] / b["sell_share"], 2) if b["sell_share"] else None
        flags = []
        if b["buy_share"] > market["buy_share"] + BIAS_BUY_EXCESS_PTS:
            flags.append("Optimism bias")
        if b["sell_share"] < market["sell_share"] * BIAS_SELL_RATIO:
            flags.append("Sell avoidance")
        # Only flag "Inflated targets" when the market benchmark is actually available.
        # Comparing against 0.0 (a false default) would produce misleading flags.
        if (b["tp_overshoot"] is not None and market_overshoot is not None
                and b["tp_overshoot"] > market_overshoot + BIAS_TP_EXCESS_PTS):
            flags.append("Inflated targets")
        b["flags"] = flags
        per[int(aid)] = b
    return per, market
