export async function api(path, options = {}) {
  const {headers, ...rest} = options
  const response = await fetch(path, {
    ...rest,
    headers: {'Content-Type': 'application/json', ...(headers || {})},
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || response.statusText)
    error.status = response.status
    throw error
  }
  return payload
}

export function toTask(dto) {
  return {
    id: String(dto.id || ''),
    title: String(dto.title || ''),
    status: String(dto.status || ''),
    priority: String(dto.priority || '2'),
    updated: String(dto.updated || ''),
    shipped: String(dto.shipped || ''),
    resume: String(dto.resume || ''),
    body: String(dto.body || ''),
    blockedBy: Array.isArray(dto.blockedBy) ? dto.blockedBy.map(String) : [],
    awaitingProduction: Boolean(dto.awaitingProduction),
    prodGate: Boolean(dto.prodGate),
    repo: String(dto.repo || ''),
    file: String(dto.file || ''),
    dod: dto.dod && dto.dod.present
      ? {present: true, total: Number(dto.dod.total) || 0, done: Number(dto.dod.done) || 0, items: Array.isArray(dto.dod.items) ? dto.dod.items : []}
      : {present: false, total: 0, done: 0, items: []},
  }
}
