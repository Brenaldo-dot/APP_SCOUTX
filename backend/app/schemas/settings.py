from pydantic import BaseModel


class DiscordWebhookOut(BaseModel):
    discord_webhook_url: str | None


class DiscordWebhookUpdate(BaseModel):
    discord_webhook_url: str | None = None
