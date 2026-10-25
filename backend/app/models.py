"""Relational schema (IR 2.4.5): broker -> analyst -> recommendation <- stock, plus prices and computed scores.

An analyst is one person (IR Table 3: "Analyst = the unit of evaluation"), so the same person who moved
broker keeps one track record. The broker of each call is stored on the recommendation itself.
"""
from datetime import UTC, date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .extensions import db


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


class Broker(db.Model):
    __tablename__ = "broker"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    analysts = relationship("Analyst", back_populates="broker")


class Analyst(db.Model):
    __tablename__ = "analyst"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    broker_id: Mapped[int] = mapped_column(ForeignKey("broker.id"))          # broker of the latest call
    brokers: Mapped[Optional[list]] = mapped_column(JSON)                      # every broker they published for
    broker = relationship("Broker", back_populates="analysts")
    recommendations = relationship("Recommendation", back_populates="analyst")
    score = relationship("AnalystScore", uselist=False, back_populates="analyst")


class Stock(db.Model):
    __tablename__ = "stock"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)       # Bursa code, zero-padded e.g. 0205
    name: Mapped[str] = mapped_column(String(120))
    yf_symbol: Mapped[str] = mapped_column(String(16))                # e.g. 0205.KL
    sector: Mapped[Optional[str]] = mapped_column(String(80))
    has_prices: Mapped[bool] = mapped_column(Boolean, default=False)
    splits: Mapped[Optional[dict]] = mapped_column(JSON)               # {"YYYY-MM-DD": ratio} from Yahoo


class Price(db.Model):
    __tablename__ = "price"
    stock_id: Mapped[int] = mapped_column(ForeignKey("stock.id"), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float)


class Recommendation(db.Model):
    __tablename__ = "recommendation"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[date] = mapped_column(Date, index=True)
    analyst_id: Mapped[int] = mapped_column(ForeignKey("analyst.id"), index=True)
    broker_id: Mapped[int] = mapped_column(ForeignKey("broker.id"), index=True)
    stock_id: Mapped[int] = mapped_column(ForeignKey("stock.id"), index=True)
    rating: Mapped[str] = mapped_column(String(4))                    # BUY / HOLD / SELL
    target_price: Mapped[Optional[float]] = mapped_column(Float)
    eps_f: Mapped[Optional[float]] = mapped_column(Float)
    dps_f: Mapped[Optional[float]] = mapped_column(Float)
    report_year: Mapped[Optional[int]] = mapped_column(Integer, index=True)   # IR 3.5.9, cohort analysis

    # ---- outcome (pipeline/outcomes.py) ----
    status: Mapped[str] = mapped_column(String(12), default="pending")  # evaluated | in_window | no_price
    eval_end_date: Mapped[Optional[date]] = mapped_column(Date)
    entry_price: Mapped[Optional[float]] = mapped_column(Float)
    price_12m: Mapped[Optional[float]] = mapped_column(Float)
    return_12m: Mapped[Optional[float]] = mapped_column(Float)
    hit: Mapped[Optional[bool]] = mapped_column(Boolean)
    tp_error: Mapped[Optional[float]] = mapped_column(Float)          # |P12 - TP| / entry
    consensus_tp_error: Mapped[Optional[float]] = mapped_column(Float)  # same, using peers' mean target
    consensus_agree: Mapped[Optional[bool]] = mapped_column(Boolean)
    note: Mapped[Optional[str]] = mapped_column(String(40))            # e.g. delisted_exit, no_target
    volatility: Mapped[Optional[float]] = mapped_column(Float)         # trailing annualised, at call date

    # ---- Module 1 at call level: recommendation trust score (IR Objective 3) ----
    confidence_score: Mapped[Optional[float]] = mapped_column(Float)
    confidence_factors: Mapped[Optional[dict]] = mapped_column(JSON)   # factor values + evidence known at the call date

    # ---- Module 3: risk meter (app/modules/risk.py) ----
    risk_score: Mapped[Optional[float]] = mapped_column(Float)
    risk_level: Mapped[Optional[str]] = mapped_column(String(10))
    risk_components: Mapped[Optional[dict]] = mapped_column(JSON)

    analyst = relationship("Analyst", back_populates="recommendations")
    broker = relationship("Broker")
    stock = relationship("Stock")


class AnalystScore(db.Model):
    __tablename__ = "analyst_score"
    analyst_id: Mapped[int] = mapped_column(ForeignKey("analyst.id"), primary_key=True)
    n_calls: Mapped[int] = mapped_column(Integer)
    n_evaluated: Mapped[int] = mapped_column(Integer)
    primary_sector: Mapped[Optional[str]] = mapped_column(String(80))
    raw_success: Mapped[Optional[float]] = mapped_column(Float)
    factors: Mapped[dict] = mapped_column(JSON)           # {factor: 0-100}
    score: Mapped[float] = mapped_column(Float, index=True)
    grade: Mapped[str] = mapped_column(String(1))
    thin_sample: Mapped[bool] = mapped_column(Boolean)
    bias: Mapped[dict] = mapped_column(JSON)              # shares, overshoot, flags
    breakdown: Mapped[Optional[dict]] = mapped_column(JSON)   # by sector / by report year
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    analyst = relationship("Analyst", back_populates="score")


class Meta(db.Model):
    """Key/value store for market baselines and validation results."""
    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class Feedback(db.Model):
    """Anonymous in-app usability feedback (IR 4.3: dashboard usability for non-technical investors)."""
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    page: Mapped[str] = mapped_column(String(40), index=True)
    clarity: Mapped[int] = mapped_column(Integer)          # 1-5: "this page was easy to understand"
    useful: Mapped[Optional[int]] = mapped_column(Integer)  # 1-5: "this helps me judge whom to trust"
    comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
