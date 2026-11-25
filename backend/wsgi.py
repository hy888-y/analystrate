from app import create_app

app = create_app()

if __name__ == "__main__":
    # Flask's built-in development server can exit silently on Windows right after "Running on ...".
    # Waitress is a small pure-Python server that works on Windows and keeps running until Ctrl+C.
    try:
        from waitress import serve
    except ImportError:  # waitress not installed yet -> fall back to Flask's own server
        app.run(debug=True, port=5000, use_reloader=False)
    else:
        print("AnalystRate API running on http://127.0.0.1:5000  (keep this window open, Ctrl+C to stop)")
        serve(app, host="127.0.0.1", port=5000, threads=8)
