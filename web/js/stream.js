/* Pinta la conversacion: mensajes, bloques de pensamiento, tarjetas de
   herramienta, resumenes de turno y la bandeja de permisos. */
import { el, clear, formatDuration, formatCost } from './dom.js';
import { renderMarkdown } from './markdown.js';

const TOOL_TITLES = {
  reading: 'leyendo', writing: 'escribiendo', searching: 'buscando',
  running: 'ejecutando', web: 'navegando', delegating: 'delegando', thinking: 'pensando',
};

export class StreamView {
  constructor(root, { onPermission }) {
    this.root = root;
    this.onPermission = onPermission;
    this.blocks = new Map();
    this.tools = new Map();
    this.permissions = new Map();
    this.autoScroll = true;

    root.addEventListener('scroll', () => {
      const nearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 90;
      this.autoScroll = nearBottom;
    });
  }

  reset() {
    clear(this.root);
    this.blocks.clear();
    this.tools.clear();
  }

  hideEmpty() {
    const empty = this.root.querySelector('#empty-state');
    if (empty) empty.remove();
  }

  handle(event) {
    switch (event.type) {
      case 'user': return this.addUser(event.text);
      case 'block': return this.setBlock(event);
      case 'delta': return this.appendDelta(event);
      case 'tool': return this.addTool(event);
      case 'tool_result': return this.finishTool(event);
      case 'turn_end': return this.addTurn(event.result);
      case 'notice': return this.addNotice(event);
      case 'log': return this.addLog(event.text);
      case 'permission': return this.addPermission(event);
      case 'permission_resolved': return this.resolvePermission(event.id, event.allow);
      case 'reset': return this.reset();
      default: return undefined;
    }
  }

  /* ----------------------------------------------------------- mensajes */

  addUser(text) {
    this.hideEmpty();
    const node = el('div', { class: 'msg msg--user' }, [
      el('span', { class: 'msg__who', text: 'tu' }),
      el('div', { class: 'msg__body', html: renderMarkdown(text) }),
    ]);
    this.append(node);
  }

  ensureBlock(id, kind) {
    if (this.blocks.has(id)) return this.blocks.get(id);
    this.hideEmpty();
    const body = el('div', { class: 'msg__body md' });
    const node = el('div', { class: `msg msg--assistant${kind === 'thinking' ? ' msg--thinking' : ''}` }, [
      el('span', { class: 'msg__who', text: kind === 'thinking' ? 'clawd piensa' : 'clawd' }),
      body,
    ]);
    const entry = { node, body, text: '', kind };
    this.blocks.set(id, entry);
    this.append(node);
    return entry;
  }

  appendDelta({ id, kind, text }) {
    const entry = this.ensureBlock(id, kind);
    entry.text += text;
    entry.body.innerHTML = renderMarkdown(entry.text);
    entry.body.classList.add('cursor');
    this.scroll();
  }

  setBlock({ id, kind, text }) {
    if (!text || !String(text).trim()) {
      const existing = this.blocks.get(id);
      if (existing && !existing.text.trim()) existing.node.remove();
      return;
    }
    const entry = this.ensureBlock(id, kind);
    entry.text = text;
    entry.body.innerHTML = renderMarkdown(text);
    entry.body.classList.remove('cursor');
    this.scroll();
  }

  /* -------------------------------------------------------- herramientas */

  addTool(event) {
    this.hideEmpty();
    const status = el('span', { class: 'tool__status is-running', text: 'en curso' });
    const inputPre = el('pre', { class: 'mono', text: safeJson(event.input) });
    const body = el('div', { class: 'tool__body' }, [
      el('div', { class: 'tool__label', text: 'entrada' }),
      inputPre,
    ]);
    const head = el('div', { class: 'tool__head' }, [
      el('span', { class: 'tool__icon', text: event.icon || '•' }),
      el('span', { class: 'tool__name', text: event.name }),
      el('span', { class: 'tool__detail', text: event.detail || TOOL_TITLES[event.state] || '' }),
      status,
    ]);
    const node = el('div', { class: `tool tool--${event.state}` }, [head, body]);
    head.addEventListener('click', () => node.classList.toggle('is-open'));
    this.tools.set(event.id, { node, status, body });
    this.append(node);
  }

  finishTool(event) {
    const entry = this.tools.get(event.id);
    if (!entry) return;
    const ok = event.status === 'ok';
    entry.status.className = `tool__status ${ok ? 'is-ok' : 'is-error'}`;
    entry.status.textContent = ok
      ? (event.durationMs ? formatDuration(event.durationMs) : 'ok')
      : 'error';
    if (event.preview) {
      entry.body.append(
        el('div', { class: 'tool__label', text: 'resultado' }),
        el('pre', { class: 'mono', text: event.preview }),
      );
      if (!ok) entry.node.classList.add('is-open');
    }
    this.scroll();
  }

  /* ------------------------------------------------------------- avisos */

  addTurn(result) {
    if (!result) return;
    const parts = [
      result.isError ? '✕ turno con error' : '✓ turno completado',
      result.durationMs ? `⏱ ${formatDuration(result.durationMs)}` : null,
      result.numTurns ? `↻ ${result.numTurns} pasos` : null,
      result.costUsd ? `◈ ${formatCost(result.costUsd)}` : null,
      result.usage?.output_tokens ? `⇡ ${result.usage.output_tokens} tok` : null,
    ].filter(Boolean);
    this.append(el('div', { class: `turn${result.isError ? ' is-error' : ''}`, text: parts.join('   ') }));
  }

  addNotice({ text, level }) {
    this.append(el('div', { class: `msg msg--notice level-${level || 'info'}` }, [
      el('div', { class: 'msg__body', text }),
    ]));
  }

  addLog(text) {
    this.append(el('div', { class: 'msg msg--log' }, [el('div', { class: 'msg__body', text })]));
  }

  /* ---------------------------------------------------------- permisos */

  addPermission(event) {
    const tray = document.getElementById('permission-tray');
    tray.hidden = false;
    const node = el('div', { class: 'perm' }, [
      el('div', { class: 'perm__text' }, [
        el('strong', { text: `${event.tool} pide permiso` }),
        event.detail ? el('div', {}, [el('code', { text: event.detail })]) : null,
      ]),
      el('button', {
        class: 'primary-btn',
        text: 'permitir',
        onclick: () => this.onPermission(event.id, true),
      }),
      el('button', {
        class: 'ghost-btn',
        text: 'denegar',
        onclick: () => this.onPermission(event.id, false),
      }),
    ]);
    this.permissions.set(event.id, node);
    tray.append(node);
  }

  resolvePermission(id, allow) {
    const node = this.permissions.get(id);
    if (node) {
      node.remove();
      this.permissions.delete(id);
    }
    const tray = document.getElementById('permission-tray');
    if (!tray.children.length) tray.hidden = true;
    this.addNotice({ text: allow ? 'Permiso concedido.' : 'Permiso denegado.', level: allow ? 'info' : 'warn' });
  }

  /* ----------------------------------------------------------- utilidad */

  append(node) {
    this.root.append(node);
    this.scroll();
  }

  scroll() {
    if (!this.autoScroll) return;
    this.root.scrollTop = this.root.scrollHeight;
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
