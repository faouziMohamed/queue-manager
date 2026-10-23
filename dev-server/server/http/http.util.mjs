/**
 * Error carrying the HTTP status the server answers with.
 * @param {number} statusCode
 * @param {string} message
 * @returns {Error & {statusCode: number}}
 */
export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Reads a JSON request body, refusing bodies over the limit.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} [limit] Bytes.
 * @returns {Promise<any>}
 */
export async function readJson(request, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'invalid JSON body');
  }
}

/**
 * Sends a JSON response that browsers never cache.
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 */
export function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

/**
 * Whether the request comes from this machine.
 * @param {import('node:http').IncomingMessage} request
 * @returns {boolean}
 */
export function isLoopback(request) {
  const address = request.socket.remoteAddress;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}
