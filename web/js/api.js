/* Cliente HTTP del panel. El token viaja por cabecera (y por query en el SSE). */

const params = new URLSearchParams(location.search);
const urlToken = params.get('token');
if (urlToken) {
  try { localStorage.setItem('clawd-token', urlToken); } catch { /* modo privado */ }
  history.replaceState(null, '', location.pathname);
}

export function getToken() {
  if (urlToken) return urlToken;
  try { return localStorage.getItem('clawd-token') || ''; } catch { return ''; }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers['x-clawd-token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const error = new Error((data && data.error) || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),
  send: (text) => request('POST', '/api/message', { text }),
  interrupt: () => request('POST', '/api/interrupt'),
  reset: () => request('POST', '/api/reset'),
  startProcess: () => request('POST', '/api/start'),
  stopProcess: () => request('POST', '/api/stop'),
  settings: (payload) => request('POST', '/api/settings', payload),
  permission: (id, allow, remember) => request('POST', '/api/permission', { id, allow, remember }),

  overview: () => request('GET', '/api/overview'),
  memory: () => request('GET', '/api/memory'),
  skills: () => request('GET', '/api/skills'),
  skill: (p) => request('GET', `/api/skill?path=${encodeURIComponent(p)}`),
  commands: () => request('GET', '/api/commands'),
  agents: () => request('GET', '/api/agents'),
  configFiles: () => request('GET', '/api/config-files'),
  git: () => request('GET', '/api/git'),
  sessions: () => request('GET', '/api/sessions'),
  tree: (p) => request('GET', `/api/tree?path=${encodeURIComponent(p || '.')}`),
  browse: (p) => request('GET', `/api/browse${p ? `?path=${encodeURIComponent(p)}` : ''}`),
  setProject: (p) => request('POST', '/api/project', { path: p }),
  file: (p) => request('GET', `/api/file?path=${encodeURIComponent(p)}`),
  writeFile: (p, content) => request('PUT', '/api/file', { path: p, content }),

  docs: () => request('GET', '/api/docs'),
  docsSearch: (q) => request('GET', `/api/docs/search?q=${encodeURIComponent(q)}`),
  doc: (slug) => request('GET', `/api/docs/item?slug=${encodeURIComponent(slug)}`),
  docCreate: (payload) => request('POST', '/api/docs', payload),
  docSave: (payload) => request('PUT', '/api/docs', payload),
  docDelete: (slug) => request('DELETE', `/api/docs?slug=${encodeURIComponent(slug)}`),
};

/** Suscripcion SSE con reconexion progresiva. */
export function connectStream({ onEvent, onOpen, onError }) {
  let source = null;
  let retry = 1000;

  const open = () => {
    const token = getToken();
    source = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    source.onopen = () => { retry = 1000; onOpen?.(); };
    source.onmessage = (event) => {
      try { onEvent(JSON.parse(event.data)); } catch { /* evento ilegible */ }
    };
    source.onerror = () => {
      onError?.();
      source.close();
      setTimeout(open, retry);
      retry = Math.min(retry * 1.6, 15000);
    };
  };

  open();
  return () => source?.close();
}
