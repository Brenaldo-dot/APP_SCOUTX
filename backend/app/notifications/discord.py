"""Envio de alertas via Discord Webhook (Módulo 7)."""

import asyncio
import logging
import time

import httpx

from app.config import get_settings
from app.models import AlertType

logger = logging.getLogger(__name__)

# Mesma categorização usada na aba Alertas do frontend (components/Badges.jsx
# ALERT_CATEGORIES) — reproduzida aqui porque quem monta a mensagem do
# Discord é o backend, não o React. Usuário pediu explicitamente pra dar pra
# bater o olho se é PREÇO/ESTOQUE, ANÚNCIO ou SINAL DE ESCALA — cor do embed
# + título fazem isso sem precisar ler a mensagem inteira.
_CATEGORY_BY_TYPE: dict[AlertType, tuple[str, int]] = {
    AlertType.NEW_PRODUCT: ("📦 PRODUTO", 0x2563EB),
    AlertType.PRODUCT_REMOVED: ("📦 PRODUTO", 0x2563EB),
    AlertType.VENDOR_CHANGED: ("🏭 FORNECEDOR", 0xF97316),
    AlertType.SUPPLIER_ID_CHANGED: ("🏭 FORNECEDOR", 0xF97316),
    AlertType.NEW_AD: ("📣 ANÚNCIO", 0x1D4ED8),
    AlertType.WINNING_AD: ("📣 ANÚNCIO", 0x1D4ED8),
    AlertType.AD_KILLED: ("📣 ANÚNCIO", 0x1D4ED8),
    AlertType.SCALING_DETECTED: ("🚀 SINAL DE ESCALA", 0x7C3AED),
    AlertType.DUPLICATE_DETECTED: ("🚀 SINAL DE ESCALA", 0x7C3AED),
    AlertType.VARIATIONS_ADDED: ("🚀 SINAL DE ESCALA", 0x7C3AED),
    AlertType.PRICE_CHANGE: ("💲 PREÇO/ESTOQUE", 0xEAB308),
    AlertType.STOCK_CHANGE: ("💲 PREÇO/ESTOQUE", 0xEAB308),
    AlertType.NOT_SHOPIFY: ("⚠️ OUTROS", 0x6B7280),
    AlertType.TITLE_CHANGE: ("⚠️ OUTROS", 0x6B7280),
    AlertType.IMAGE_CHANGE: ("⚠️ OUTROS", 0x6B7280),
    AlertType.URGENCY_DETECTED: ("⚠️ OUTROS", 0x6B7280),
}
_DEFAULT_CATEGORY = ("⚠️ OUTROS", 0x6B7280)

# Discord aceita até 4096 na descrição do embed, mas copy de anúncio real
# (texto de venda inteiro) fica ilegível bem antes disso — corta com folga.
_DESCRIPTION_LIMIT = 1500


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.discord_webhook_url)


def _category_for(alert_type: AlertType) -> tuple[str, int]:
    return _CATEGORY_BY_TYPE.get(alert_type, _DEFAULT_CATEGORY)


