import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Resolve a user-supplied relative path inside `root`, refusing escapes. */
export function safeJoin(root, relative) {
  const target = path.resolve(root, relative || '.');
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) {
    const err = new Error('Ruta fuera del directorio permitido');
    err.status = 400;
    throw err;
  }
  return target;
}

export async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    throw err;
  }
}

export async function statIfExists(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

export async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function exists(file) {
  return (await statIfExists(file)) !== null;
}

/** Parse the YAML-ish frontmatter block used by skills, commands and agents. */
export function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { data: {}, body: text || '' };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(3, end).replace(/^\r?\n/, '');
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  let currentKey = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(stripQuotes(listItem[1].trim()));
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    currentKey = match[1];
    const value = match[2].trim();
    if (value === '') {
      data[currentKey] = '';
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((v) => stripQuotes(v.trim()))
        .filter(Boolean);
    } else {
      data[currentKey] = stripQuotes(value);
    }
  }
  return { data, body };
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

export function truncate(text, max = 400) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sin-titulo';
}

export function nowIso() {
  return new Date().toISOString();
}
