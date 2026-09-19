/* Punto de entrada: conecta el stream SSE, la mascota, el compositor y los paneles. */
import { api, connectStream } from './api.js';
import { $, $$, el, formatCost } from './dom.js';
import { StreamView } from './stream.js';
import { Panels, PANEL_TITLES } from './panels.js';

const dom = {
  stage: $('#stage'),
  stateLabel: $('#state-label'),
  stateDetail: $('#state-detail'),
  stream: $('#stream'),
  input: $('#input'),
  send: $('#btn-send'),
  interrupt: $('#btn-interrupt'),
  reset: $('#btn-reset'),
  conn: $('#conn-state'),
  chipSession: $('#chip-session'),
  chipCwd: $('#chip-cwd'),
  projectName: $('#project-name'),
  emptyCwd: $('#empty-cwd'),
  emptyHints: $('#empty-hints'),
  mTurns: $('#m-turns'),
  mCost: $('#m-cost'),
  mModel: $('#m-model'),
  mPerm: $('#m-perm'),
  selModel: $('#sel-model'),
  selPerm: $('#sel-perm'),
  sideTitle: $('#side-title'),
  sideBody: $('#side-body'),
  sideRefresh: $('#side-refresh'),
  sideCollapse: $('#side-collapse'),
  sideOpen: $('#side-open'),
  themeToggle: $('#theme-toggle'),
  composerHint: $('#composer-hint'),
  composerCount: $('#composer-count'),
  app: $('#app'),
};

let busy = false;

/* ------------------------------------------------------------------ vista */

const view = new StreamView(dom.stream, {
  onPermission: async (id, allow) => {
    try { await api.permission(id, allow); } catch (err) { notify(err.message); }
  },
});

const panels = new Panels(dom.sideBody, {
  insertPrompt: (text) => {
    dom.input.value = dom.input.value ? `${dom.input.value}\n${text}` : text;
    dom.input.focus();
    autoGrow();
  },
  notify,
});

function notify(text) {
  dom.composerHint.textContent = text;
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => {
    dom.composerHint.textContent = 'Enter envia · Shift+Enter nueva linea · Esc interrumpe';
  }, 3200);
}

/* ------------------------------------------------------------- mascota */

function applyState(event) {
  dom.stage.dataset.state = event.state || 'idle';
  dom.stateLabel.textContent = event.label || '';
  dom.stateDetail.textContent = event.detail || '';
  busy = Boolean(event.busy);
  dom.interrupt.disabled = !busy;
  dom.send.disabled = busy;
  document.title = busy ? `◍ ${event.label} — Clawd Deck` : 'Clawd Deck';
}

/* --------------------------------------------------------------- stream */

connectStream({
  onOpen: () => {
    dom.conn.textContent = 'en vivo';
    dom.conn.className = 'chip is-live';
  },
  onError: () => {
    dom.conn.textContent = 'reconectando…';
    dom.conn.className = 'chip is-down';
  },
  onEvent: (event) => {
    switch (event.type) {
      case 'hello':
        applySnapshot(event.snapshot);
        view.reset();
        break;
      case 'replay_done':
        view.scroll();
        break;
      case 'state':
        applyState(event);
        break;
      case 'session':
        applySessionInfo(event.info);
        break;
      case 'turn_end':
        view.handle(event);
        refreshState();
        break;
      default:
        view.handle(event);
    }
  },
});

function applySnapshot(snapshot) {
  if (!snapshot) return;
  applyState({ state: snapshot.state, label: snapshot.label, detail: snapshot.detail, busy: snapshot.busy });
  dom.mTurns.textContent = snapshot.turns ?? 0;
  dom.mCost.textContent = formatCost(snapshot.totalCostUsd);
  dom.mModel.textContent = snapshot.info?.model || snapshot.model || 'por defecto';
  dom.mPerm.textContent = snapshot.permissionMode || '—';
  dom.chipSession.textContent = snapshot.sessionId ? `sesion ${String(snapshot.sessionId).slice(0, 8)}` : 'sin sesion';
  dom.chipCwd.textContent = snapshot.cwd || '';
  if (snapshot.cwd) {
    dom.projectName.textContent = snapshot.cwd.split('/').filter(Boolean).pop() || snapshot.cwd;
    if (dom.emptyCwd) dom.emptyCwd.textContent = snapshot.cwd;
  }
  if (snapshot.permissionMode) dom.selPerm.value = snapshot.permissionMode;
  if (snapshot.model) dom.selModel.value = snapshot.model;
}

