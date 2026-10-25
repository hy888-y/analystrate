"""Step 1 - import the cleaned recommendation dataset (IR 3.5 output) into the database.

Accepts .csv or .xlsx. Column names are matched loosely, so the exported file from the
Chapter 3 notebook works as-is (e.g. "Date", "Stock", "Code", "Analyst", "Broker",
"Rating"/"Std Rating", "Target Price", "EPS(F)", "DPS(F)").
Rating standardisation (IR Table 5) is re-applied defensively; anything that is not
BUY/HOLD/SELL after mapping is dropped.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from app.extensions import db
from app.models import Analyst, Broker, Recommendation, Stock

RATING_MAP = {  # IR Table 5
    "BUY": "BUY", "TRADING BUY": "BUY", "OUTPERFORM": "BUY", "ADD": "BUY", "OVERWEIGHT": "BUY",
    "HOLD": "HOLD", "NEUTRAL": "HOLD", "MARKET PERFORM": "HOLD",
    "SELL": "SELL", "UNDERPERFORM": "SELL", "UNDER PERFORM": "SELL", "REDUCE": "SELL",
    "UNDERWEIGHT": "SELL", "TRADING SELL": "SELL", "TAKE PROFIT": "SELL",
}

# canonical name -> accepted header spellings (lower-case, non-alphanumerics removed)
COLUMN_ALIASES = {
    "report_date": ["date", "reportdate", "publicationdate"],
    "stock": ["stock", "stockname", "company", "name"],
    "code": ["code", "stockcode", "bursacode"],
    "analyst": ["analyst", "analystname"],
    "broker": ["broker", "brokername", "brokerstd", "standardisedbroker", "investmentbank"],
    "rating": ["ratingstd", "stdrating", "standardisedrating", "ratingstandardised", "rating"],
    "target_price": ["targetprice", "tp", "target"],
    "eps_f": ["epsf", "eps", "forecasteps"],
    "dps_f": ["dpsf", "dps", "forecastdps"],
    "yf_symbol": ["yfsymbol", "yahoosymbol", "ticker", "symbol"],
    "report_year": ["reportyear", "year"],
}
REQUIRED = ["report_date", "stock", "code", "analyst", "broker", "rating"]


def _key(col: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(col).lower())


def read_dataset(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    raw = pd.read_excel(path) if path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path)
    keys = {_key(c): c for c in raw.columns}
    rename = {}
    for canon, aliases in COLUMN_ALIASES.items():
        for a in aliases:                       # first alias found wins (std rating before raw rating)
            if a in keys and keys[a] not in rename:
                rename[keys[a]] = canon
                break
    df = raw.rename(columns=rename)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing columns {missing}. Found: {list(raw.columns)}")

    df["report_date"] = pd.to_datetime(df["report_date"], dayfirst=True, errors="coerce").dt.date
    df["rating"] = df["rating"].astype(str).str.strip().str.upper().map(RATING_MAP)
    # keep the standardised spelling from IR 3.5.2 / Table 2 (RHB, CGS, AmInvestment...); only merge
    # names that differ by case (MAYBANK vs Maybank) into their most common spelling
    b = df["broker"].astype(str).str.strip()
    spelling = b.groupby(b.str.lower()).agg(lambda x: x.value_counts().idxmax())
    df["broker"] = b.str.lower().map(spelling)
    df["analyst"] = df["analyst"].astype(str).str.strip()
    df["stock"] = df["stock"].astype(str).str.strip()
    df["code"] = (df["code"].astype(str).str.strip().str.replace(r"\.0$", "", regex=True)
                  .str.replace(r"\.KL$", "", regex=True).str.upper().str.zfill(4))
    for c in ("target_price", "eps_f", "dps_f"):
        df[c] = pd.to_numeric(df[c], errors="coerce") if c in df.columns else None
    if "yf_symbol" not in df.columns:
        df["yf_symbol"] = df["code"] + ".KL"
    df["report_year"] = pd.to_datetime(df["report_date"]).dt.year   # IR 3.5.9 (re-derived so it always matches the date)

    before = len(df)
    df = df.dropna(subset=["report_date", "rating"])
    df = df[df["analyst"].str.len() > 0]
    print(f"read {before} rows -> kept {len(df)} BUY/HOLD/SELL rows with a valid date")
    return df.reset_index(drop=True)


def import_dataset(df: pd.DataFrame, replace: bool = True) -> dict:
    """Write brokers, analysts, stocks and recommendations. replace=True clears old recommendations."""
    if replace:
        db.session.query(Recommendation).delete()
        db.session.commit()

    brokers = {b.name: b for b in Broker.query.all()}
    for name in sorted(df["broker"].unique()):
        if name not in brokers:
            brokers[name] = Broker(name=name)
            db.session.add(brokers[name])
    db.session.flush()

    stocks = {s.code: s for s in Stock.query.all()}
    for (code, name, sym), _ in df.groupby(["code", "stock", "yf_symbol"]):
        if code not in stocks:
            stocks[code] = Stock(code=code, name=name, yf_symbol=sym)
            db.session.add(stocks[code])
    db.session.flush()

    # One analyst = one person (IR Table 3). Their broker is the broker of their latest call;
    # every broker they published for is kept in `brokers`, and each call keeps its own broker.
    analysts = {a.name: a for a in Analyst.query.all()}
    latest = df.sort_values("report_date").groupby("analyst")
    for aname, g in latest:
        firms = list(dict.fromkeys(g["broker"]))            # in order of first appearance
        current = brokers[g["broker"].iloc[-1]].id
        if aname not in analysts:
            analysts[aname] = Analyst(name=aname, broker_id=current, brokers=firms)
            db.session.add(analysts[aname])
        else:
            analysts[aname].broker_id, analysts[aname].brokers = current, firms
    db.session.flush()

    def num(v):
        return None if pd.isna(v) else float(v)

    rows = [
        Recommendation(
            report_date=r.report_date,
            analyst_id=analysts[r.analyst].id,
            broker_id=brokers[r.broker].id,
            stock_id=stocks[r.code].id,
            rating=r.rating,
            target_price=num(r.target_price),
            eps_f=num(r.eps_f),
            dps_f=num(r.dps_f),
            report_year=int(r.report_year),
        )
        for r in df.itertuples(index=False)
    ]
    db.session.bulk_save_objects(rows)
    db.session.commit()
    return {"brokers": len(brokers), "analysts": len(analysts), "stocks": len(stocks), "recommendations": len(rows)}