async def send_alert(
    competitor_name: str,
    alert_type: AlertType,
    message: str,
    link_url: str | None = None,
    webhook_url: str | None = None,
) -> bool:
    """webhook_url explícito = canal PESSOAL de um usuário (Módulo 9 — Minha
    Conta); None = cai no canal global do admin (DISCORD_WEBHOOK_URL, env),
    comportamento original antes de existir webhook por usuário."""
    settings = get_settings()
    target = webhook_url or settings.discord_webhook_url
    if not target:
        logger.warning("Discord não configurado (DISCORD_WEBHOOK_URL ausente); alerta não enviado.")
        return False

    label, color = _category_for(alert_type)
    description = message if len(message) <= _DESCRIPTION_LIMIT else message[:_DESCRIPTION_LIMIT] + "…"

    embed: dict = {
        "title": label,
        "description": description,
        "color": color,
        "footer": {"text": competitor_name},
    }
    if link_url:
        # `url` no embed do Discord transforma o TÍTULO em link clicável —
        # usuário pediu pra conseguir abrir o produto/anúncio direto da
        # notificação, sem precisar catar manualmente na aba do app.
        embed["url"] = link_url

    payload: dict = {
        "embeds": [embed],
        # "parse": [] por padrão — sem isso, um @everyone/@here dentro do
        # copy de um anúncio de concorrente (dado não confiável, texto de
        # venda de terceiro) disparava pra galera toda do servidor.
        "allowed_mentions": {"parse": []},
    }
    # A menção configurada (DISCORD_MENTION_ID, env) é do ADMIN pro canal
    # GLOBAL dele — não faz sentido aplicar no webhook pessoal de outro
    # usuário, que é um servidor Discord diferente, com cargos/pessoas que
    # esse ID nem existe.
    if webhook_url is None and settings.discord_mention_id.strip().lower() == "everyone":
        # @everyone é uma menção especial do Discord — não é um snowflake
        # (ID), é o texto literal "@everyone" + "everyone" na allowlist de
        # parse. Um ID de usuário/cargo aqui não faria nada.
        payload["content"] = "@everyone"
        payload["allowed_mentions"] = {"parse": ["everyone"]}
    elif webhook_url is None and settings.discord_mention_id:
        payload["content"] = f"<@{settings.discord_mention_id}>"
        payload["allowed_mentions"] = {"users": [settings.discord_mention_id]}

    return await _post_with_rate_limit(target, payload)


# Achado ao vivo (2026-09-21 a 2026-09-23): rajadas de alerta (várias
# mudanças detectadas na mesma raspagem) mandavam um POST por alerta sem
# nenhum espaçamento, estourando o limite de taxa do PRÓPRIO Discord por
# webhook (~5 requisições a cada 2s) — resultado era "429 Too Many Requests"
# se repetindo e alertas de cliente se perdendo de verdade (o código só
# logava e desistia, nunca tentava de novo). Duas camadas de correção:
# 1) um espaçamento mínimo entre envios ao MESMO webhook (evita bater no
#    limite na maioria das vezes); 2) se mesmo assim vier 429, respeita o
#    `retry_after` que o próprio Discord manda no corpo da resposta e tenta
#    de novo (até 3 vezes) antes de desistir.
_last_sent_at: dict[str, float] = {}
_MIN_INTERVAL_SECONDS = 0.5


async def _post_with_rate_limit(webhook_url: str, payload: dict, max_retries: int = 3) -> bool:
    last_at = _last_sent_at.get(webhook_url, 0.0)
    wait = _MIN_INTERVAL_SECONDS - (time.monotonic() - last_at)
    if wait > 0:
        await asyncio.sleep(wait)

    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(max_retries + 1):
            try:
                response = await client.post(webhook_url, json=payload)
                _last_sent_at[webhook_url] = time.monotonic()
                if response.status_code == 429 and attempt < max_retries:
                    retry_after = _MIN_INTERVAL_SECONDS
                    try:
                        retry_after = max(retry_after, float(response.json().get("retry_after", 0)))
                    except (ValueError, KeyError):
                        pass
                    logger.warning(
                        "Discord: limite de taxa (429), tentando de novo em %.1fs (tentativa %d/%d)",
                        retry_after,
                        attempt + 1,
                        max_retries,
                    )
                    await asyncio.sleep(retry_after)
                    continue
                response.raise_for_status()
                return True
            except httpx.HTTPError:
                if attempt >= max_retries:
                    logger.exception("Falha ao enviar alerta para o Discord")
                    return False
    return False


async def send_test(webhook_url: str) -> bool:
    """Botão 'Testar' da tela Minha Conta — confirma que a URL colada é um
    webhook válido ANTES da pessoa depender dele pra receber alerta de
    verdade (erro de copiar/colar só apareceria dias depois, no primeiro
    alerta que nunca chegaria, sem isso)."""
    payload = {
        "embeds": [
            {
                "title": "✅ ScoutX conectado!",
                "description": "Esse é um teste, se você tá vendo essa mensagem, seus alertas vão chegar aqui a partir de agora.",
                "color": 0x22C55E,
            }
        ],
        "allowed_mentions": {"parse": []},
    }
    return await _post_with_rate_limit(webhook_url, payload)
