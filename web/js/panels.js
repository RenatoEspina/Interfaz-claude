/* Panel lateral de utilidades: resumen, memoria, skills, comandos, agentes,
   configuracion, archivos, sesiones y la boveda de documentacion. */
import { api } from './api.js';
import { el, clear, formatBytes, timeAgo } from './dom.js';
import { renderMarkdown } from './markdown.js';

export const PANEL_TITLES = {
  overview: 'Resumen', project: 'Proyecto', memory: 'CLAUDE.md', skills: 'Skills',
  commands: 'Comandos', agents: 'Agentes', config: 'Config & MCP', files: 'Archivos',
  sessions: 'Sesiones', docs: 'Documentacion',
};

export class Panels {
  constructor(container, { insertPrompt, runPrompt, notify, onShow }) {
    this.container = container;
    this.insertPrompt = insertPrompt;
    this.runPrompt = runPrompt;
    this.notify = notify;
    this.onShow = onShow;
    this.current = 'overview';
    this.filesPath = '.';
    // null = el servidor decide donde empezar a explorar (el proyecto abierto).
    this.browsePath = null;
    this.docsFilter = '';
  }

  async show(name) {
    this.current = name;
    this.onShow?.(name);
    await this.render();
  }

  async render() {
    const host = clear(this.container);
    host.append(el('div', { class: 'empty-note', text: 'cargando…' }));
    try {
      const view = await this[`render_${this.current}`]();
      clear(host).append(view);
    } catch (err) {
      clear(host).append(el('div', { class: 'empty-note', text: `Error: ${err.message}` }));
    }
  }

  /* ------------------------------------------------------------ resumen */

