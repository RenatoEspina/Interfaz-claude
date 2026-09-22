import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listDir, readIfExists, statIfExists, parseFrontmatter, truncate, safeJoin, exists, isInside, resolveWithinRoots } from './util.js';

const run = promisify(execFile);
const HOME_CLAUDE = path.join(os.homedir(), '.claude');
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', '.cache', 'target', 'vendor']);

/* -------------------------------------------------------------------- */
/* Memoria: CLAUDE.md y familia                                          */
/* -------------------------------------------------------------------- */

export async function getMemoryFiles(cwd) {
  const candidates = [
    { scope: 'proyecto', file: path.join(cwd, 'CLAUDE.md') },
    { scope: 'proyecto', file: path.join(cwd, '.claude', 'CLAUDE.md') },
    { scope: 'local', file: path.join(cwd, 'CLAUDE.local.md') },
    { scope: 'usuario', file: path.join(HOME_CLAUDE, 'CLAUDE.md') },
    { scope: 'proyecto', file: path.join(cwd, 'AGENTS.md') },
  ];
  const out = [];
  for (const candidate of candidates) {
    const stat = await statIfExists(candidate.file);
    if (!stat || !stat.isFile()) continue;
    const content = await readIfExists(candidate.file);
    out.push({
      scope: candidate.scope,
      path: candidate.file,
      relative: path.relative(cwd, candidate.file) || path.basename(candidate.file),
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      lines: content ? content.split('\n').length : 0,
      content: content || '',
      imports: extractImports(content || ''),
    });
  }
  return out;
}

