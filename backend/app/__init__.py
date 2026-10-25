"""Flask application factory (pattern from the official Flask tutorial)."""
import json
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, send_from_directory
from flask_cors import CORS

from .config import Config
from .extensions import db

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(config_overrides: dict | None = None) -> Flask:
    load_dotenv()
    app = Flask(__name__)
    app.config.from_object(Config)
    app.json.sort_keys = False
    if config_overrides:
        app.config.update(config_overrides)

    db.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    from .api.routes import api
    app.register_blueprint(api, url_prefix="/api")

    with app.app_context():
        from . import models  # noqa: F401
        db.create_all()

    register_frontend(app)
    register_cli(app)
    return app


def register_frontend(app: Flask) -> None:
    """Public deployment (IR Objective 4): after `npm run build`, Flask serves the React site itself,
    so one server (one URL) runs the whole system. In development Vite still serves the site."""
    @app.get("/")
    @app.get("/<path:path>")
    def site(path: str = ""):
        if path.startswith("api/"):
            return {"error": "not found"}, 404
        if not (FRONTEND_DIST / "index.html").exists():
            return {"message": "API is running. Start the website with `npm run dev` in the frontend folder, "
                               "or run `npm run build` once to let Flask serve it."}, 200
        target = FRONTEND_DIST / path
        if path and target.is_file():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, "index.html")   # React Router handles the URL


def register_cli(app: Flask) -> None:
    @app.cli.command("load-data")
    @click.argument("path")
    def load_data(path):
        """Import the cleaned dataset (.csv / .xlsx) from IR Chapter 3."""
        from pipeline.load_dataset import import_dataset, read_dataset
        click.echo(import_dataset(read_dataset(path)))

    @app.cli.command("fetch-prices")
    @click.option("--refresh", is_flag=True, help="Ignore the CSV cache and download again.")
    def fetch_prices(refresh):
        """Download .KL daily prices + sectors from Yahoo Finance."""
        from pipeline.prices import fetch_all
        click.echo(fetch_all(app.config["PRICE_CACHE_DIR"], refresh=refresh))

    def _compute():
        from pipeline.compute import run_all
        res = run_all()
        click.echo(json.dumps({"summary": res["summary"], "validation": res["validation"]}, indent=1, default=str))

    @app.cli.command("compute")
    def compute():
        """Compute 12-month outcomes, confidence scores, bias flags, risk levels and the evaluation."""
        _compute()

    @app.cli.command("refresh")
    def refresh():
        """Maintenance (CRISP-DM Deployment): download the newest prices, then recompute everything."""
        from pipeline.prices import fetch_all
        click.echo(fetch_all(app.config["PRICE_CACHE_DIR"], refresh=True))
        _compute()

    @app.cli.command("copy-db")
    @click.argument("target_url")
    def copy_db(target_url):
        """Copy every table from the current database into TARGET_URL (e.g. a PostgreSQL URL),
        so nothing has to be downloaded or recomputed again."""
        from pipeline.copy_db import copy_all
        click.echo(copy_all(db.engine, target_url))

    @app.cli.command("reset-db")
    def reset_db():
        """Drop and recreate all tables."""
        db.drop_all()
        db.create_all()
        click.echo("database reset")
