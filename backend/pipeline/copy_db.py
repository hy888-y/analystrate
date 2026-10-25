"""Copy every table from one database to another (e.g. the local SQLite file -> PostgreSQL, or the
laptop's PostgreSQL -> a hosted PostgreSQL for the public website). Tables are created on the target
if needed, emptied, then filled in chunks in dependency order."""
from __future__ import annotations

from sqlalchemy import JSON, Float, create_engine, func, select, text

from app.extensions import db, json_safe


def _normalise(url: str) -> str:
    # hosted providers often give postgres:// or postgresql:// URLs; the project uses psycopg 3
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def copy_all(source_engine, target_url: str, chunk: int = 5000) -> dict:
    target = create_engine(_normalise(target_url))
    meta = db.metadata
    meta.create_all(target)
    tables = meta.sorted_tables
    counts = {}
    with target.begin() as tc:
        for t in reversed(tables):                 # children first
            tc.execute(t.delete())
    with source_engine.connect() as sc, target.begin() as tc:
        for t in tables:                           # parents first
            n = 0
            result = sc.execute(select(t)).mappings()
            fix = [c.name for c in t.columns if isinstance(c.type, (JSON, Float))]
            while rows := result.fetchmany(chunk):
                batch = [dict(r) for r in rows]
                for b in batch:
                    for c in fix:
                        b[c] = json_safe(b[c])
                tc.execute(t.insert(), batch)
                n += len(rows)
            counts[t.name] = n
        if target.dialect.name == "postgresql":    # keep auto-increment ids in step with the copied rows
            for t in tables:
                pk = list(t.primary_key.columns)
                if len(pk) == 1 and pk[0].autoincrement is not False and str(pk[0].type) == "INTEGER":
                    mx = tc.execute(select(func.max(pk[0]))).scalar() or 0
                    tc.execute(text(f"SELECT setval(pg_get_serial_sequence('{t.name}', '{pk[0].name}'), "
                                    f"{max(mx, 1)}, {'true' if mx else 'false'})"))
    return {"target": target.url.render_as_string(hide_password=True), "rows": counts}
