/* Renderizador markdown minimo y sin dependencias.
   Escapa siempre el HTML de entrada antes de aplicar formato. */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    /^(https?:|\/)/.test(src) ? `<img src="${src}" alt="${alt}" />` : alt);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    /^(https?:|mailto:|#|\/)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let listStack = [];

  const closeLists = (toDepth = 0) => {
    while (listStack.length > toDepth) html.push(`</${listStack.pop()}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    // bloques de codigo
    const fence = /^\s*```+\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      closeLists();
      const lang = fence[1] || '';
      const buffer = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) buffer.push(lines[i++]);
      i++;
      html.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(buffer.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { closeLists(); i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeLists(); html.push('<hr />'); i++; continue; }

    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buffer = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buffer.push(lines[i++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(buffer.join('\n'))}</blockquote>`);
      continue;
    }

    // tablas
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      closeLists();
      const header = splitRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(splitRow(lines[i++]));
      html.push('<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map((row) => '<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    // listas
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2) + 1;
      const type = /\d/.test(bullet[2]) ? 'ol' : 'ul';
      while (listStack.length > depth) html.push(`</${listStack.pop()}>`);
      while (listStack.length < depth) { html.push(`<${type}>`); listStack.push(type); }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(bullet[3]);
      const content = task
        ? `<input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''} /> ${inline(task[2])}`
        : inline(bullet[3]);
      html.push(`<li>${content}</li>`);
      i++;
      continue;
    }

    closeLists();
    const buffer = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```))/.test(lines[i])) {
      buffer.push(lines[i++]);
    }
    html.push(`<p>${inline(buffer.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }
  closeLists();
  return html.join('\n');
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}