function extractImports(content) {
  const found = new Set();
  const re = /(?:^|\s)@([./~][^\s`)]+)/g;
  let match;
  while ((match = re.exec(content))) found.add(match[1]);
  return [...found];
}

/* -------------------------------------------------------------------- */
/* Skills                                                                */
/* -------------------------------------------------------------------- */

async function findSkillFiles(root, depth = 0, acc = []) {
  if (depth > 3) return acc;
  for (const entry of await listDir(root)) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await findSkillFiles(full, depth + 1, acc);
    } else if (entry.isFile() && entry.name.toUpperCase() === 'SKILL.MD') {
      acc.push(full);
    }
  }
  return acc;
}

export async function getSkills(cwd) {
  const roots = [
    { origin: 'proyecto', dir: path.join(cwd, '.claude', 'skills') },
    { origin: 'usuario', dir: path.join(HOME_CLAUDE, 'skills') },
    { origin: 'plugins', dir: path.join(HOME_CLAUDE, 'plugins') },
  ];
  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    const files = await findSkillFiles(root.dir);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      const content = (await readIfExists(file)) || '';
      const { data, body } = parseFrontmatter(content);
      const stat = await statIfExists(file);
      const dir = path.dirname(file);
      const resources = (await listDir(dir))
        .filter((e) => e.name.toUpperCase() !== 'SKILL.MD')
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
      skills.push({
        name: data.name || path.basename(dir),
        origin: root.origin,
        description: data.description || truncate(body.trim().split('\n')[0] || '', 200),
        allowedTools: data['allowed-tools'] || data.allowedTools || null,
        model: data.model || null,
        path: file,
        directory: dir,
        bytes: stat ? stat.size : 0,
        modified: stat ? stat.mtime.toISOString() : null,
        resources,
        content,
      });
    }
  }
  skills.sort((a, b) => a.origin.localeCompare(b.origin) || a.name.localeCompare(b.name));
  return skills;
}

/* -------------------------------------------------------------------- */
/* Comandos (slash) y subagentes                                         */
/* -------------------------------------------------------------------- */

async function collectMarkdown(dir, prefix = '') {
  const out = [];
  for (const entry of await listDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full, prefix + entry.name + ':')));
    } else if (entry.name.endsWith('.md')) {
      out.push({ id: prefix + entry.name.replace(/\.md$/, ''), path: full });
    }
  }
  return out;
}

export async function getCommands(cwd) {
  const roots = [
    { origin: 'proyecto', dir: path.join(cwd, '.claude', 'commands') },
    { origin: 'usuario', dir: path.join(HOME_CLAUDE, 'commands') },
  ];
  const commands = [];
  for (const root of roots) {
    for (const entry of await collectMarkdown(root.dir)) {
      const content = (await readIfExists(entry.path)) || '';
      const { data, body } = parseFrontmatter(content);
      commands.push({
        name: '/' + entry.id,
        origin: root.origin,
        description: data.description || truncate(body.trim().split('\n')[0] || '', 160),
        argumentHint: data['argument-hint'] || null,
        allowedTools: data['allowed-tools'] || null,
        model: data.model || null,
        path: entry.path,
        content,
      });
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgents(cwd) {
  const roots = [
    { origin: 'proyecto', dir: path.join(cwd, '.claude', 'agents') },
    { origin: 'usuario', dir: path.join(HOME_CLAUDE, 'agents') },
  ];
  const agents = [];
  for (const root of roots) {
    for (const entry of await collectMarkdown(root.dir)) {
      const content = (await readIfExists(entry.path)) || '';
      const { data, body } = parseFrontmatter(content);
      agents.push({
        name: data.name || entry.id,
        origin: root.origin,
        description: data.description || truncate(body.trim().split('\n')[0] || '', 200),
        tools: data.tools || null,
        model: data.model || null,
        path: entry.path,
        content,
      });
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------- */
/* Configuracion: settings, hooks, MCP                                   */
/* -------------------------------------------------------------------- */

async function readJson(file) {
  const raw = await readIfExists(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { __parseError: err.message };
  }
}

export async function getConfig(cwd) {
  const files = [
    { scope: 'proyecto', file: path.join(cwd, '.claude', 'settings.json') },
    { scope: 'local', file: path.join(cwd, '.claude', 'settings.local.json') },
    { scope: 'usuario', file: path.join(HOME_CLAUDE, 'settings.json') },
  ];
  const settings = [];
  for (const item of files) {
    const data = await readJson(item.file);
    if (data === null) continue;
    settings.push({ scope: item.scope, path: item.file, data });
  }

  const mcpFiles = [
    { scope: 'proyecto', file: path.join(cwd, '.mcp.json') },
    { scope: 'usuario', file: path.join(os.homedir(), '.claude.json') },
  ];
  const mcpServers = [];
  for (const item of mcpFiles) {
    const data = await readJson(item.file);
    if (!data || data.__parseError) continue;
    const servers = data.mcpServers || {};
    for (const [name, def] of Object.entries(servers)) {
      mcpServers.push({
        name,
        scope: item.scope,
        transport: def.type || (def.url ? 'http' : 'stdio'),
        command: def.command || def.url || null,
        args: def.args || [],
        path: item.file,
      });
    }
  }

  const hooks = [];
  for (const entry of settings) {
    const raw = entry.data && entry.data.hooks;
    if (!raw || typeof raw !== 'object') continue;
    for (const [event, matchers] of Object.entries(raw)) {
      for (const matcher of [].concat(matchers || [])) {
        for (const hook of [].concat((matcher && matcher.hooks) || [])) {
          hooks.push({
            event,
            matcher: (matcher && matcher.matcher) || '*',
            type: hook.type || 'command',
            command: truncate(hook.command || '', 200),
            scope: entry.scope,
          });
        }
      }
    }
  }

  return { settings, mcpServers, hooks };
}

/* -------------------------------------------------------------------- */
/* Contexto del proyecto: git, arbol de archivos                         */
/* -------------------------------------------------------------------- */

export async function getGitInfo(cwd) {
  const info = { isRepo: false };
  try {
    const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    if (stdout.trim() !== 'true') return info;
    info.isRepo = true;
  } catch {
    return info;
  }
  const safe = async (args) => {
    try {
      const { stdout } = await run('git', args, { cwd, maxBuffer: 1024 * 1024 });
      return stdout.trim();
    } catch {
      return '';
    }
  };
  info.branch = await safe(['rev-parse', '--abbrev-ref', 'HEAD']);
  info.lastCommit = await safe(['log', '-1', '--pretty=%h %s']);
  const status = await safe(['status', '--porcelain']);
  info.dirty = status
    ? status.split('\n').filter(Boolean).slice(0, 60).map((line) => ({
        status: line.slice(0, 2).trim(),
        file: line.slice(3),
      }))
    : [];
  info.changedCount = status ? status.split('\n').filter(Boolean).length : 0;
  info.remote = await safe(['remote', 'get-url', 'origin']);
  return info;
}

export async function getTree(cwd, relative = '.') {
  const dir = safeJoin(cwd, relative);
  const entries = await listDir(dir);
  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !['.claude', '.mcp.json', '.github'].includes(entry.name)) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const stat = await statIfExists(full);
    items.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      relative: path.relative(cwd, full),
      bytes: stat && stat.isFile() ? stat.size : null,
      modified: stat ? stat.mtime.toISOString() : null,
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return { dir: path.relative(cwd, dir) || '.', items };
}

/* -------------------------------------------------------------------- */
/* Explorador para el selector de proyecto                               */
/* -------------------------------------------------------------------- */

/**
 * Lista las subcarpetas de `target` para poder elegir sobre que proyecto
 * trabaja Claude. Solo devuelve directorios y marca los que parecen un
 * proyecto (tienen `.git` o `CLAUDE.md`), que son los que interesan al elegir.
 *
 * `getTree` sirve para mirar dentro del proyecto abierto y por eso usa
 * `safeJoin`; esto se mueve por las raices permitidas, que es justo lo
 * contrario, asi que valida con `resolveWithinRoots`.
 */
export async function browseDirs(target, roots) {
  const dir = resolveWithinRoots(roots, target);
  const stat = await statIfExists(dir);
  if (!stat || !stat.isDirectory()) {
    const err = new Error('La carpeta no existe o no es un directorio');
    err.status = 404;
    throw err;
  }

  const items = [];
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    items.push({ name: entry.name, path: full, ...(await projectMarks(full)) });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  // Solo se ofrece subir si el padre sigue dentro de las raices permitidas;
  // asi el boton desaparece al llegar al tope en vez de dar un 403.
  const parent = path.dirname(dir);
  const canGoUp = parent !== dir && roots.some((root) => isInside(root, parent));

  return {
    dir,
    parent: canGoUp ? parent : null,
    roots,
    ...(await projectMarks(dir)),
    items,
  };
}

async function projectMarks(dir) {
  const [isRepo, hasMemory] = await Promise.all([
    exists(path.join(dir, '.git')),
    exists(path.join(dir, 'CLAUDE.md')),
  ]);
  return { isRepo, hasMemory };
}

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.ini', '.css', '.scss', '.html', '.sql', '.env.example', '.gitignore', '.xml', '.csv']);

export async function readProjectFile(cwd, relative) {
  const full = safeJoin(cwd, relative);
  const stat = await statIfExists(full);
  if (!stat || !stat.isFile()) {
    const err = new Error('Archivo no encontrado');
    err.status = 404;
    throw err;
  }
  if (stat.size > 512 * 1024) {
    return { path: relative, tooLarge: true, bytes: stat.size, content: '' };
  }
  const ext = path.extname(full).toLowerCase();
  if (ext && !TEXT_EXT.has(ext) && !path.basename(full).startsWith('.')) {
    return { path: relative, binary: true, bytes: stat.size, content: '' };
  }
  const content = await fs.readFile(full, 'utf8');
  return {
    path: relative,
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    language: ext.replace('.', '') || 'text',
    content,
  };
}

export async function writeProjectFile(cwd, relative, content) {
  const full = safeJoin(cwd, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  const stat = await statIfExists(full);
  return { path: relative, bytes: stat ? stat.size : content.length, modified: stat ? stat.mtime.toISOString() : null };
}

/* -------------------------------------------------------------------- */
/* Historial de sesiones de Claude Code (~/.claude/projects)             */
/* -------------------------------------------------------------------- */

export function projectSlug(cwd) {
  // Claude Code nombra la carpeta de ~/.claude/projects sustituyendo por "-"
  // todo lo que no sea alfanumerico: barras, puntos y tambien los espacios.
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

export async function getSessions(cwd, limit = 25) {
  const dir = path.join(HOME_CLAUDE, 'projects', projectSlug(cwd));
  const entries = await listDir(dir);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const full = path.join(dir, entry.name);
    const stat = await statIfExists(full);
    let firstPrompt = '';
    let messages = 0;
    try {
      const raw = await fs.readFile(full, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      messages = lines.length;
      for (const line of lines.slice(0, 40)) {
        try {
          const parsed = JSON.parse(line);
          const content = parsed?.message?.content;
          if (parsed.type === 'user' && content) {
            const text = typeof content === 'string'
              ? content
              : (Array.isArray(content) ? content.find((c) => c.type === 'text')?.text : '');
            if (text && !text.startsWith('<')) {
              firstPrompt = truncate(text.replace(/\s+/g, ' '), 140);
              break;
            }
          }
        } catch { /* linea corrupta, se ignora */ }
      }
    } catch { /* ignore */ }
    sessions.push({
      id: entry.name.replace(/\.jsonl$/, ''),
      path: full,
      messages,
      bytes: stat ? stat.size : 0,
      modified: stat ? stat.mtime.toISOString() : null,
      firstPrompt,
    });
  }
  sessions.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return sessions.slice(0, limit);
}

export async function getOverview(cwd) {
  const [memory, skills, commands, agents, config, git] = await Promise.all([
    getMemoryFiles(cwd),
    getSkills(cwd),
    getCommands(cwd),
    getAgents(cwd),
    getConfig(cwd),
    getGitInfo(cwd),
  ]);
  return {
    cwd,
    name: path.basename(cwd),
    home: HOME_CLAUDE,
    counts: {
      memory: memory.length,
      skills: skills.length,
      commands: commands.length,
      agents: agents.length,
      mcpServers: config.mcpServers.length,
      hooks: config.hooks.length,
    },
    memory: memory.map(({ content, ...rest }) => rest),
    skills: skills.map(({ content, ...rest }) => rest),
    commands: commands.map(({ content, ...rest }) => rest),
    agents: agents.map(({ content, ...rest }) => rest),
    config,
    git,
  };
}
