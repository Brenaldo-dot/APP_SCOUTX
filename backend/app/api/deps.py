"""Identidade do usuário logado, repassada pelo proxy Node (server.js).

O FastAPI nunca teve conceito de usuário — sempre confiou cegamente em
qualquer coisa vinda do proxy. Multi-tenant (cada usuário só vê os próprios
concorrentes) exige saber QUEM está pedindo; como app_users vive num banco
Postgres separado (o do app Node), não dá pra ter FK de verdade aqui — o
Node manda o id em um header a cada chamada de /api/minerador/*
(ver server.js), e este arquivo só lê esse header. Mesmo modelo de confiança
que já existia pra permissão de admin (nunca foi validado com assinatura),
só que agora explícito por usuário em vez de só um proxy geral.
"""

from fastapi import Header, HTTPException


class CurrentUser:
    def __init__(self, id: int, is_admin: bool):
        self.id = id
        self.is_admin = is_admin


def get_current_user(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_is_admin: str | None = Header(default=None, alias="X-User-Is-Admin"),
) -> CurrentUser:
    if not x_user_id or not x_user_id.isdigit():
        raise HTTPException(401, "Identidade do usuário não veio na requisição (header X-User-Id ausente)")
    return CurrentUser(id=int(x_user_id), is_admin=x_user_is_admin == "true")


def resolve_target_user(current_user: CurrentUser, as_user_id: int | None) -> int:
    """`as_user_id` é como o admin pede pra ver a lista de outra pessoa
    (painel de auditoria) — qualquer um tentando ver o de outro usuário sem
    ser admin toma 403. Sem `as_user_id`, todo mundo (admin incluso) vê só
    a própria lista."""
    if as_user_id is not None and as_user_id != current_user.id:
        if not current_user.is_admin:
            raise HTTPException(403, "Só administradores podem ver a lista de outro usuário.")
        return as_user_id
    return current_user.id
