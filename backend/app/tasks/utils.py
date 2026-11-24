import asyncio
import logging
import threading
from collections.abc import Coroutine
from typing import TypeVar

T = TypeVar("T")


def run_async(coro: Coroutine[None, None, T]) -> T:
    """
    Tarefas Celery são síncronas; os services usam httpx/Playwright async.

    Num worker Celery normal (processo separado, sem event loop rodando),
    `asyncio.run()` funciona direto. Mas no modo eager local (sem Redis —
    ver `celery_task_always_eager` em app/config.py), a task roda no mesmo
    thread do event loop do FastAPI, e `asyncio.run()` não pode ser chamado
    com um loop já em execução — por isso o fallback abaixo roda a coroutine
    numa thread separada com o próprio loop nesse caso.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    box: dict[str, object] = {}

    def _runner() -> None:
        try:
            box["result"] = asyncio.run(coro)
        except BaseException as exc:  # repropagada na thread chamadora abaixo
            box["error"] = exc

    thread = threading.Thread(target=_runner)
    thread.start()
    thread.join()

    if "error" in box:
        raise box["error"]  # type: ignore[misc]
    return box["result"]  # type: ignore[return-value]


class BatchSummary:
    """Resumo por lote em vez de uma linha por item.

    Uso:
        summary = BatchSummary(logger, "Snapshot", total=len(competitors))
        for item in items:
            try: ...; summary.ok()
            except Exception: logger.exception(...); summary.error()
        summary.finish()  # "Snapshot: processados 48 itens em 312 s, 2 erros"

    Em lotes grandes também sai uma linha de progresso a cada `every` itens
    (padrão 500), pra dar pra acompanhar uma rodada longa sem log por item.
    Erros continuam sendo logados individualmente (WARNING/ERROR) por quem
    chama — o resumo só conta.
    """

    def __init__(self, logger, label: str, total: int | None = None, every: int = 500):
        import time

        self._time = time
        self.logger = logger
        self.label = label
        self.total = total
        self.every = every
        self.processed = 0
        self.errors = 0
        self.extra: dict[str, int] = {}
        self._t0 = time.perf_counter()

    def ok(self, **counters: int) -> None:
        for key, value in counters.items():
            self.extra[key] = self.extra.get(key, 0) + value
        self._tick()

    def error(self) -> None:
        self.errors += 1
        self._tick()

    def _tick(self) -> None:
        self.processed += 1
        if self.every and self.processed % self.every == 0 and self.processed != self.total:
            self.logger.info("%s: %s até agora", self.label, self._describe())

    def _describe(self) -> str:
        elapsed = self._time.perf_counter() - self._t0
        of_total = f"/{self.total}" if self.total is not None else ""
        extras = "".join(f", {v} {k}" for k, v in self.extra.items())
        return f"processados {self.processed}{of_total} itens em {elapsed:.0f} s, {self.errors} erros{extras}"

    def finish(self) -> dict:
        level = logging.WARNING if self.errors else logging.INFO
        self.logger.log(level, "%s: %s", self.label, self._describe())
        return {"ok": self.processed - self.errors, "failed": self.errors, **self.extra}
