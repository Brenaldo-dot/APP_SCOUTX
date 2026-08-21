"""
Cliente HTTP compartilhado pelos scrapers.

A rotação de proxy e o rate limiting existem para distribuir a carga de
monitorar muitas lojas todo dia sem martelar um único IP — não para burlar
autenticação ou acessar áreas não-públicas de um site.
"""

import itertools

import httpx

from app.config import get_settings

settings = get_settings()
_proxy_cycle = itertools.cycle(settings.proxy_list) if settings.proxy_list else None


def _next_proxy() -> str | None:
    return next(_proxy_cycle) if _proxy_cycle else None


def build_async_client(**overrides) -> httpx.AsyncClient:
    headers = {
        "User-Agent": settings.scraper_user_agent,
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,pt-BR;q=0.8",
    }
    kwargs = {
        "headers": headers,
        "timeout": httpx.Timeout(20.0),
        "follow_redirects": True,
    }
    proxy = _next_proxy()
    if proxy:
        kwargs["proxy"] = proxy
    kwargs.update(overrides)
    return httpx.AsyncClient(**kwargs)
