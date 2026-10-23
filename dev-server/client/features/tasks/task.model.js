/** @typedef {import('../../../shared/types.mjs').Task} Task */
/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */

/**
 * Normalizes a task from the API into the browser's Task shape.
 * @param {Partial<TaskRecord> & Record<string, unknown>} dto
 * @returns {Task}
 */
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
    dod:
      dto.dod && dto.dod.present
        ? {
            present: true,
            total: Number(dto.dod.total) || 0,
            done: Number(dto.dod.done) || 0,
            items: Array.isArray(dto.dod.items) ? dto.dod.items : [],
          }
        : {present: false, total: 0, done: 0, items: []},
  };
}
