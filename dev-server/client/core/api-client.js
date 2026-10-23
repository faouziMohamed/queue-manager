/**
 * Calls a dev server endpoint and returns its JSON. Non-2xx answers throw an Error carrying `status`.
 * @param {string} path An `ENDPOINTS` value.
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const {headers, ...rest} = options;
  const response = await fetch(path, {
    ...rest,
    headers: {'Content-Type': 'application/json', ...(headers || {})},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || response.statusText);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/**
 * POSTs a JSON payload to a dev server endpoint.
 * @param {string} path An `ENDPOINTS` value.
 * @param {unknown} payload
 * @returns {Promise<any>}
 */
export function postJson(path, payload) {
  return api(path, {method: 'POST', body: JSON.stringify(payload)});
}