  async render_overview() {
    const data = await api.overview();
    const frag = document.createDocumentFragment();

    frag.append(el('div', { class: 'card' }, [
      el('h3', { class: 'card__title', text: data.name }),
      el('p', { class: 'card__desc mono', text: data.cwd }),
      el('div', { class: 'card__meta' }, [
        el('span', { class: 'tag tag--accent', text: `${data.counts.skills} skills` }),
        el('span', { class: 'tag', text: `${data.counts.commands} comandos` }),
        el('span', { class: 'tag', text: `${data.counts.agents} agentes` }),
        el('span', { class: 'tag', text: `${data.counts.mcpServers} MCP` }),
        el('span', { class: 'tag', text: `${data.counts.hooks} hooks` }),
      ]),
    ]));

    frag.append(el('div', { class: 'section-title', text: 'Git' }));
    if (data.git.isRepo) {
      frag.append(el('div', { class: 'card' }, [
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'rama' }), el('dd', { text: data.git.branch || '—' }),
          el('dt', { text: 'ultimo' }), el('dd', { text: data.git.lastCommit || '—' }),
          el('dt', { text: 'cambios' }), el('dd', { text: String(data.git.changedCount ?? 0) }),
          el('dt', { text: 'remoto' }), el('dd', { text: data.git.remote || '—' }),
        ]),
        data.git.dirty?.length
          ? el('div', { class: 'card__meta' }, data.git.dirty.slice(0, 12).map((f) =>
              el('span', { class: 'tag', text: `${f.status} ${f.file}` })))
          : null,
      ]));
    } else {
      frag.append(el('div', { class: 'empty-note', text: 'Este directorio no es un repositorio git.' }));
    }

    frag.append(el('div', { class: 'section-title', text: 'Memoria detectada' }));
    if (data.memory.length) {
      for (const item of data.memory) {
        frag.append(this.card({
          title: item.relative,
          desc: `${item.lines} lineas · ${formatBytes(item.bytes)} · ${timeAgo(item.modified)}`,
          tags: [item.scope],
          onClick: () => this.show('memory'),
        }));
      }
    } else {
      frag.append(el('div', { class: 'empty-note', text: 'Sin CLAUDE.md en este proyecto. Puedes crearlo desde la pestaña CLAUDE.md.' }));
    }

    frag.append(el('div', { class: 'section-title', text: 'Atajos' }));
    const shortcuts = [
      ['Explica la arquitectura de este proyecto', 'Lee el CLAUDE.md y los archivos principales y explica la arquitectura del proyecto.'],
      ['Revisa los cambios sin commitear', 'Revisa `git diff` y dime que problemas ves antes de commitear.'],
      ['Documenta lo que acabamos de hacer', 'Resume lo que hicimos en esta sesion en formato markdown, listo para guardar en la boveda de documentacion.'],
    ];
    for (const [label, prompt] of shortcuts) {
      frag.append(el('button', { class: 'hint-btn', text: label, onclick: () => this.insertPrompt(prompt) }));
    }
    return frag;
  }

  /* ----------------------------------------------------------- proyecto */

  async render_project() {
    let data;
    try {
      data = await api.browse(this.browsePath);
    } catch (err) {
      // `browsePath` sobrevive entre renders, asi que si la carpeta desaparecio
      // el panel quedaria atascado en el error. Se vuelve al proyecto abierto.
      if (!this.browsePath) throw err;
      this.browsePath = null;
      this.notify(`No se pudo abrir esa carpeta: ${err.message}`);
      data = await api.browse(null);
    }
    // El servidor devuelve la ruta ya resuelta; se guarda para que recargar el
    // panel no vuelva al punto de partida.
    this.browsePath = data.dir;
    const isCurrent = data.dir === data.current;
    const frag = document.createDocumentFragment();

    frag.append(el('div', { class: 'empty-note', text: 'Elige la carpeta sobre la que trabaja Claude. Al cambiar se cierra la conversacion actual y empieza una nueva en el proyecto nuevo.' }));

    frag.append(el('div', { class: 'card' }, [
      el('div', { class: 'card__top' }, [
        el('h3', { class: 'card__title', text: data.dir.split('/').filter(Boolean).pop() || '/' }),
        isCurrent ? el('span', { class: 'tag tag--accent', text: 'proyecto actual' }) : null,
      ]),
      el('p', { class: 'card__desc mono', text: data.dir }),
      el('div', { class: 'card__meta' }, [
        data.isRepo ? el('span', { class: 'tag', text: 'git' }) : null,
        data.hasMemory ? el('span', { class: 'tag', text: 'CLAUDE.md' }) : null,
      ]),
      isCurrent
        ? null
        : el('button', { class: 'primary-btn', text: 'Abrir esta carpeta', onclick: () => this.switchProject(data.dir) }),
    ]));

    const crumbs = el('div', { class: 'breadcrumb' });
    if (data.parent) {
      crumbs.append(el('button', { text: '↑ subir', onclick: () => { this.browsePath = data.parent; this.render(); } }));
    }
    crumbs.append(el('button', { text: '⌂ home', onclick: () => { this.browsePath = data.home; this.render(); } }));
    if (!isCurrent) {
      crumbs.append(el('button', { text: '◆ proyecto actual', onclick: () => { this.browsePath = data.current; this.render(); } }));
    }
    frag.append(crumbs);

    frag.append(el('div', { class: 'section-title', text: 'Carpetas' }));
    if (!data.items.length) {
      frag.append(el('div', { class: 'empty-note', text: 'Aqui no hay subcarpetas visibles.' }));
    }
    for (const item of data.items) {
      frag.append(el('div', {
        class: 'file-row',
        title: item.path,
        onclick: () => { this.browsePath = item.path; this.render(); },
      }, [
        el('span', { class: 'file-row__icon', text: '▸' }),
        el('span', { class: 'file-row__name', text: item.name }),
        el('span', {
          class: 'file-row__size',
          text: [item.isRepo ? 'git' : null, item.hasMemory ? 'CLAUDE.md' : null].filter(Boolean).join(' · '),
        }),
        el('button', {
          class: 'ghost-btn',
          text: 'abrir',
          // El clic en la fila navega; el del boton cambia de proyecto.
          onclick: (event) => { event.stopPropagation(); this.switchProject(item.path); },
        }),
      ]));
    }
    return frag;
  }

  async switchProject(dir) {
    if (!confirm(`¿Trabajar en ${dir}?\n\nSe cierra la conversacion actual de Claude Code.`)) return;
    try {
      const result = await api.setProject(dir);
      if (result.changed === false) {
        this.notify('Ya estabas en esa carpeta');
        return;
      }
      // Los paneles que miraban el proyecto anterior quedan obsoletos.
      this.filesPath = '.';
      this.browsePath = dir;
      this.docsFilter = '';
      this.notify(`Proyecto: ${dir}`);
      await this.show('overview');
    } catch (err) {
      this.notify(err.message);
    }
  }

  /* ------------------------------------------------------------ memoria */

  async render_memory() {
    const { items } = await api.memory();
    const frag = document.createDocumentFragment();
    if (!items.length) {
      frag.append(el('div', { class: 'empty-note', text: 'No hay archivos de memoria. Crea un CLAUDE.md en la raiz del proyecto para darle contexto permanente a Claude Code.' }));
      frag.append(el('button', {
        class: 'primary-btn',
        text: 'Crear CLAUDE.md',
        onclick: async () => {
          await api.writeFile('CLAUDE.md', PLANTILLA_CLAUDE_MD);
          this.notify('CLAUDE.md creado');
          this.render();
        },
      }));
      return frag;
    }
    for (const item of items) {
      frag.append(this.card({
        title: item.relative,
        desc: `${item.lines} lineas · ${formatBytes(item.bytes)} · ${timeAgo(item.modified)}`,
        tags: [item.scope, ...(item.imports || []).slice(0, 3)],
        onClick: () => this.openFileEditor(item.relative, item.path),
      }));
    }
    return frag;
  }

  /* ------------------------------------------------------------- skills */

  async render_skills() {
    const { items } = await api.skills();
    const frag = document.createDocumentFragment();
    const search = el('input', { class: 'search-input', placeholder: 'filtrar skills…', type: 'search' });
    const list = el('div', {});
    const paint = () => {
      const needle = search.value.toLowerCase();
      clear(list);
      const visible = items.filter((s) =>
        !needle || s.name.toLowerCase().includes(needle) || String(s.description).toLowerCase().includes(needle));
      if (!visible.length) {
        list.append(el('div', { class: 'empty-note', text: 'Sin skills que coincidan. Las skills viven en .claude/skills/<nombre>/SKILL.md' }));
        return;
      }
      for (const skill of visible) {
        list.append(this.card({
          title: skill.name,
          desc: skill.description,
          tags: [skill.origin, skill.model, skill.resources?.length ? `${skill.resources.length} recursos` : null],
          onClick: () => this.openSkill(skill),
        }));
      }
    };
    search.addEventListener('input', paint);
    frag.append(el('div', { class: 'toolbar' }, [search]));
    frag.append(list);
    paint();
    return frag;
  }

  async openSkill(skill) {
    const detail = await api.skill(skill.path);
    this.openViewer({
      title: detail.name,
      subtitle: detail.path,
      markdown: detail.content,
      actions: [
        el('button', { class: 'ghost-btn', text: 'usar en el chat', onclick: () => this.insertPrompt(`Usa la skill ${detail.name} para `) }),
      ],
      extra: detail.resources?.length
        ? el('div', { class: 'card__meta' }, detail.resources.map((r) => el('span', { class: 'tag', text: `${r.kind === 'dir' ? '▸' : '·'} ${r.name}` })))
        : null,
    });
  }

  /* ----------------------------------------------------------- comandos */

  async render_commands() {
    const { items, cli, alive } = await api.commands();
    const frag = document.createDocumentFragment();

    // Un comando con argumentos no se puede lanzar a ciegas: se pega en el
    // compositor para que escribas el resto. Los que no los piden se ejecutan.
    const launcher = (name, argumentHint) => (argumentHint
      ? el('button', {
          class: 'ghost-btn',
          text: 'insertar',
          title: `Necesita argumentos: ${argumentHint}`,
          onclick: (event) => { event.stopPropagation(); this.insertPrompt(`/${name} `); },
        })
      : el('button', {
          class: 'primary-btn',
          text: 'ejecutar',
          onclick: (event) => { event.stopPropagation(); this.runPrompt(`/${name}`); },
        }));

    frag.append(el('div', { class: 'section-title', text: 'Del proyecto' }));
    if (!items.length) {
      frag.append(el('div', { class: 'empty-note', text: 'Sin comandos propios. Crea .claude/commands/<nombre>.md para tener /nombre.' }));
    }
    for (const cmd of items) {
      const name = String(cmd.name).replace(/^\//, '');
      frag.append(el('div', { class: 'card' }, [
        el('div', { class: 'card__top' }, [
          el('h3', { class: 'card__title', text: `/${name}` }),
          launcher(name, cmd.argumentHint),
        ]),
        cmd.description ? el('p', { class: 'card__desc', text: cmd.description }) : null,
        el('div', { class: 'card__meta' }, [cmd.origin, cmd.argumentHint, cmd.model].filter(Boolean)
          .map((t) => el('span', { class: 'tag', text: t }))),
        el('button', {
          class: 'ghost-btn',
          text: 'ver definicion',
          onclick: () => this.openViewer({ title: `/${name}`, subtitle: cmd.path, markdown: cmd.content }),
        }),
      ]));
    }

    // El catalogo completo (comandos propios del CLI, de plugins y skills) solo
    // lo conoce el proceso, y llega con el handshake `initialize`.
    frag.append(el('div', { class: 'section-title', text: 'Del CLI de Claude Code' }));
    if (!cli?.length) {
      frag.append(el('div', { class: 'empty-note', text: alive
        ? 'El proceso no ha devuelto el catalogo de comandos.'
        : 'Arranca un turno para que Clawd Deck pida el catalogo de comandos al CLI.' }));
      return frag;
    }
    const search = el('input', { class: 'search-input', placeholder: 'filtrar comandos…', type: 'search' });
    const list = el('div', {});
    const paint = () => {
      const needle = search.value.toLowerCase();
      clear(list);
      const visible = cli.filter((c) => !needle
        || c.name.toLowerCase().includes(needle)
        || (c.description || '').toLowerCase().includes(needle));
      if (!visible.length) list.append(el('div', { class: 'empty-note', text: 'Ningun comando coincide.' }));
      for (const cmd of visible) {
        list.append(el('div', { class: 'card' }, [
          el('div', { class: 'card__top' }, [
            el('h3', { class: 'card__title', text: `/${cmd.name}` }),
            launcher(cmd.name, cmd.argumentHint),
          ]),
          cmd.description ? el('p', { class: 'card__desc', text: cmd.description }) : null,
          cmd.argumentHint ? el('div', { class: 'card__meta' }, [el('span', { class: 'tag', text: cmd.argumentHint })]) : null,
        ]));
      }
    };
    search.addEventListener('input', paint);
    frag.append(search, list);
    paint();
    return frag;
  }

  /* ------------------------------------------------------------ agentes */

  async render_agents() {
    const { items } = await api.agents();
    const frag = document.createDocumentFragment();
    if (!items.length) {
      frag.append(el('div', { class: 'empty-note', text: 'Sin subagentes definidos. Crea .claude/agents/<nombre>.md para tener agentes especializados.' }));
      return frag;
    }
    for (const agent of items) {
      frag.append(this.card({
        title: agent.name,
        desc: agent.description,
        tags: [agent.origin, agent.model, Array.isArray(agent.tools) ? `${agent.tools.length} tools` : agent.tools],
        onClick: () => this.openViewer({ title: agent.name, subtitle: agent.path, markdown: agent.content }),
      }));
    }
    return frag;
  }

  /* -------------------------------------------------- configuracion/MCP */

  async render_config() {
    const data = await api.configFiles();
    const frag = document.createDocumentFragment();

    frag.append(el('div', { class: 'section-title', text: 'Servidores MCP' }));
    if (data.mcpServers.length) {
      for (const server of data.mcpServers) {
        frag.append(this.card({
          title: server.name,
          desc: server.command || '—',
          tags: [server.scope, server.transport],
        }));
      }
    } else {
      frag.append(el('div', { class: 'empty-note', text: 'Sin servidores MCP configurados (.mcp.json).' }));
    }

    frag.append(el('div', { class: 'section-title', text: 'Hooks' }));
    if (data.hooks.length) {
      for (const hook of data.hooks) {
        frag.append(this.card({
          title: `${hook.event} · ${hook.matcher}`,
          desc: hook.command,
          tags: [hook.scope, hook.type],
        }));
      }
    } else {
      frag.append(el('div', { class: 'empty-note', text: 'Sin hooks configurados.' }));
    }

    frag.append(el('div', { class: 'section-title', text: 'settings.json' }));
    if (!data.settings.length) {
      frag.append(el('div', { class: 'empty-note', text: 'Sin archivos de settings.' }));
    }
    for (const entry of data.settings) {
      frag.append(el('div', { class: 'card' }, [
        el('div', { class: 'card__top' }, [
          el('h3', { class: 'card__title', text: entry.scope }),
          el('span', { class: 'tag', text: formatBytes(JSON.stringify(entry.data).length) }),
        ]),
        el('p', { class: 'card__desc mono', text: entry.path }),
        el('pre', { class: 'mono', style: 'max-height:240px;overflow:auto;font-size:11px', text: JSON.stringify(entry.data, null, 2) }),
      ]));
    }
    return frag;
  }

  /* ----------------------------------------------------------- archivos */

  async render_files() {
    const data = await api.tree(this.filesPath);
    const frag = document.createDocumentFragment();
    const crumbs = el('div', { class: 'breadcrumb' });
    const parts = data.dir === '.' ? [] : data.dir.split('/');
    crumbs.append(el('button', { text: '⌂', onclick: () => { this.filesPath = '.'; this.render(); } }));
    parts.forEach((part, index) => {
      crumbs.append(document.createTextNode(' / '));
      crumbs.append(el('button', {
        text: part,
        onclick: () => { this.filesPath = parts.slice(0, index + 1).join('/'); this.render(); },
      }));
    });
    frag.append(crumbs);

    if (!data.items.length) frag.append(el('div', { class: 'empty-note', text: 'Carpeta vacia.' }));
    for (const item of data.items) {
      frag.append(el('div', {
        class: 'file-row',
        onclick: () => {
          if (item.kind === 'dir') { this.filesPath = item.relative; this.render(); }
          else this.openFileEditor(item.relative, item.relative);
        },
      }, [
        el('span', { class: 'file-row__icon', text: item.kind === 'dir' ? '▸' : '·' }),
        el('span', { class: 'file-row__name', text: item.name }),
        el('span', { class: 'file-row__size', text: item.kind === 'dir' ? '' : formatBytes(item.bytes) }),
      ]));
    }
    return frag;
  }

  /* ----------------------------------------------------------- sesiones */

  async render_sessions() {
    const { items } = await api.sessions();
    const frag = document.createDocumentFragment();
    frag.append(el('div', { class: 'empty-note', text: 'Transcripciones que Claude Code guarda para este proyecto en ~/.claude/projects.' }));
    if (!items.length) {
      frag.append(el('div', { class: 'empty-note', text: 'Todavia no hay sesiones guardadas.' }));
      return frag;
    }
    for (const session of items) {
      frag.append(this.card({
        title: session.firstPrompt || session.id,
        desc: `${session.messages} eventos · ${formatBytes(session.bytes)} · ${timeAgo(session.modified)}`,
        tags: [session.id.slice(0, 8)],
        onClick: () => this.insertPrompt(`Retoma lo que hicimos en la sesion ${session.id}: `),
      }));
    }
    return frag;
  }

  /* ------------------------------------------------------- documentacion */

  async render_docs() {
    const { items, root } = await api.docs();
    const frag = document.createDocumentFragment();

    const search = el('input', { class: 'search-input', type: 'search', placeholder: 'buscar en la documentacion…', value: this.docsFilter });
    const newBtn = el('button', {
      class: 'primary-btn',
      text: '+ nota',
      onclick: () => this.openDocEditor(null),
    });
    frag.append(el('div', { class: 'toolbar' }, [search, newBtn]));
    frag.append(el('div', { class: 'breadcrumb', text: root }));

    const list = el('div', {});
    const paint = (docs) => {
      clear(list);
      if (!docs.length) {
        list.append(el('div', { class: 'empty-note', text: 'Sin documentos todavia. Crea el primero con “+ nota”.' }));
        return;
      }
      const groups = new Map();
      for (const doc of docs) {
        const key = doc.category || 'general';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(doc);
      }
      for (const [category, docs2] of groups) {
        list.append(el('div', { class: 'section-title', text: category }));
        for (const doc of docs2) {
          list.append(this.card({
            title: (doc.pinned ? '★ ' : '') + doc.title,
            desc: doc.excerpt || doc.summary,
            tags: [...(doc.tags || []).slice(0, 4), `${doc.words} palabras`, timeAgo(doc.updated)],
            onClick: () => this.openDoc(doc.slug),
          }));
        }
      }
    };

    let timer = null;
    search.addEventListener('input', () => {
      this.docsFilter = search.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const value = search.value.trim();
        paint(value ? (await api.docsSearch(value)).items : (await api.docs()).items);
      }, 180);
    });

    frag.append(list);
    paint(this.docsFilter ? (await api.docsSearch(this.docsFilter)).items : items);
    return frag;
  }

  async openDoc(slug) {
    const doc = await api.doc(slug);
    this.openViewer({
      title: doc.title,
      subtitle: `${slug} · ${timeAgo(doc.updated)}`,
      markdown: doc.body,
      actions: [
        el('button', { class: 'primary-btn', text: 'editar', onclick: () => this.openDocEditor(doc) }),
        el('button', { class: 'ghost-btn', text: 'al chat', onclick: () => this.insertPrompt(`Segun la nota "${doc.title}" de la boveda de documentacion, `) }),
        el('button', {
          class: 'ghost-btn', text: 'borrar',
          onclick: async () => {
            if (!confirm(`¿Borrar "${doc.title}"?`)) return;
            await api.docDelete(slug);
            this.notify('Documento borrado');
            this.show('docs');
          },
        }),
      ],
    });
  }

  openDocEditor(doc) {
    const host = clear(this.container);
    const title = el('input', { class: 'text-input', placeholder: 'titulo', value: doc?.title || '' });
    const tags = el('input', { class: 'text-input', placeholder: 'etiquetas separadas por coma', value: (doc?.tags || []).join(', ') });
    const category = el('input', { class: 'text-input', placeholder: 'categoria', value: doc?.category || '' });
    const body = el('textarea', { class: 'editor', spellcheck: 'false' });
    body.value = doc?.body || '# Nueva nota\n\n';
    const state = el('span', { class: 'save-state' });

    const save = async () => {
      state.className = 'save-state';
      state.textContent = 'guardando…';
      try {
        const payload = {
          title: title.value.trim() || 'Nota sin titulo',
          tags: tags.value,
          category: category.value.trim(),
          body: body.value,
        };
        const saved = doc?.slug
          ? await api.docSave({ slug: doc.slug, ...payload })
          : await api.docCreate(payload);
        state.className = 'save-state is-ok';
        state.textContent = `guardado en ${saved.slug}`;
        this.notify('Documento guardado');
        setTimeout(() => this.openDoc(saved.slug), 500);
      } catch (err) {
        state.className = 'save-state is-err';
        state.textContent = err.message;
      }
    };

    host.append(el('div', { class: 'viewer' }, [
      el('div', { class: 'viewer__actions' }, [
        el('button', { class: 'ghost-btn', text: '← volver', onclick: () => this.show('docs') }),
        el('button', { class: 'primary-btn', text: 'guardar', onclick: save }),
        state,
      ]),
      title, category, tags, body,
    ]));
    title.focus();
  }

  /* ------------------------------------------------- visor / editor file */

  async openFileEditor(label, relativePath) {
    const host = clear(this.container);
    host.append(el('div', { class: 'empty-note', text: 'cargando…' }));
    let file;
    try {
      file = await api.file(relativePath);
    } catch (err) {
      clear(host).append(el('div', { class: 'empty-note', text: err.message }));
      return;
    }
    if (file.binary || file.tooLarge) {
      clear(host).append(
        el('button', { class: 'ghost-btn', text: '← volver', onclick: () => this.render() }),
        el('div', { class: 'empty-note', text: file.binary ? 'Archivo binario, no se muestra.' : `Archivo demasiado grande (${formatBytes(file.bytes)}).` }),
      );
      return;
    }

    const isMarkdown = /\.(md|markdown)$/i.test(relativePath);
    const preview = el('div', { class: 'md' });
    const editor = el('textarea', { class: 'editor', spellcheck: 'false' });
    editor.value = file.content;
    preview.innerHTML = isMarkdown ? renderMarkdown(file.content) : `<pre class="mono">${escapeText(file.content)}</pre>`;
    let editing = false;
    preview.style.display = '';
    editor.style.display = 'none';

    const state = el('span', { class: 'save-state', text: `${formatBytes(file.bytes)} · ${timeAgo(file.modified)}` });
    const toggle = el('button', {
      class: 'ghost-btn', text: 'editar',
      onclick: () => {
        editing = !editing;
        toggle.textContent = editing ? 'ver' : 'editar';
        preview.style.display = editing ? 'none' : '';
        editor.style.display = editing ? '' : 'none';
        if (!editing) preview.innerHTML = isMarkdown ? renderMarkdown(editor.value) : `<pre class="mono">${escapeText(editor.value)}</pre>`;
      },
    });
    const save = el('button', {
      class: 'primary-btn', text: 'guardar',
      onclick: async () => {
        state.className = 'save-state';
        state.textContent = 'guardando…';
        try {
          const saved = await api.writeFile(relativePath, editor.value);
          state.className = 'save-state is-ok';
          state.textContent = `guardado · ${formatBytes(saved.bytes)}`;
          this.notify(`${label} guardado`);
        } catch (err) {
          state.className = 'save-state is-err';
          state.textContent = err.message;
        }
      },
    });

    clear(host).append(el('div', { class: 'viewer' }, [
      el('div', { class: 'viewer__actions' }, [
        el('button', { class: 'ghost-btn', text: '← volver', onclick: () => this.render() }),
        toggle, save, state,
      ]),
      el('div', { class: 'breadcrumb', text: relativePath }),
      preview, editor,
    ]));
  }

  openViewer({ title, subtitle, markdown, actions = [], extra = null }) {
    const host = clear(this.container);
    host.append(el('div', { class: 'viewer' }, [
      el('div', { class: 'viewer__actions' }, [
        el('button', { class: 'ghost-btn', text: '← volver', onclick: () => this.render() }),
        ...actions,
      ]),
      el('h3', { class: 'card__title', text: title }),
      subtitle ? el('div', { class: 'breadcrumb', text: subtitle }) : null,
      extra,
      el('div', { class: 'md', html: renderMarkdown(markdown || '') }),
    ]));
  }

  card({ title, desc, tags = [], onClick }) {
    return el('div', { class: `card${onClick ? ' is-clickable' : ''}`, onclick: onClick }, [
      el('div', { class: 'card__top' }, [el('h3', { class: 'card__title', text: title })]),
      desc ? el('p', { class: 'card__desc', text: desc }) : null,
      tags.filter(Boolean).length
        ? el('div', { class: 'card__meta' }, tags.filter(Boolean).map((t) => el('span', { class: 'tag', text: String(t) })))
        : null,
    ]);
  }
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PLANTILLA_CLAUDE_MD = `# CLAUDE.md

Contexto que Claude Code lee en cada sesion de este proyecto.

## Que es esto

<describe el proyecto en dos lineas>

## Comandos utiles

- \`npm test\` — …
- \`npm run build\` — …

## Convenciones

- …
`;
