---
title: Indice de la boveda
updated: 2026-09-19
category: general
pinned: true
tags: [indice, guia]
---

# Indice de la boveda

Esta carpeta es la **boveda de documentacion** de Clawd Deck. Todo lo que hay aqui
se lee, se busca y se edita desde la pestaña *Documentacion* del panel, y son
archivos markdown normales: viven en git y se pueden abrir con cualquier editor.

## Claude Code (la terminal)

- [Banderas del CLI](claude-code/cli-banderas.md) — que acepta `claude` y para que sirve cada opcion.
- [Modo stream-json](claude-code/modo-stream-json.md) — el protocolo headless que usa este panel.
- [Personalizacion](claude-code/personalizacion.md) — CLAUDE.md, skills, comandos, agentes, hooks y MCP.
- [Permisos y sesiones](claude-code/permisos-y-sesiones.md) — modos de permiso, reanudar conversaciones, donde viven las transcripciones.

## Clawd Deck (este panel)

- [Arquitectura](clawd-deck/arquitectura.md) — como esta hecho por dentro.
- [Estados de Clawd](clawd-deck/estados-de-clawd.md) — que animacion corresponde a cada herramienta.

## Como usar esta boveda

1. Abre la pestaña **Documentacion** en la barra izquierda.
2. `+ nota` crea un documento nuevo; el titulo define el nombre del archivo.
3. El buscador mira titulo, etiquetas y cuerpo de todos los documentos.
4. El boton *al chat* pega una referencia a la nota en el compositor, para que
   Claude Code trabaje con ese contexto.

> Consejo: pidele a Clawd al final de una sesion larga
> *"resume lo que hicimos en markdown para guardarlo en la boveda"* y pega el
> resultado en una nota nueva.
