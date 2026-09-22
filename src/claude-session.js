import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { stateForTool, iconForState, describeToolInput, STATE_COPY } from './activity.js';

const MAX_HISTORY = 800;

/** Subtipos de `system` que el CLI repite como latido y no interesan en el hilo. */
const NOISY_SYSTEM_SUBTYPES = new Set(['status', 'thinking_tokens']);

/**
 * Envuelve el CLI de Claude Code en modo streaming JSON y traduce su salida
 * a un protocolo simple que el frontend consume por SSE.
 *
 *   claude -p --input-format stream-json --output-format stream-json --verbose
 *
 * El proceso se mantiene vivo entre turnos. Si muere, el siguiente mensaje lo
 * relanza con --resume <session_id> para no perder la conversacion.
 */
export class ClaudeSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.bin = options.bin || process.env.CLAWD_DECK_CLAUDE_BIN || 'claude';
    this.model = options.model || null;
    this.permissionMode = options.permissionMode || 'acceptEdits';
    this.effort = options.effort || null;
    this.addDirs = options.addDirs || [];
    this.extraArgs = options.extraArgs || [];
    this.autoDenyMs = Number(options.autoDenyMs || 120000);
    // Catalogo de comandos que el CLI devuelve al handshake `initialize`:
    // trae los suyos, los de plugins y las skills, con descripcion y pistas
    // de argumentos. `system:init` solo da los nombres.
    this.commands = [];
    this.initRequestId = null;

    this.child = null;
    this.sessionId = null;
    this.info = null;
    this.stdoutBuffer = '';
    this.pendingInput = [];
    this.pendingPermissions = new Map();
    this.activeTools = new Map();
    this.streamMessageIds = new Map();
    this.messageBlockOffsets = new Map();
    this.history = [];
    this.state = 'idle';
    this.stateLabel = STATE_COPY.idle.title;
    this.stateDetail = STATE_COPY.idle.hint;
    this.busy = false;
    this.lastResult = null;
    this.totalCostUsd = 0;
    this.turns = 0;
    this.startedAt = null;
  }

  /* ------------------------------------------------------------------ */
  /* Ciclo de vida del proceso                                           */
  /* ------------------------------------------------------------------ */

  isAlive() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  buildArgs() {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Sin esto el CLI no tiene anfitrion a quien preguntar: cualquier
      // herramienta que necesite aprobacion se deniega sola con
      // "This command requires approval" y nunca llega un `can_use_tool`,
      // asi que la bandeja de permisos del panel jamas se abre.
      '--permission-prompt-tool', 'stdio',
    ];
    if (this.sessionId) args.push('--resume', this.sessionId);
    if (this.model) args.push('--model', this.model);
    if (this.permissionMode) args.push('--permission-mode', this.permissionMode);
    if (this.effort) args.push('--effort', this.effort);
    // El CLI confina las herramientas al cwd; cada carpeta extra hay que
    // declararla o responde "may only list files in the allowed working
    // directories for this session".
    for (const dir of this.addDirs) args.push('--add-dir', dir);
    args.push(...this.extraArgs);
    return args;
  }

  start() {
    if (this.isAlive()) return;
    const args = this.buildArgs();
    this.setState('booting');
    this.push({ type: 'notice', level: 'info', text: `$ ${this.bin} ${args.join(' ')}` });

    let child;
    try {
      child = spawn(this.bin, args, {
        cwd: this.cwd,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'clawd-deck' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.fail(`No se pudo lanzar "${this.bin}": ${err.message}`);
      return;
    }

    this.child = child;
    this.startedAt = Date.now();
    this.stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) this.push({ type: 'log', text: line.trim() });
      }
    });
    child.on('error', (err) => this.fail(`Error del proceso: ${err.message}`));
    child.on('exit', (code, signal) => this.onExit(code, signal));

    // El handshake va primero: su respuesta trae el catalogo de comandos.
    this.initRequestId = `init_${randomUUID()}`;
    this.writeLine({ type: 'control_request', request_id: this.initRequestId, request: { subtype: 'initialize' } });

    // Vacia lo que se haya encolado mientras arrancaba.
    const queued = this.pendingInput.splice(0, this.pendingInput.length);
    for (const payload of queued) this.writeLine(payload);
  }

  onExit(code, signal) {
    const wasBusy = this.busy;
    this.child = null;
    for (const [id] of this.activeTools) {
      this.push({ type: 'tool_result', id, status: 'error', preview: 'El proceso termino antes de responder' });
    }
    this.activeTools.clear();
    this.streamMessageIds.clear();
    this.messageBlockOffsets.clear();
    for (const [, pending] of this.pendingPermissions) clearTimeout(pending.timer);
    this.pendingPermissions.clear();
    this.busy = false;
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      this.setState(wasBusy ? 'stopped' : 'idle');
      this.push({ type: 'notice', level: 'info', text: `Proceso de Claude Code finalizado (${signal || 'code ' + code}).` });
    } else {
      this.setState('error');
      this.push({ type: 'notice', level: 'error', text: `Claude Code termino con codigo ${code}${signal ? ' / ' + signal : ''}.` });
    }
    this.emit('exit', { code, signal });
  }

  fail(message) {
    this.push({ type: 'notice', level: 'error', text: message });
    this.setState('error');
    this.busy = false;
  }

  stop() {
    if (!this.isAlive()) return;
    try {
      this.child.stdin.end();
    } catch { /* ignore */ }
    this.child.kill('SIGTERM');
  }

  /** Interrumpe el turno actual (equivalente a Esc en la terminal). */
  interrupt() {
    if (!this.isAlive()) return false;
    const requestId = `int_${randomUUID()}`;
    this.writeLine({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } });
    this.push({ type: 'notice', level: 'warn', text: 'Interrupcion enviada.' });
    // Red de seguridad: si en 4s sigue ocupado, se corta el proceso.
    setTimeout(() => {
      if (this.busy && this.isAlive()) {
        this.push({ type: 'notice', level: 'warn', text: 'El turno no respondio a la interrupcion; cerrando el proceso.' });
        this.child.kill('SIGINT');
      }
    }, 4000).unref?.();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Entrada                                                             */
  /* ------------------------------------------------------------------ */

  writeLine(payload) {
    if (!this.isAlive()) {
      this.pendingInput.push(payload);
      return;
    }
    try {
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      this.fail(`No se pudo escribir al proceso: ${err.message}`);
    }
  }

  send(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    this.push({ type: 'user', text: clean, at: Date.now() });
    this.busy = true;
    this.setState('thinking');
    if (!this.isAlive()) this.start();
    this.writeLine({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: clean }] },
    });
    return true;
  }

  answerPermission(id, allow, note, remember) {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(id);
    const response = allow
      ? { behavior: 'allow', updatedInput: pending.input || {} }
      : { behavior: 'deny', message: note || 'Denegado desde Clawd Deck' };
    // "Permitir siempre": se devuelven las reglas que el propio CLI propuso,
    // que es como quedan guardadas en los settings del proyecto.
    if (allow && remember && pending.suggestions?.length) {
      response.updatedPermissions = pending.suggestions;
    }
    this.writeLine({
      type: 'control_response',
      response: { subtype: 'success', request_id: pending.requestId, response },
    });
    this.push({ type: 'permission_resolved', id, allow: Boolean(allow), remembered: Boolean(allow && remember) });
    if (this.pendingPermissions.size === 0 && this.busy) this.setState('thinking');
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Salida                                                              */
  /* ------------------------------------------------------------------ */

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let index;
    while ((index = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.push({ type: 'log', text: line.slice(0, 500) });
        continue;
      }
      try {
        this.handleEvent(event);
      } catch (err) {
        this.push({ type: 'notice', level: 'error', text: `Evento no procesado: ${err.message}` });
      }
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case 'system':
        return this.handleSystem(event);
      case 'assistant':
        return this.handleAssistant(event);
      case 'user':
        return this.handleUserEvent(event);
      case 'stream_event':
        return this.handleStreamEvent(event);
      case 'result':
        return this.handleResult(event);
      case 'control_request':
        return this.handleControlRequest(event);
      case 'control_response':
        return this.handleControlResponse(event);
      case 'control_cancel_request':
        return;
      default:
        this.push({ type: 'raw', text: JSON.stringify(event).slice(0, 400) });
    }
  }

  handleSystem(event) {
    if (event.session_id) this.sessionId = event.session_id;
    if (event.subtype === 'init') {
      this.info = {
        sessionId: event.session_id || null,
        model: event.model || this.model,
        cwd: event.cwd || this.cwd,
        tools: event.tools || [],
        slashCommands: event.slash_commands || [],
        mcpServers: event.mcp_servers || [],
        permissionMode: event.permissionMode || this.permissionMode,
        apiKeySource: event.apiKeySource || null,
        agents: event.agents || [],
        outputStyle: event.output_style || null,
      };
      this.push({ type: 'session', info: this.info });
      if (this.busy) this.setState('thinking');
      else this.setState('idle');
      return;
    }
    if (event.subtype === 'compact_boundary') {
      this.push({ type: 'notice', level: 'info', text: 'Contexto compactado.' });
      return;
    }
    // El CLI avisa aqui cuando bloquea una herramienta sin preguntar: fuera del
    // cwd, por una regla de settings o porque nadie respondio. Mandarlo al log
    // tecnico como "system:permission_denied" escondia el motivo, que es
    // justo lo unico util para arreglarlo.
    if (event.subtype === 'permission_denied') {
      const reason = event.message || event.decision_reason || 'sin motivo indicado';
      this.push({
        type: 'notice',
        level: 'error',
        text: `Permiso denegado · ${event.tool_name || 'herramienta'}: ${reason}`,
      });
      return;
    }
    // El CLI emite latidos de progreso varias veces por turno. No aportan nada
    // al hilo y lo inundan, asi que se descartan; el resto de subtipos
    // desconocidos baja al log tecnico en vez de a la conversacion.
    if (NOISY_SYSTEM_SUBTYPES.has(event.subtype)) return;
    this.push({ type: 'log', text: `system:${event.subtype || '?'}` });
  }

  handleAssistant(event) {
    const message = event.message || {};
    if (event.session_id) this.sessionId = event.session_id;
    const messageId = message.id || `msg_${Date.now()}`;
    const blocks = Array.isArray(message.content) ? message.content : [];
    // El CLI puede partir un mismo mensaje en varios eventos `assistant`, y cada
    // uno reindexa su contenido desde 0. Los deltas, en cambio, usan el indice
    // real dentro del mensaje completo. Sin este desplazamiento acumulado el
    // bloque final no casa con el que se pinto en streaming y el texto sale
    // duplicado (o encima del bloque de pensamiento).
    const base = this.messageBlockOffsets.get(messageId) || 0;
    if (blocks.length) this.messageBlockOffsets.set(messageId, base + blocks.length);
    blocks.forEach((block, index) => {
      const blockId = `${messageId}:${base + index}`;
      if (block.type === 'text') {
        this.push({ type: 'block', id: blockId, kind: 'text', text: block.text || '', final: true, subagent: Boolean(event.parent_tool_use_id) });
      } else if (block.type === 'thinking') {
        this.push({ type: 'block', id: blockId, kind: 'thinking', text: block.thinking || '', final: true });
      } else if (block.type === 'tool_use') {
        const { state, label } = stateForTool(block.name);
        const detail = describeToolInput(block.name, block.input);
        this.activeTools.set(block.id, { name: block.name, startedAt: Date.now(), state });
        this.push({
          type: 'tool',
          id: block.id,
          name: block.name,
          state,
          icon: iconForState(state),
          verb: label,
          detail,
          input: block.input || {},
          status: 'running',
        });
        this.setState(state, `${label}${detail ? ' · ' + detail : ''}`);
      }
    });
    if (blocks.length && blocks.every((b) => b.type === 'text' || b.type === 'thinking') && this.busy) {
      this.setState('thinking');
    }
  }

  handleUserEvent(event) {
    const message = event.message || {};
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;
      const entry = this.activeTools.get(block.tool_use_id);
      this.activeTools.delete(block.tool_use_id);
      this.push({
        type: 'tool_result',
        id: block.tool_use_id,
        status: block.is_error ? 'error' : 'ok',
        preview: flattenContent(block.content),
        durationMs: entry ? Date.now() - entry.startedAt : null,
      });
    }
    if (this.busy && this.activeTools.size === 0) this.setState('thinking');
  }

  handleStreamEvent(event) {
    const inner = event.event || {};
    const lane = event.parent_tool_use_id || 'main';

    // El id del mensaje solo llega en message_start; se guarda para que los
    // deltas usen la misma clave que el bloque final del evento `assistant`.
    if (inner.type === 'message_start') {
      const id = inner.message?.id;
      if (id) this.streamMessageIds.set(lane, id);
      return;
    }
    if (inner.type === 'message_stop') {
      this.streamMessageIds.delete(lane);
      return;
    }
    if (inner.type !== 'content_block_delta') return;

    const delta = inner.delta || {};
    const messageId = this.streamMessageIds.get(lane) || `live_${lane}`;
    const blockId = `${messageId}:${inner.index}`;
    if (delta.type === 'text_delta' && delta.text) {
      this.push({ type: 'delta', id: blockId, kind: 'text', text: delta.text });
    } else if (delta.type === 'thinking_delta' && delta.thinking) {
      this.push({ type: 'delta', id: blockId, kind: 'thinking', text: delta.thinking });
    }
  }

  handleResult(event) {
    if (event.session_id) this.sessionId = event.session_id;
    this.busy = false;
    this.turns += 1;
    const cost = Number(event.total_cost_usd || 0);
    if (cost) this.totalCostUsd += cost;
    this.lastResult = {
      subtype: event.subtype || 'success',
      isError: Boolean(event.is_error),
      durationMs: event.duration_ms || null,
      apiDurationMs: event.duration_api_ms || null,
      numTurns: event.num_turns || null,
      costUsd: cost || null,
      totalCostUsd: this.totalCostUsd,
      usage: event.usage || null,
      sessionId: this.sessionId,
      text: typeof event.result === 'string' ? event.result : null,
    };
    this.messageBlockOffsets.clear();
    this.push({ type: 'turn_end', result: this.lastResult });
    this.setState(event.is_error ? 'error' : 'done');
    setTimeout(() => {
      if (!this.busy && (this.state === 'done' || this.state === 'error')) this.setState('idle');
    }, 6000).unref?.();
  }

  /** Respuesta a nuestros propios control_request. Solo interesa el handshake. */
  handleControlResponse(event) {
    const response = event.response || {};
    if (!this.initRequestId || response.request_id !== this.initRequestId) return;
    const payload = response.response || {};
    if (!Array.isArray(payload.commands)) return;
    this.commands = payload.commands.map((cmd) => ({
      name: String(cmd.name || '').replace(/^\//, ''),
      description: cmd.description || '',
      argumentHint: cmd.argumentHint || cmd.argument_hint || '',
      builtin: Boolean(cmd.builtin),
    })).filter((cmd) => cmd.name);
    this.push({ type: 'commands', items: this.commands });
  }

  handleControlRequest(event) {
    const request = event.request || {};
    if (request.subtype !== 'can_use_tool') {
      this.push({ type: 'notice', level: 'info', text: `control_request: ${request.subtype || '?'}` });
      return;
    }
    const id = `perm_${randomUUID()}`;
    const input = request.input || request.tool_input || {};
    const toolName = request.tool_name || request.toolName || 'desconocida';
    // El CLI propone reglas ("permitir siempre este comando") junto a la
    // peticion; se guardan para poder devolverlas si el usuario las acepta.
    const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
    const timer = setTimeout(() => {
      if (this.pendingPermissions.has(id)) {
        this.push({ type: 'notice', level: 'warn', text: `Permiso para ${toolName} denegado por tiempo de espera.` });
        this.answerPermission(id, false, 'Sin respuesta a tiempo');
      }
    }, this.autoDenyMs);
    timer.unref?.();
    this.pendingPermissions.set(id, { requestId: event.request_id, input, toolName, timer, suggestions });
    this.push({
      type: 'permission',
      id,
      tool: request.display_name || toolName,
      detail: describeToolInput(toolName, input),
      reason: request.decision_reason || '',
      canRemember: suggestions.length > 0,
      input,
      expiresInMs: this.autoDenyMs,
    });
    this.setState('asking', `${toolName} necesita tu permiso`);
  }

  /* ------------------------------------------------------------------ */
  /* Estado y difusion                                                   */
  /* ------------------------------------------------------------------ */

  setState(state, detail) {
    const copy = STATE_COPY[state] || STATE_COPY.idle;
    this.state = state;
    this.stateLabel = copy.title;
    this.stateDetail = detail || copy.hint;
    this.push({
      type: 'state',
      state,
      label: this.stateLabel,
      detail: this.stateDetail,
      busy: this.busy,
      alive: this.isAlive(),
    });
  }

  push(event) {
    const enriched = { ...event, ts: event.ts || Date.now() };
    if (enriched.type !== 'delta') {
      this.history.push(enriched);
      if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.emit('event', enriched);
  }

  snapshot() {
    return {
      state: this.state,
      label: this.stateLabel,
      detail: this.stateDetail,
      busy: this.busy,
      alive: this.isAlive(),
      sessionId: this.sessionId,
      info: this.info,
      cwd: this.cwd,
      model: this.model,
      permissionMode: this.permissionMode,
      effort: this.effort,
      addDirs: this.addDirs,
      commands: this.commands,
      turns: this.turns,
      totalCostUsd: this.totalCostUsd,
      lastResult: this.lastResult,
      pendingPermissions: [...this.pendingPermissions.entries()].map(([id, p]) => ({ id, tool: p.toolName })),
    };
  }

  clearHistory() {
    this.history = [];
  }

  /** Reinicia la conversacion: mata el proceso y olvida el session id. */
  async reset() {
    this.stop();
    this.sessionId = null;
    this.info = null;
    this.turns = 0;
    this.totalCostUsd = 0;
    this.lastResult = null;
    // El catalogo pertenece al proyecto que se cierra; el proximo arranque
    // vuelve a pedirlo con el handshake.
    this.commands = [];
    this.initRequestId = null;
    // Lo que quedara encolado pertenece a la conversacion que se cierra; si no
    // se descarta, el siguiente proceso lo recibiria como primer mensaje.
    this.pendingInput = [];
    this.clearHistory();
    this.push({ type: 'reset' });
    this.setState('idle');
  }

  /**
   * Cambia la carpeta sobre la que trabaja Claude. El `session_id` pertenece al
   * proyecto anterior (y `--resume` lo buscaria en su historial), asi que
   * cambiar de carpeta obliga a cerrar el proceso y empezar conversacion nueva.
   * El proceso no se relanza aqui: arranca solo con el siguiente mensaje.
   */
  async setCwd(dir) {
    if (dir === this.cwd) return false;
    this.cwd = dir;
    await this.reset();
    return true;
  }
}

function flattenContent(content) {
  if (typeof content === 'string') return content.slice(0, 4000);
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && part.type === 'text') return part.text;
        if (part && part.type === 'image') return '[imagen]';
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
  }
  if (content && typeof content === 'object') return JSON.stringify(content).slice(0, 4000);
  return '';
}
