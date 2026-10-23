import {httpError} from './http.util.mjs';

/**
 * Minimal router over `API_ROUTES` templates. A known path with the wrong method answers 405.
 * @returns {{get: Function, post: Function, put: Function, delete: Function, handle: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, url: URL) => Promise<boolean>}}
 */
export function createRouter() {
  const routes = [];

  function add(method, template, handler, constraints = {}) {
    routes.push({method, match: compile(template, constraints), handler});
  }

  async function handle(request, response, url) {
    let pathMatched = false;
    for (const route of routes) {
      const params = route.match(url.pathname);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      await route.handler({request, response, url, params});
      return true;
    }
    if (pathMatched) throw httpError(405, 'method not allowed');
    return false;
  }

  return {
    get: (template, handler, constraints) =>
      add('GET', template, handler, constraints),
    post: (template, handler, constraints) =>
      add('POST', template, handler, constraints),
    put: (template, handler, constraints) =>
      add('PUT', template, handler, constraints),
    delete: (template, handler, constraints) =>
      add('DELETE', template, handler, constraints),
    handle,
  };
}

function compile(template, constraints) {
  const names = [];
  const source = template
    .split('/')
    .map(segment => {
      if (!segment.startsWith(':')) return escapeRegExp(segment);
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  const pattern = new RegExp(`^${source}$`);
  return pathname => {
    const match = pattern.exec(pathname);
    if (!match) return null;
    const params = {};
    for (const [index, name] of names.entries()) {
      try {
        params[name] = decodeURIComponent(match[index + 1]);
      } catch {
        return null;
      }
      if (constraints[name] && !constraints[name].test(params[name]))
        return null;
    }
    return params;
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
