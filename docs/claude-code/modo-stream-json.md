---
title: Modo stream-json
updated: 2026-09-19
category: claude-code
tags: [stream-json, headless, sdk, protocolo]
---

# Modo stream-json

Es la forma en que un programa conversa con Claude Code sin terminal interactiva,
y es exactamente lo que hace Clawd Deck por debajo.

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

- **stdin**: una linea JSON por mensaje del usuario.
- **stdout**: una linea JSON por evento del agente.
- El proceso se queda vivo entre turnos, asi que la conversacion no se reinicia.

## Entrada

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hola"}]}}
```

Para interrumpir el turno en curso (el equivalente a pulsar `Esc`):

```json
{"type":"control_request","request_id":"abc","request":{"subtype":"interrupt"}}
```

## Salida

| `type` | Cuando llega | Que trae |
| --- | --- | --- |
| `system` (`subtype: init`) | al arrancar | `session_id`, `cwd`, `model`, `tools`, `slash_commands`, `mcp_servers`, `permissionMode`. |
| `stream_event` | durante la respuesta | eventos crudos: `message_start`, `content_block_delta`, `message_stop`. |
| `assistant` | al cerrar cada mensaje | el mensaje completo con bloques `text`, `thinking` y `tool_use`. |
| `user` | tras ejecutar una herramienta | bloques `tool_result` con `tool_use_id` e `is_error`. |
| `result` | al terminar el turno | `duration_ms`, `num_turns`, `total_cost_usd`, `usage`, `is_error`. |

### Detalle que cuesta caro descubrir

El id del mensaje **solo viaja en `message_start`**. Los `content_block_delta`
traen `index` pero no el id, asi que para casar los deltas con el bloque final
del evento `assistant` hay que memorizar el id en `message_start` y componer la
clave `${message_id}:${index}`. Si no se hace, el texto aparece duplicado: una
vez en streaming y otra al llegar el mensaje completo.

Cuando hay subagentes (`--forward-subagent-text`), los eventos traen
`parent_tool_use_id`; conviene llevar un id de mensaje por cada "carril".

## Reanudar

`result` y `system/init` traen `session_id`. Guardandolo se puede relanzar el
proceso sin perder el hilo:

```bash
claude -p --resume "$SESSION_ID" --input-format stream-json --output-format stream-json --verbose
```

## Permisos en modo headless

Con `-p` los prompts de permiso no tienen a nadie delante. Opciones:

- `--permission-mode acceptEdits` — acepta ediciones de archivos sin preguntar.
- `--permission-mode plan` — solo planifica, no toca nada.
- `--permission-prompts none` — deniega automaticamente lo que preguntaria.
- Responder desde el programa anfitrion a los `control_request` de subtipo
  `can_use_tool` con un `control_response`. Clawd Deck implementa este puente:
  si llega la peticion, aparece una bandeja para permitir o denegar, y si nadie
  contesta en dos minutos se deniega sola.
