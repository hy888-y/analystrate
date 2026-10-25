# Public deployment (IR Objective 4): one container serves the React website and the Flask API.
# Build:  docker build -t analystrate .      Run:  docker run -p 8000:8000 -e DATABASE_URL=... analystrate

# 1) build the React site
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) Python backend that also serves the built site (backend/app/__init__.py -> register_frontend)
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "gunicorn --chdir backend wsgi:app --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120"]