function applySessionInfo(info) {
  if (!info) return;
  dom.chipSession.textContent = info.sessionId ? `sesion ${String(info.sessionId).slice(0, 8)}` : 'sin sesion';
  dom.mModel.textContent = info.model || 'por defecto';
  dom.mPerm.textContent = info.permissionMode || '—';
  if (info.cwd) dom.chipCwd.textContent = info.cwd;
  renderHints(info.slashCommands || []);
}

function renderHints(commands) {
  if (!dom.emptyHints || !commands.length) return;
  dom.emptyHints.replaceChildren(
    ...commands.slice(0, 8).map((name) =>
      el('button', {
        class: 'hint-btn',
        text: `/${String(name).replace(/^\//, '')}`,
        onclick: () => { dom.input.value = `/${String(name).replace(/^\//, '')} `; dom.input.focus(); },
      })),
  );
}

async function refreshState() {
  try {
    const snapshot = await api.state();
    dom.mTurns.textContent = snapshot.turns ?? 0;
    dom.mCost.textContent = formatCost(snapshot.totalCostUsd);
    if (snapshot.sessionId) dom.chipSession.textContent = `sesion ${String(snapshot.sessionId).slice(0, 8)}`;
  } catch { /* el servidor respondera en el proximo intento */ }
}

/* ------------------------------------------------------------ compositor */

function autoGrow() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 220)}px`;
  dom.composerCount.textContent = dom.input.value.length ? `${dom.input.value.length} car.` : '';
}

async function sendMessage() {
  const text = dom.input.value.trim();
  if (!text || busy) return;
  dom.input.value = '';
  autoGrow();
  try {
    await api.send(text);
  } catch (err) {
    notify(err.message);
    dom.input.value = text;
    autoGrow();
  }
}

dom.input.addEventListener('input', autoGrow);
dom.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
dom.send.addEventListener('click', sendMessage);

dom.interrupt.addEventListener('click', async () => {
  try { await api.interrupt(); } catch (err) { notify(err.message); }
});

dom.reset.addEventListener('click', async () => {
  if (!confirm('¿Empezar una conversacion nueva? Se cierra el proceso actual de Claude Code.')) return;
  await api.reset();
  view.reset();
  notify('Sesion reiniciada');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && busy) api.interrupt().catch(() => {});
  if (event.key === '/' && document.activeElement !== dom.input && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    dom.input.focus();
  }
});

/* --------------------------------------------------------------- ajustes */

async function pushSettings(restart) {
  try {
    const { snapshot } = await api.settings({
      model: dom.selModel.value || null,
      permissionMode: dom.selPerm.value,
      restart,
    });
    dom.mModel.textContent = snapshot.model || 'por defecto';
    dom.mPerm.textContent = snapshot.permissionMode;
  } catch (err) {
    notify(err.message);
  }
}
dom.selModel.addEventListener('change', () => pushSettings(true));
dom.selPerm.addEventListener('change', () => pushSettings(true));

/* ---------------------------------------------------------------- panels */

$$('#rail-nav .navbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#rail-nav .navbtn').forEach((b) => b.classList.toggle('is-active', b === btn));
    const name = btn.dataset.panel;
    dom.sideTitle.textContent = PANEL_TITLES[name] || name;
    dom.app.classList.remove('side-hidden');
    dom.sideOpen.hidden = true;
    panels.show(name);
  });
});
dom.sideRefresh.addEventListener('click', () => panels.render());
dom.sideCollapse.addEventListener('click', () => {
  dom.app.classList.add('side-hidden');
  dom.sideOpen.hidden = false;
});
dom.sideOpen.addEventListener('click', () => {
  dom.app.classList.remove('side-hidden');
  dom.sideOpen.hidden = true;
});

/* ----------------------------------------------------------------- tema */

const storedTheme = (() => { try { return localStorage.getItem('clawd-theme'); } catch { return null; } })();
if (storedTheme) document.documentElement.dataset.theme = storedTheme;
dom.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('clawd-theme', next); } catch { /* sin almacenamiento */ }
});

/* ---------------------------------------------------------------- arranque */

const isNarrow = () => window.matchMedia('(max-width: 960px)').matches;

(async () => {
  try {
    const snapshot = await api.state();
    applySnapshot(snapshot);
  } catch (err) {
    notify(err.status === 401 ? 'Token invalido: abre la URL que imprimio la terminal.' : err.message);
  }
  // En pantallas estrechas el panel lateral se superpone al chat, asi que
  // arranca plegado detras del boton flotante.
  if (isNarrow()) {
    dom.app.classList.add('side-hidden');
    dom.sideOpen.hidden = false;
  }
  panels.show('overview');
  autoGrow();
  if (!isNarrow()) dom.input.focus();
})();
