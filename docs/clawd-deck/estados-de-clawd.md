---
title: Estados de Clawd
updated: 2026-09-19
category: clawd-deck
tags: [mascota, animaciones, estados]
---

# Estados de Clawd

Clawd es el sprite pixelado de la terminal, dibujado en SVG y animado con CSS.
Cada herramienta que usa el agente enciende una escena distinta, asi que se ve
de un vistazo en que anda sin leer el chat.

| Estado | Se activa con | Que hace la mascota |
| --- | --- | --- |
| `idle` | nada en curso | Flota despacio, mueve los brazos y parpadea. |
| `booting` | arranque del proceso | Tiembla mientras aparece una terminal. |
| `thinking` | razonando, `TodoWrite`, `Skill` | Mira hacia arriba con burbujas de pensamiento. |
| `reading` | `Read`, `NotebookRead` | Sostiene un libro y baja la mirada mientras pasa las lineas. |
| `writing` | `Edit`, `Write`, `MultiEdit` | Golpea con un lapiz y van saliendo caracteres. |
| `searching` | `Grep`, `Glob`, busquedas | Barre la escena con una lupa. |
| `running` | `Bash` y derivados | Teclea con los dos brazos, patalea, cursor parpadeando. |
| `web` | `WebFetch`, `WebSearch`, MCP | Un globo gira a su lado. |
| `delegating` | `Agent`, `Task` | Tres mini-clawds se encienden por turnos. |
| `asking` | una herramienta pide permiso | Se inclina con un signo de interrogacion. |
| `done` | el turno termino bien | Da un salto entre destellos. |
| `error` | el turno fallo | Se pone rojo, los ojos son cruces y cae un rayo. |
| `stopped` | turno interrumpido | Gris, con los ojos a media asta. |

El halo del escenario y el color de la utileria cambian con el estado, de modo
que la barra lateral tiene un color distinto segun la fase.

## Como se decide el estado

`src/activity.js` mapea el nombre de la herramienta a un estado con una tabla de
expresiones regulares. Para añadir uno nuevo:

1. Añade la fila en `TOOL_STATES` y el texto en `STATE_COPY`.
2. Añade el bloque `[data-state="<nuevo>"]` en `web/css/clawd.css`.
3. Si necesita utileria propia, dibujala como `<g class="prop prop--<nuevo>">`
   dentro del SVG de `web/index.html`.

Las animaciones usan `steps()` a proposito: el movimiento a tirones es lo que
hace que el sprite se vea como pixel art y no como un dibujo suavizado. Con
`prefers-reduced-motion` se desactivan todas.
