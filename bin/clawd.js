#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from '../src/server.js';

const HELP = `
Clawd Deck — capa web local para Claude Code por terminal

Uso:
  clawd-deck [opciones]

Opciones:
  --port <n>            Puerto HTTP (por defecto 4317)
  --host <h>            Interfaz de escucha (por defecto 127.0.0.1)
  --cwd <ruta>          Proyecto sobre el que trabaja Claude (por defecto, el actual)
  --docs <ruta>         Carpeta de la boveda de documentacion (por defecto <cwd>/docs)
  --model <id>          Modelo a usar (opus, sonnet, haiku, claude-opus-5, ...)
  --permission-mode <m> manual | default | acceptEdits | dontAsk | bypassPermissions | plan
  --effort <nivel>      low | medium | high | xhigh | max
  --claude-bin <ruta>   Binario de Claude Code (por defecto "claude" del PATH)
  --no-token            No exigir token de acceso (solo para entornos aislados)
  --read-only           Prohibe escribir archivos del proyecto desde la UI
  --open                Intenta abrir el navegador al arrancar
  --autostart           Lanza el proceso de Claude Code al arrancar el servidor
  -h, --help            Esta ayuda
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (arg === '-h') out.help = true;
      else out._.push(arg);
      continue;
    }
    const [flag, inlineValue] = arg.slice(2).split('=');
    const key = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    const takesValue = !['noToken', 'readOnly', 'open', 'autostart', 'help'].includes(key);
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
    } else if (takesValue && next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const port = Number(args.port || process.env.CLAWD_DECK_PORT || 4317);
const host = args.host || process.env.CLAWD_DECK_HOST || '127.0.0.1';
const cwd = path.resolve(args.cwd || process.cwd());

const { server, session, token, docs } = createServer({
  cwd,
  docsDir: args.docs ? path.resolve(args.docs) : undefined,
  model: args.model || process.env.CLAWD_DECK_MODEL || null,
  permissionMode: args.permissionMode || process.env.CLAWD_DECK_PERMISSION_MODE || 'acceptEdits',
  effort: args.effort || null,
  bin: args.claudeBin || process.env.CLAWD_DECK_CLAUDE_BIN || 'claude',
  token: args.noToken ? false : process.env.CLAWD_DECK_TOKEN || undefined,
  readOnly: Boolean(args.readOnly),
});

server.listen(port, host, async () => {
  await docs.ensure();
  const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  const url = token ? `${base}/?token=${token}` : base;
  console.log('');
  console.log('  ╭──────────────────────────────────────────────╮');
  console.log('  │  Clawd Deck                                  │');
  console.log('  ╰──────────────────────────────────────────────╯');
  console.log(`  Proyecto : ${cwd}`);
  console.log(`  Docs     : ${docs.root}`);
  console.log(`  Claude   : ${session.bin} (permisos: ${session.permissionMode})`);
  console.log(`  URL      : ${url}`);
  if (!token) console.log('  Aviso    : token desactivado (--no-token)');
  console.log('');
  if (args.autostart) session.start();
  if (args.open) openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`No se pudo escuchar en ${host}:${port}: el puerto esta ocupado. Prueba con --port ${port + 1}.`);
  } else {
    console.error('Error del servidor:', err.message);
  }
  process.exit(1);
});

function openBrowser(url) {
  const platform = os.platform();
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform === 'win32' }).unref();
  } catch { /* sin navegador disponible */ }
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    console.log('\nCerrando Clawd Deck…');
    session.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
