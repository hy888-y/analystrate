from app import create_app

app = create_app()

if __name__ == "__main__":
    # use_reloader=False: the auto-reloader can exit silently on Windows; restart manually after code changes
    app.run(debug=True, port=5000, use_reloader=False)
