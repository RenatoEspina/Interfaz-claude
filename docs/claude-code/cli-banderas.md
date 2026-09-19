---
title: Banderas del CLI de Claude Code
updated: 2026-09-19
category: claude-code
tags: [cli, flags, terminal]
---

# Banderas del CLI de Claude Code

Referencia de trabajo de las opciones de `claude`. Sale de `claude --help` de la
version instalada en esta maquina; si actualizas el CLI, vuelve a correrlo para
contrastar.

```bash
claude --version   # version instalada
claude --help      # lista completa y siempre actual
```

## Ejecucion

| Bandera | Que hace |
| --- | --- |
| `claude` | Sesion interactiva en la terminal. |
| `-p`, `--print` | Modo no interactivo: responde y termina. Base de todo uso programatico. |
| `-c`, `--continue` | Continua la conversacion mas reciente de este directorio. |
| `-r`, `--resume [id]` | Reanuda una sesion por id, o abre el selector. |
| `--fork-session` | Al reanudar, crea un id nuevo en vez de reutilizar el original. |
| `--session-id <uuid>` | Fuerza un id de sesion concreto. |
| `--bg`, `--background` | Arranca en segundo plano y devuelve el id. |

## Formato de entrada y salida

| Bandera | Que hace |
| --- | --- |
| `--output-format text\|json\|stream-json` | Formato de salida (solo con `-p`). |
| `--input-format text\|stream-json` | Entrada de texto o streaming JSON (solo con `-p`). |
| `--verbose` | Necesario para que `stream-json` emita todos los eventos. |
| `--include-partial-messages` | Emite los deltas token a token. |
| `--replay-user-messages` | Reemite por stdout los mensajes de usuario recibidos por stdin. |
| `--include-hook-events` | Añade los eventos de hooks al stream. |
| `--forward-subagent-text` | Reenvia el texto de los subagentes con `parent_tool_use_id`. |

## Modelo y esfuerzo

| Bandera | Que hace |
| --- | --- |
| `--model <id>` | `opus`, `sonnet`, `haiku` o un id completo como `claude-opus-5`. |
| `--fallback-model <lista>` | Modelos de reserva si el principal esta saturado. |
| `--effort low\|medium\|high\|xhigh\|max` | Nivel de esfuerzo del turno. |
| `--max-budget-usd <n>` | Techo de gasto para la ejecucion (solo con `-p`). |

## Permisos y herramientas

| Bandera | Que hace |
| --- | --- |
| `--permission-mode <modo>` | `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. |
| `--permission-prompts host\|none` | Quien responde los prompts en modo `-p`. `none` deniega solo. |
| `--allowedTools` / `--disallowedTools` | Listas de herramientas permitidas o vetadas, p. ej. `"Bash(git *)" Edit`. |
| `--dangerously-skip-permissions` | Salta todas las comprobaciones. Solo en entornos aislados. |
| `--restricted` | Quita las herramientas que ejecutan codigo y confina las de archivos. |

## Contexto y configuracion

| Bandera | Que hace |
| --- | --- |
| `--add-dir <dirs>` | Directorios extra a los que dar acceso. |
| `--mcp-config <json...>` | Carga servidores MCP desde archivos o cadenas JSON. |
| `--settings <ruta>` | Usa un settings.json concreto. |
| `--setting-sources user,project,local` | Que fuentes de configuracion cargar. |
| `--agents <json>` | Define subagentes al vuelo. |
| `--append-system-prompt <texto>` | Añade texto al system prompt por defecto. |
| `--safe-mode` | Arranca sin personalizaciones (util para depurar configuracion rota). |
| `--bare` | Modo minimo: sin hooks, LSP, plugins ni descubrimiento de CLAUDE.md. |

## Recetas utiles

```bash
# Una pregunta rapida, respuesta en texto plano
claude -p "resume los cambios de esta rama"

# Salida estructurada para un script
claude -p "lista los TODO del repo" --output-format json

# Streaming de eventos (lo que consume Clawd Deck)
claude -p --input-format stream-json --output-format stream-json --verbose

# Revisar sin permitir escrituras
claude -p "revisa este diff" --permission-mode plan
```
