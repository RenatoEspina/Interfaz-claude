---
title: Personalizar Claude Code
updated: 2026-09-19
category: claude-code
tags: [claude-md, skills, comandos, agentes, hooks, mcp]
---

# Personalizar Claude Code

Todo lo que Claude Code carga de un proyecto son archivos en el repo o en
`~/.claude`. El panel los lista en las pestañas *CLAUDE.md*, *Skills*,
*Comandos*, *Agentes* y *Config & MCP*.

## CLAUDE.md — la memoria del proyecto

```
CLAUDE.md               # del proyecto, se comparte por git
CLAUDE.local.md         # notas locales, no se comparten
.claude/CLAUDE.md       # variante dentro de la carpeta de configuracion
~/.claude/CLAUDE.md     # memoria personal, vale para todos tus proyectos
```

Se lee en cada sesion, asi que conviene que sea corto y operativo: que es el
proyecto, como se construye y se prueba, y las convenciones que no se deducen
del codigo. Con `@ruta/archivo.md` se importan otros archivos.

`/init` genera un primer CLAUDE.md leyendo el repositorio.

## Skills — capacidades reutilizables

```
.claude/skills/<nombre>/SKILL.md      # del proyecto
~/.claude/skills/<nombre>/SKILL.md    # personales
```

```markdown
---
name: revisar-pr
description: Revisa un pull request contra la guia de estilo del equipo. Usar cuando pidan revisar cambios.
---

# Revisar PR

1. Lee el diff completo.
2. Compara con docs/estilo.md.
3. Devuelve los hallazgos ordenados por gravedad.
```

La `description` es lo que decide **cuando** se activa la skill: describe el
disparador, no solo el contenido. La carpeta puede llevar scripts y plantillas
al lado del `SKILL.md`.

## Comandos — atajos con barra

```
.claude/commands/<nombre>.md   ->   /nombre
~/.claude/commands/<nombre>.md ->   /nombre
```

Las subcarpetas generan espacios de nombres (`.claude/commands/git/pr.md` es
`/git:pr`). En el frontmatter caben `description`, `argument-hint`,
`allowed-tools` y `model`; en el cuerpo, `$ARGUMENTS` recibe lo que se escriba
despues del comando.

## Subagentes

```
.claude/agents/<nombre>.md
```

```markdown
---
name: revisor
description: Revisa codigo en busca de errores de correctitud.
tools: Read, Grep, Glob
model: sonnet
---

Eres un revisor meticuloso. No modificas archivos.
```

## Hooks

Van en `settings.json` y los ejecuta el propio harness, no el modelo. Sirven
para lo que debe pasar *siempre*: formatear tras escribir, correr tests al
terminar, avisar al empezar.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npm run format" }]
      }
    ]
  }
}
```

## MCP

```json
// .mcp.json en la raiz del proyecto
{
  "mcpServers": {
    "postgres": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"] }
  }
}
```

Sus herramientas aparecen con el prefijo `mcp__<servidor>__<herramienta>`.

## Orden de precedencia

Lo mas cercano al proyecto manda: `local` sobre `proyecto`, y `proyecto` sobre
`usuario`. Cuando algo no se comporta como esperas, `--safe-mode` arranca sin
ninguna personalizacion y ayuda a aislar el culpable.
