"""Cria alertas e dispara notificação no Discord."""

import logging

from sqlalchemy.orm import Session

from app.models import Ad, Alert, AlertType, Competitor, CompetitorTracker, Product, UserNotificationSettings
from app.notifications import discord

logger = logging.getLogger(__name__)

# Severidade (Módulo 7) — 🔴 crítico exige ação/olhar agora, 🟡 atenção é
# sinal relevante mas não urgente, 🟢 informação é só registro. Prefixado
# direto em `message` (não só no texto do Discord) porque esse app roda sem
# Discord configurado no setup local — se o emoji só existisse no texto que
# vai pro webhook, ele nunca apareceria em lugar nenhum que o usuário realmente vê.
_URGENCY = {
    AlertType.NEW_PRODUCT: "🔴",
    AlertType.STOCK_CHANGE: "🔴",
    AlertType.SCALING_DETECTED: "🔴",
    AlertType.WINNING_AD: "🟡",
    AlertType.VENDOR_CHANGED: "🟡",
    AlertType.SUPPLIER_ID_CHANGED: "🟡",
    AlertType.DUPLICATE_DETECTED: "🟡",
    AlertType.VARIATIONS_ADDED: "🟡",
    AlertType.PRICE_CHANGE: "🟡",
    AlertType.URGENCY_DETECTED: "🟡",
    AlertType.NEW_AD: "🟡",
    AlertType.NOT_SHOPIFY: "🟡",
    AlertType.PRODUCT_REMOVED: "🟢",
    AlertType.AD_KILLED: "🟢",
    AlertType.TITLE_CHANGE: "🟢",
    AlertType.IMAGE_CHANGE: "🟢",
}


async def create_alert(
    db: Session,
    competitor: Competitor,
    alert_type: AlertType,
    message: str,
    product: Product | None = None,
    ad: Ad | None = None,
    payload: dict | None = None,
    notify: bool = True,
) -> Alert:
    emoji = _URGENCY.get(alert_type, "🟢")
    alert = Alert(
        competitor_id=competitor.id,
        product_id=product.id if product else None,
        ad_id=ad.id if ad else None,
        alert_type=alert_type,
        message=f"{emoji} {message}",
        payload=payload,
    )
    db.add(alert)
    db.flush()

    if notify:
        # Link do produto tem prioridade só quando NÃO tem anúncio vinculado
        # — alerta de anúncio (novo/vencedor/morto) já é mais útil apontando
        # pra Ads Library (onde o criativo de verdade tá) do que pra página
        # do produto na loja. Usuário pediu link clicável em todo alerta que
        # tiver produto/anúncio, pra não precisar catar manualmente na aba
        # Produtos/Anúncios.
        link_url = ad.library_url if ad and ad.library_url else None
        if link_url is None and product is not None:
            link_url = f"https://{competitor.domain}/products/{product.handle}"
        alert.sent_to_discord = await discord.send_alert(competitor.name, alert_type, alert.message, link_url)

        # Canal pessoal (Módulo 9 — Minha Conta): todo usuário que rastreia
        # ESSE concorrente e configurou o próprio webhook recebe também, na
        # hora — além do canal global do admin acima, não em vez dele. Um
        # concorrente pode ter vários rastreadores (dado compartilhado, ver
        # CompetitorTracker); dedup por URL pra não mandar 2x se por acaso
        # dois usuários colarem o mesmo webhook.
        tracker_user_ids = [
            row[0]
            for row in db.query(CompetitorTracker.user_id)
            .filter(CompetitorTracker.competitor_id == competitor.id)
            .all()
        ]
        if tracker_user_ids:
            personal_webhooks = {
                row[0]
                for row in db.query(UserNotificationSettings.discord_webhook_url)
                .filter(
                    UserNotificationSettings.user_id.in_(tracker_user_ids),
                    UserNotificationSettings.discord_webhook_url.isnot(None),
                )
                .all()
            }
            for webhook_url in personal_webhooks:
                await discord.send_alert(competitor.name, alert_type, alert.message, link_url, webhook_url=webhook_url)

    return alert
