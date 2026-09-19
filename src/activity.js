/**
 * Traduce los eventos del stream de Claude Code a "estados de Clawd",
 * que es lo que la mascota del frontend anima.
 *
 * Estados: idle | booting | thinking | reading | writing | searching |
 *          running | web | delegating | asking | done | error | stopped
 */

const TOOL_STATES = [
  [/^(Read|NotebookRead)$/i, 'reading', 'leyendo'],
  [/^(Edit|Write|MultiEdit|NotebookEdit|Update)$/i, 'writing', 'escribiendo'],
  [/^(Grep|Glob|Search|SearchSkills|ToolSearch|ListSkills|ListAgents)$/i, 'searching', 'buscando'],
  [/^(Bash|BashOutput|KillShell|KillBash|Shell)$/i, 'running', 'ejecutando'],
  [/^(WebFetch|WebSearch)$/i, 'web', 'navegando'],
  [/^(Agent|Task|SendMessage)$/i, 'delegating', 'delegando'],
  [/^(TodoWrite|ExitPlanMode|EnterPlanMode)$/i, 'thinking', 'planificando'],
  [/^Skill$/i, 'thinking', 'usando una skill'],
  [/^mcp__/i, 'web', 'hablando con un MCP'],
];

const TOOL_ICONS = {
  reading: '📖',
  writing: '✎',
  searching: '🔍',
  running: '⚡',
  web: '🌐',
  delegating: '🤝',
  thinking: '💭',
};

export function stateForTool(toolName) {
  const name = String(toolName || '');
  for (const [pattern, state, label] of TOOL_STATES) {
    if (pattern.test(name)) return { state, label };
  }
  return { state: 'running', label: 'trabajando' };
}

export function iconForState(state) {
  return TOOL_ICONS[state] || '•';
}

/** Resumen humano y corto de la entrada de una herramienta. */
export function describeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return '';
  const name = String(toolName || '');
  if (input.file_path) return shortenPath(input.file_path);
  if (input.notebook_path) return shortenPath(input.notebook_path);
  if (name === 'Bash' && input.command) return String(input.command).split('\n')[0].slice(0, 120);
  if (input.pattern) return String(input.pattern).slice(0, 120);
  if (input.query) return String(input.query).slice(0, 120);
  if (input.url) return String(input.url).slice(0, 120);
  if (input.prompt) return String(input.prompt).split('\n')[0].slice(0, 120);
  if (input.description) return String(input.description).slice(0, 120);
  if (input.skill) return String(input.skill);
  const keys = Object.keys(input);
  return keys.length ? `${keys[0]}: ${String(input[keys[0]]).slice(0, 80)}` : '';
}

export function shortenPath(filePath, keep = 3) {
  const parts = String(filePath).split('/').filter(Boolean);
  if (parts.length <= keep) return String(filePath);
  return '…/' + parts.slice(-keep).join('/');
}

/** Frases de estado que la UI muestra bajo la mascota. */
export const STATE_COPY = {
  idle: { title: 'En reposo', hint: 'Clawd espera instrucciones' },
  booting: { title: 'Arrancando', hint: 'Levantando el proceso de Claude Code' },
  thinking: { title: 'Pensando', hint: 'Razonando sobre el siguiente paso' },
  reading: { title: 'Leyendo', hint: 'Revisando archivos del proyecto' },
  writing: { title: 'Escribiendo', hint: 'Editando archivos' },
  searching: { title: 'Buscando', hint: 'Rastreando el codigo' },
  running: { title: 'Ejecutando', hint: 'Corriendo comandos en la terminal' },
  web: { title: 'Navegando', hint: 'Consultando la red o un MCP' },
  delegating: { title: 'Delegando', hint: 'Coordinando subagentes' },
  asking: { title: 'Preguntando', hint: 'Clawd necesita tu permiso' },
  done: { title: 'Listo', hint: 'Turno terminado' },
  error: { title: 'Ups', hint: 'Algo fallo en el ultimo turno' },
  stopped: { title: 'Detenido', hint: 'Turno interrumpido' },
};
