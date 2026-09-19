import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ClaudeSession } from './claude-session.js';
import { DocsVault } from './docs.js';
import {
  getOverview, getMemoryFiles, getSkills, getCommands, getAgents,
  getConfig, getGitInfo, getTree, readProjectFile, writeProjectFile, getSessions,
} from './project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', 'web');

/** Envoltorio explicito para respuestas con codigo de estado propio.
 *  Se usa un simbolo para no confundirlo con un payload que traiga `body`. */
const HTTP_REPLY = Symbol('httpReply');
const reply = (status, body) => ({ [HTTP_REPLY]: true, status, body });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export function createServer(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const token = options.token === false ? null : options.token || randomBytes(12).toString('hex');
  const docs = new DocsVault(options.docsDir || path.join(cwd, 'docs'));
  const session = new ClaudeSession({
    cwd,
    bin: options.bin,
    model: options.model,
    permissionMode: options.permissionMode,
    effort: options.effort,
    extraArgs: options.extraArgs,
  });

  const clients = new Set();
  session.on('event', (event) => broadcast(clients, event));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;

    try {
      if (route.startsWith('/api/')) {
        if (!checkAuth(req, url, token)) return sendJson(res, 401, { error: 'Token invalido' });
        if (route === '/api/events') return handleSse(req, res, clients, session);
        const body = await readBody(req);
        const result = await handleApi({ route, method: req.method, url, body, session, docs, cwd, options });
        if (result === undefined) return sendJson(res, 404, { error: 'Ruta desconocida' });
        if (result && result[HTTP_REPLY]) return sendJson(res, result.status, result.body);
        return sendJson(res, 200, result);
      }
      return serveStatic(route, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[clawd-deck]', err);
      return sendJson(res, status, { error: err.message || 'Error interno' });
    }
  });

  server.on('close', () => session.stop());
  return { server, session, docs, token, cwd };
}

/* -------------------------------------------------------------------- */
/* API                                                                   */
/* -------------------------------------------------------------------- */

async function handleApi({ route, method, url, body, session, docs, cwd, options }) {
  const q = (key) => url.searchParams.get(key);

  switch (`${method} ${route}`) {
    case 'GET /api/state':
      return { ...session.snapshot(), docsRoot: docs.root, projectName: path.basename(cwd) };

    case 'POST /api/message': {
      const text = String(body?.text || '');
      if (!text.trim()) return reply(400, { error: 'Mensaje vacio' });
      if (session.busy) return reply(409, { error: 'Clawd sigue trabajando en el turno anterior' });
      session.send(text);
      return { ok: true, state: session.state };
    }

    case 'POST /api/interrupt':
      return { ok: session.interrupt() };

    case 'POST /api/reset':
      await session.reset();
      return { ok: true };

    case 'POST /api/start':
      session.start();
      return { ok: true, alive: session.isAlive() };

    case 'POST /api/stop':
      session.stop();
      return { ok: true };

    case 'POST /api/settings': {
      if (body?.model !== undefined) session.model = body.model || null;
      if (body?.permissionMode) session.permissionMode = body.permissionMode;
      if (body?.effort !== undefined) session.effort = body.effort || null;
      const needsRestart = Boolean(body?.restart) && session.isAlive();
      if (needsRestart) session.stop();
      session.push({ type: 'notice', level: 'info', text: `Ajustes: modelo=${session.model || 'por defecto'}, permisos=${session.permissionMode}, esfuerzo=${session.effort || 'por defecto'}${needsRestart ? ' (se reinicia el proceso)' : ' (se aplica al proximo arranque)'}` });
      return { ok: true, snapshot: session.snapshot() };
    }

    case 'POST /api/permission': {
      const ok = session.answerPermission(String(body?.id || ''), Boolean(body?.allow), body?.note);
      return { ok };
    }

    case 'GET /api/overview':
      return getOverview(cwd);

    case 'GET /api/memory':
      return { items: await getMemoryFiles(cwd) };

    case 'GET /api/skills':
      return { items: (await getSkills(cwd)).map(({ content, ...rest }) => rest) };

    case 'GET /api/skill': {
      const target = q('path');
      const items = await getSkills(cwd);
      const found = items.find((s) => s.path === target || s.name === target);
      if (!found) return reply(404, { error: 'Skill no encontrada' });
      return found;
    }

    case 'GET /api/commands':
      return { items: await getCommands(cwd) };

    case 'GET /api/agents':
      return { items: await getAgents(cwd) };

    case 'GET /api/config-files':
      return getConfig(cwd);

    case 'GET /api/git':
      return getGitInfo(cwd);

    case 'GET /api/sessions':
      return { items: await getSessions(cwd) };

    case 'GET /api/tree':
      return getTree(cwd, q('path') || '.');

    case 'GET /api/file':
      return readProjectFile(cwd, q('path') || '');

    case 'PUT /api/file': {
      if (options.readOnly) return reply(403, { error: 'Modo solo lectura' });
      return writeProjectFile(cwd, String(body?.path || ''), String(body?.content ?? ''));
    }

    case 'GET /api/docs':
      return { items: await docs.list(), root: docs.root };

    case 'GET /api/docs/search':
      return { items: await docs.search(q('q')) };

    case 'GET /api/docs/item':
      return docs.read(q('slug') || '');

    case 'POST /api/docs':
      return docs.create(body || {});

    case 'PUT /api/docs':
      return docs.save(String(body?.slug || ''), body || {});

    case 'DELETE /api/docs':
      return docs.remove(q('slug') || '');

    case 'GET /api/health':
      return { ok: true, uptime: process.uptime(), pid: process.pid };

    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------- */
/* SSE                                                                   */
/* -------------------------------------------------------------------- */

function handleSse(req, res, clients, session) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': conectado a clawd-deck\n\n');

  const client = { res };
  clients.add(client);

  writeEvent(res, { type: 'hello', snapshot: session.snapshot() });
  for (const event of session.history) writeEvent(res, { ...event, replay: true });
  writeEvent(res, { type: 'replay_done' });

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
    }
  }, 20000);
  ping.unref?.();

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

function writeEvent(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch { /* cliente desconectado */ }
}

function broadcast(clients, event) {
  for (const client of clients) writeEvent(client.res, event);
}

/* -------------------------------------------------------------------- */
/* Utilidades HTTP                                                       */
/* -------------------------------------------------------------------- */

function checkAuth(req, url, token) {
  if (!token) return true;
  const header = req.headers['x-clawd-token'];
  if (header === token) return true;
  if (url.searchParams.get('token') === token) return true;
  return false;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      const err = new Error('Cuerpo demasiado grande');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('JSON invalido');
    err.status = 400;
    throw err;
  }
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function serveStatic(route, res) {
  const relative = route === '/' ? 'index.html' : route.replace(/^\/+/, '');
  const target = path.resolve(WEB_ROOT, relative);
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}
