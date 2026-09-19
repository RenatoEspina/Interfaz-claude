---
title: Arquitectura de Clawd Deck
updated: 2026-09-19
category: clawd-deck
tags: [arquitectura, servidor, sse]
---

# Arquitectura de Clawd Deck

Cero dependencias: solo Node y el navegador. Nada que instalar mas alla del
propio Claude Code.

```
bin/clawd.js          arranque, banderas, apagado limpio
src/server.js         servidor HTTP, API JSON y canal SSE
src/claude-session.js el proceso de Claude Code y la traduccion de su stream
src/activity.js       herramienta -> estado de Clawd
src/project.js        descubre CLAUDE.md, skills, comandos, agentes, MCP, git
src/docs.js           la boveda de documentacion
web/                  la interfaz (HTML, CSS y modulos ES, sin framework)
docs/                 esta boveda
```

## El flujo de un turno

1. El navegador hace `POST /api/message`.
2. `ClaudeSession` escribe una linea JSON en el stdin del proceso `claude`.
3. El CLI responde con eventos `stream-json` por stdout.
4. `handleEvent` los traduce a un protocolo propio mas simple.
5. Cada evento se difunde por SSE a todos los navegadores conectados.
6. El frontend pinta el mensaje **y** cambia el estado de la mascota.

```
navegador  --POST /api/message-->  servidor  --stdin-->   claude -p
navegador  <--SSE /api/events---   servidor  <--stdout--  claude -p
```

## Por que SSE y no WebSocket

El trafico interesante va en un solo sentido (servidor → navegador) y SSE se
implementa con el `http` de Node sin librerias, se reconecta solo y atraviesa
proxys sin ceremonia. Lo poco que va en sentido contrario cabe en un POST.

## Protocolo interno hacia el navegador

| Evento | Significado |
| --- | --- |
| `hello` | Estado completo al conectar, seguido del historial. |
| `state` | Cambio de estado de Clawd (`state`, `label`, `detail`, `busy`). |
| `session` | Datos del `system/init`: modelo, herramientas, comandos, MCP. |
| `delta` / `block` | Texto en streaming y luego el bloque definitivo. |
| `tool` / `tool_result` | Tarjeta de herramienta y su cierre con duracion. |
| `turn_end` | Resumen del turno: duracion, pasos, coste, tokens. |
| `permission` | Una herramienta pide permiso; espera respuesta. |
| `notice` / `log` | Avisos del panel y stderr del CLI. |

El servidor guarda los ultimos 800 eventos, asi que al recargar la pagina la
conversacion vuelve a aparecer.

## Seguridad

- Escucha en `127.0.0.1` salvo que se indique otra cosa.
- Token obligatorio (cabecera `x-clawd-token`), impreso en la URL de arranque.
  `--no-token` lo desactiva, solo para entornos aislados.
- Las rutas de archivo se resuelven siempre dentro del proyecto; cualquier
  intento de salir con `..` se rechaza con un 400.
- `--read-only` prohibe escribir archivos del proyecto desde la interfaz.

Aun asi, el panel lanza un agente que puede ejecutar comandos: **el modo de
permisos que elijas es la verdadera barrera**. No lo publiques en una interfaz
accesible desde fuera de tu maquina.
