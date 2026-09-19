---
title: Permisos y sesiones
updated: 2026-09-19
category: claude-code
tags: [permisos, sesiones, transcripciones]
---

# Permisos y sesiones

## Modos de permiso

| Modo | Comportamiento |
| --- | --- |
| `manual` / `default` | Pregunta antes de cada accion sensible. |
| `plan` | Investiga y propone, sin modificar nada. |
| `acceptEdits` | Acepta ediciones de archivos sin preguntar; el resto sigue preguntando. |
| `dontAsk` | No interrumpe con prompts. |
| `auto` | El harness decide segun el riesgo de cada accion. |
| `bypassPermissions` | Sin comprobaciones. Solo en entornos aislados y desechables. |

Se fija con `--permission-mode` al arrancar. En Clawd Deck esta en el selector
de la cabecera del chat; al cambiarlo se reinicia el proceso, porque es una
opcion de arranque.

Las reglas finas viven en `settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(git status)", "Bash(npm test)", "Read"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

## Sesiones

Cada conversacion tiene un `session_id` (un UUID). Con el se puede reanudar:

```bash
claude --resume <id>     # retoma esa conversacion
claude --continue        # retoma la mas reciente de este directorio
claude --resume <id> --fork-session   # parte de ahi pero con id nuevo
```

## Donde viven las transcripciones

```
~/.claude/projects/<ruta-del-proyecto-con-guiones>/<session-id>.jsonl
```

La ruta del proyecto se convierte en el nombre de carpeta cambiando `/` y `.`
por `-`. Cada linea del `.jsonl` es un evento de la conversacion. La pestaña
*Sesiones* del panel lee justamente esa carpeta y muestra el primer mensaje de
cada sesion para reconocerlas.

`--no-session-persistence` desactiva el guardado (solo con `-p`).

## Costes

El evento `result` trae `total_cost_usd` y `usage` por turno. Clawd Deck los
suma en la tarjeta *Coste* de la barra izquierda. `--max-budget-usd` corta la
ejecucion al llegar a un techo.
