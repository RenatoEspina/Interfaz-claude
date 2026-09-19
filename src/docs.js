import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listDir, readIfExists, statIfExists, parseFrontmatter, safeJoin, slugify, truncate, nowIso } from './util.js';

/**
 * Boveda de documentacion: una carpeta de markdown que Clawd Deck lista,
 * lee, crea y edita. Por defecto `docs/` dentro del proyecto.
 */
export class DocsVault {
  constructor(root) {
    this.root = path.resolve(root);
  }

  async ensure() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async list() {
    await this.ensure();
    const docs = [];
    const walk = async (dir, depth = 0) => {
      if (depth > 2) return;
      for (const entry of await listDir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!/\.(md|markdown)$/i.test(entry.name)) continue;
        const stat = await statIfExists(full);
        const raw = (await readIfExists(full)) || '';
        const { data, body } = parseFrontmatter(raw);
        const heading = /^#\s+(.+)$/m.exec(body);
        docs.push({
          slug: path.relative(this.root, full).replace(/\\/g, '/'),
          title: data.title || (heading ? heading[1].trim() : entry.name.replace(/\.(md|markdown)$/i, '')),
          summary: data.summary || truncate(firstParagraph(body), 180),
          tags: normalizeTags(data.tags),
          category: data.category || path.relative(this.root, path.dirname(full)).replace(/\\/g, '/') || 'general',
          pinned: data.pinned === 'true' || data.pinned === true,
          updated: data.updated || (stat ? stat.mtime.toISOString() : null),
          bytes: stat ? stat.size : 0,
          words: body.split(/\s+/).filter(Boolean).length,
        });
      }
    };
    await walk(this.root);
    docs.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.slug.localeCompare(b.slug));
    return docs;
  }

  async read(slug) {
    const full = this.resolve(slug);
    const raw = await readIfExists(full);
    if (raw === null) {
      const err = new Error('Documento no encontrado');
      err.status = 404;
      throw err;
    }
    const stat = await statIfExists(full);
    const { data, body } = parseFrontmatter(raw);
    return {
      slug,
      title: data.title || slug.replace(/\.(md|markdown)$/i, ''),
      tags: normalizeTags(data.tags),
      category: data.category || 'general',
      summary: data.summary || '',
      updated: data.updated || (stat ? stat.mtime.toISOString() : null),
      raw,
      body,
      frontmatter: data,
    };
  }

  async save(slug, { title, body, tags, summary, category, pinned }) {
    const full = this.resolve(slug);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const meta = {
      title: title || slug,
      updated: nowIso(),
    };
    if (summary) meta.summary = summary;
    if (category) meta.category = category;
    if (pinned) meta.pinned = 'true';
    const tagList = normalizeTags(tags);
    const lines = ['---'];
    for (const [key, value] of Object.entries(meta)) lines.push(`${key}: ${escapeValue(value)}`);
    if (tagList.length) lines.push(`tags: [${tagList.join(', ')}]`);
    lines.push('---', '');
    const content = lines.join('\n') + (body || '').replace(/^\n+/, '') + '\n';
    await fs.writeFile(full, content, 'utf8');
    return this.read(slug);
  }

  async create({ title, body, tags, summary, category }) {
    await this.ensure();
    const base = slugify(title || 'nota');
    let slug = `${base}.md`;
    let counter = 2;
    while (await statIfExists(this.resolve(slug))) {
      slug = `${base}-${counter++}.md`;
    }
    return this.save(slug, { title, body: body || `# ${title || 'Nota'}\n\n`, tags, summary, category });
  }

  async remove(slug) {
    const full = this.resolve(slug);
    await fs.unlink(full);
    return { removed: slug };
  }

  async search(query) {
    const needle = String(query || '').toLowerCase().trim();
    if (!needle) return [];
    const docs = await this.list();
    const results = [];
    for (const doc of docs) {
      const raw = (await readIfExists(this.resolve(doc.slug))) || '';
      const { body } = parseFrontmatter(raw);
      const index = body.toLowerCase().indexOf(needle);
      const matchesMeta = doc.title.toLowerCase().includes(needle) || doc.tags.some((t) => t.toLowerCase().includes(needle));
      if (index === -1 && !matchesMeta) continue;
      results.push({
        ...doc,
        excerpt: index === -1
          ? doc.summary
          : truncate(body.slice(Math.max(0, index - 80), index + 160).replace(/\s+/g, ' '), 240),
      });
    }
    return results;
  }

  resolve(slug) {
    const clean = String(slug || '').replace(/^\/+/, '');
    if (!/\.(md|markdown)$/i.test(clean)) {
      const err = new Error('Solo se permiten archivos markdown');
      err.status = 400;
      throw err;
    }
    return safeJoin(this.root, clean);
  }
}

function firstParagraph(body) {
  const withoutHeading = body.replace(/^#.*$/m, '').trim();
  const paragraph = withoutHeading.split(/\n\s*\n/)[0] || '';
  return paragraph.replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function escapeValue(value) {
  const str = String(value);
  return /[:#]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}
