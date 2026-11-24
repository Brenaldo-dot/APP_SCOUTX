FROM python:3.12-slim

WORKDIR /app

# Memória: com muitas threads (threadpool do FastAPI pras rotas síncronas,
# threads soltas de enfileiramento em api/competitors.py, threads de limpeza)
# o glibc cria uma arena de malloc por thread e quase nunca devolve memória
# ao SO — RSS do uvicorn só sobe com o tempo mesmo sem vazamento em Python.
# Limitar a 2 arenas é a mitigação padrão pra isso. LOG_LEVEL: ver
# app/logging_config.py.
ENV MALLOC_ARENA_MAX=2 \
    LOG_LEVEL=INFO

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

COPY . .
RUN chmod +x start_all.sh

EXPOSE 8000

CMD ["bash", "start_all.sh"]
