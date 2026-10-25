from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(model_class=Base)


def json_safe(v):
    """Make a value storable in a JSON column on every database: NaN/inf -> None, numpy -> Python.
    (SQLite accepts NaN inside JSON, PostgreSQL rejects it.)"""
    import math

    import numpy as np
    if isinstance(v, dict):
        return {str(k): json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [json_safe(x) for x in v]
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v
