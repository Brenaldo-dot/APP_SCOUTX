// Cliente separado do client.js: aquele prefixa toda chamada com API_URL
// (`/api/minerador` em produção, indo pro FastAPI). As rotas herdadas do
// app Node (login, /api/me, /api/buscar, /api/spy, /api/admin/*,
// /api/history*) são Express puro, no MESMO domínio, sem esse prefixo — daí
// precisar de um client à parte. Caminho relativo funciona tanto hoje (App
// servido em /minerador) quanto depois da fusão (App servido na raiz), já
// que é sempre resolvido a partir da raiz do domínio, não da rota atual.
async function request(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // resposta sem JSON — mantém a mensagem padrão
    }
    throw new Error(message)
  }
  if (res.status === 204) return null
  return res.json()
}

function qs(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return new URLSearchParams(clean).toString()
}

export const rawApi = {
  me: () => request('/api/me'),
  setDefaultOperation: (value) =>
    request('/api/me/default-operation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
  changeMyPassword: (currentPassword, newPassword) =>
    request('/api/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  updateMyAvatar: (avatarDataUrl) =>
    request('/api/me/avatar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarDataUrl }),
    }),
  removeMyAvatar: () => request('/api/me/avatar', { method: 'DELETE' }),

  buscarBarcode: (url) => request(`/api/buscar?${qs({ url })}`),
  espionarLoja: (url) => request(`/api/spy?${qs({ url })}`),
  spyPreviewUrl: (url) => `/api/spy-preview?${qs({ url })}`,

  listHistoryUsers: () => request('/api/history'),
  getHistoryDetail: (userId) => request(`/api/history/${userId}`),

  listUsers: () => request('/api/admin/users'),
  getUserIps: (id) => request(`/api/admin/users/${id}/ips`),
  listAuditLog: () => request('/api/admin/audit-log'),
  createUser: (data) => request('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),

  listOrganizations: () => request('/api/admin/organizations'),
  createOrganization: (data) => request('/api/admin/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateOrganization: (id, data) => request(`/api/admin/organizations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
}
