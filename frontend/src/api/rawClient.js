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
  setDefaultOperation: (value, { force = false } = {}) =>
    request('/api/me/default-operation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, force }),
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
  cancelTrial: () => request('/api/me/cancel-trial', { method: 'POST' }),
  updateMyName: (name) =>
    request('/api/me/name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  listAffiliates: () => request('/api/admin/affiliates'),
  createAffiliate: (data) =>
    request('/api/admin/affiliates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteAffiliate: (id) => request(`/api/admin/affiliates/${id}`, { method: 'DELETE' }),
  backfillAffiliate: (id) => request(`/api/admin/affiliates/${id}/backfill`, { method: 'POST' }),
  listAffiliateCommissions: () => request('/api/admin/affiliate-commissions'),
  listAffiliateTrialReferrals: () => request('/api/admin/affiliate-trial-referrals'),
  markAffiliateCommissionPaid: (id, paid) =>
    request(`/api/admin/affiliate-commissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid }),
    }),

  getMyReferral: () => request('/api/referral/me'),
  requestReferralCoupon: (pixKey, whatsapp) =>
    request('/api/referral/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pixKey, whatsapp }),
    }),
  updateReferralPix: (pixKey) =>
    request('/api/referral/pix', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pixKey }) }),
  updateReferralWhatsapp: (whatsapp) =>
    request('/api/referral/whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsapp }) }),

  listReferrals: () => request('/api/admin/referrals'),
  activateReferral: (id, couponCode) =>
    request(`/api/admin/referrals/${id}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ couponCode }),
    }),
  listReferralCommissions: () => request('/api/admin/referral-commissions'),
  markReferralCommissionPaid: (id, paid) =>
    request(`/api/admin/referral-commissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid }),
    }),

  getCommunityStatus: () => request('/api/community/status'),
  setupCommunity: (name, photoUrl) =>
    request('/api/community/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, photoUrl }) }),
  listCommunityDirectory: () => request('/api/community/directory'),
  joinCommunity: (communityId) =>
    request('/api/community/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ communityId }) }),
  getCommunity: (id, { channelId, sort } = {}) => request(`/api/community/${id}?${qs({ channelId, sort })}`),
  updateCommunity: (id, { name, description, photoUrl, bannerUrl, accentColor, instagramUrl, youtubeUrl, websiteUrl }) =>
    request(`/api/community/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, photoUrl, bannerUrl, accentColor, instagramUrl, youtubeUrl, websiteUrl }),
    }),
  createCommunityChannel: (id, name, groupName) =>
    request(`/api/community/${id}/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, groupName }) }),
  renameCommunityChannel: (channelId, name) =>
    request(`/api/community/channels/${channelId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteCommunityChannel: (channelId) => request(`/api/community/channels/${channelId}`, { method: 'DELETE' }),
  createCommunityPost: (id, channelId, body, imageUrl, { scheduledAt, pollOptions } = {}) =>
    request(`/api/community/${id}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, body, imageUrl, scheduledAt, pollOptions }),
    }),
  updateCommunityPost: (postId, body, imageUrl, scheduledAt) =>
    request(`/api/community/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, imageUrl, scheduledAt }) }),
  deleteCommunityPost: (postId) => request(`/api/community/posts/${postId}`, { method: 'DELETE' }),
  toggleCommunityPostPin: (postId) => request(`/api/community/posts/${postId}/pin`, { method: 'POST' }),
  getScheduledCommunityPosts: (id) => request(`/api/community/${id}/scheduled`),
  publishCommunityPostNow: (postId) => request(`/api/community/posts/${postId}/publish-now`, { method: 'POST' }),
  voteOnCommunityPoll: (postId, optionId) =>
    request(`/api/community/posts/${postId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) }),
  createCommunityComment: (postId, body) =>
    request(`/api/community/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }),
  updateCommunityComment: (commentId, body) =>
    request(`/api/community/comments/${commentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }),
  deleteCommunityComment: (commentId) => request(`/api/community/comments/${commentId}`, { method: 'DELETE' }),
  toggleCommunityPostLike: (postId) => request(`/api/community/posts/${postId}/like`, { method: 'POST' }),
  toggleCommunityPostSave: (postId) => request(`/api/community/posts/${postId}/save`, { method: 'POST' }),
  getCommunityActivity: (id) => request(`/api/community/${id}/activity`),
  getCommunityMembers: (id) => request(`/api/community/${id}/members`),
  muteCommunityMember: (communityId, organizationId, muted) =>
    request(`/api/community/${communityId}/members/${organizationId}/mute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted }),
    }),
  removeCommunityMember: (communityId, organizationId) =>
    request(`/api/community/${communityId}/members/${organizationId}`, { method: 'DELETE' }),
  getCommunityAffiliateEarnings: (id) => request(`/api/community/${id}/affiliate-earnings`),
  getCommunityAnalytics: (id) => request(`/api/community/${id}/analytics`),
  getCommunityHome: (id) => request(`/api/community/${id}/home`),
  setResourceProgress: (resourceId, completed) =>
    request(`/api/community/resources/${resourceId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    }),
  getCommunityNotifications: (id) => request(`/api/community/${id}/notifications`),
  markNotificationRead: (notificationId) => request(`/api/community/notifications/${notificationId}/read`, { method: 'POST' }),
  markAllNotificationsRead: (id) => request(`/api/community/${id}/notifications/read-all`, { method: 'POST' }),
  listCommunityResources: (id) => request(`/api/community/${id}/resources`),
  createCommunityResource: (id, data) =>
    request(`/api/community/${id}/resources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateCommunityResource: (resourceId, data) =>
    request(`/api/community/resources/${resourceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteCommunityResource: (resourceId) => request(`/api/community/resources/${resourceId}`, { method: 'DELETE' }),

  listAdminCommunities: () => request('/api/admin/communities'),
  createCommunityForAffiliate: (affiliateId, name, photoUrl) =>
    request('/api/admin/communities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ affiliateId, name, photoUrl }) }),
  listCommunityCommissions: () => request('/api/admin/community-commissions'),
  markCommunityCommissionPaid: (id, paid) =>
    request(`/api/admin/community-commissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid }),
    }),

  listSuggestedCompetitors: (operation) => request(`/api/suggested-competitors?${qs({ operation })}`),
  listAdminSuggestedCompetitors: () => request('/api/admin/suggested-competitors'),
  addSuggestedCompetitors: (operation, text) =>
    request('/api/admin/suggested-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, text }),
    }),
  deleteSuggestedCompetitor: (id) => request(`/api/admin/suggested-competitors/${id}`, { method: 'DELETE' }),
  clearSuggestedCompetitors: (operation) =>
    request(`/api/admin/suggested-competitors?${qs({ operation })}`, { method: 'DELETE' }),

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
  listAssinarLeads: () => request('/api/admin/assinar-leads'),
  setOrganizationAffiliate: (id, affiliateId) =>
    request(`/api/admin/organizations/${id}/affiliate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ affiliateId }),
    }),
  createOrganization: (data) => request('/api/admin/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateOrganization: (id, data) => request(`/api/admin/organizations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteOrganization: (id) => request(`/api/admin/organizations/${id}`, { method: 'DELETE' }),
}
