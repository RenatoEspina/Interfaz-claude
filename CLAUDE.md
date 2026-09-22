# CLAUDE.md

Contexto de Clawd Deck: una capa web local sobre Claude Code por terminal.

## Que es

Un servidor Node sin dependencias que envuelve al CLI `claude` en modo
`stream-json`, traduce sus eventos a un protocolo propio y los difunde por SSE a
una interfaz web. La interfaz muestra la conversacion, anima una mascota pixel
segun la herramienta en uso y expone las utilidades del proyecto (CLAUDE.md,
skills, comandos, agentes, MCP, hooks, sesiones) mas una boveda de documentacion
en `docs/`.

## Reglas del proyecto

- **Cero dependencias.** Ni en el servidor ni en el navegador. Si algo parece
  necesitar una libreria, se escribe a mano y pequeño (asi estan el renderizador
  markdown y el parser de frontmatter).
- **Modulos ES** en todo el codigo (`"type": "module"`).
- El frontend no usa framework: HTML + CSS + modulos ES con `web/js/dom.js` como
  unica ayuda.
- Comentarios y textos de interfaz en español, sin tildes en los identificadores.
- Los nombres de estado de la mascota son un contrato entre `src/activity.js`,
  `src/claude-session.js` y `web/css/clawd.css`: si añades uno, toca los tres.

## Comandos

```bash
node bin/clawd.js --cwd . --open     # arrancar el panel
npm run check                        # comprobacion de sintaxis
```

Para probar sin gastar tokens, se puede apuntar `--claude-bin` a un script que
hable `stream-json`; asi se desarrollo el panel.

## Mapa

| Archivo | Responsabilidad |
| --- | --- |
| `bin/clawd.js` | Banderas, arranque, apagado limpio. |
| `src/server.js` | Rutas HTTP, API JSON, canal SSE, token y estaticos. |
| `src/claude-session.js` | Proceso `claude`, parseo del stream, estado, permisos. |
| `src/activity.js` | Tabla herramienta → estado → texto de la mascota. |
| `src/project.js` | Descubrimiento de memoria, skills, comandos, agentes, MCP, git, sesiones. |
| `src/docs.js` | Boveda de documentacion (listar, leer, guardar, buscar). |
| `web/js/stream.js` | Pintado de la conversacion. |
| `web/js/panels.js` | Paneles laterales de utilidades. |
| `web/css/clawd.css` | Sprite y animaciones de Clawd. |

## Cuidado con

- `--permission-prompt-tool stdio` no es opcional: sin esa bandera el CLI no
  manda `can_use_tool`, deniega solo con `system:permission_denied` ("This
  command requires approval") y la bandeja de permisos nunca se abre. Es el
  contrato que convierte al panel en anfitrion de permisos.
- El confinamiento al `cwd` es distinto de los permisos: no se pregunta, se
  bloquea. Carpetas extra solo con `--add-dir`.
- El id de mensaje solo llega en `message_start`; sin memorizarlo, los deltas no
  casan con el bloque final y el texto se duplica (`streamMessageIds`).
- Las respuestas de la API que necesitan otro codigo de estado usan el envoltorio
  `reply(status, body)` de `src/server.js`; devolver `{status, body}` a secas
  choca con los payloads que ya traen un campo `body`.
- Toda ruta de archivo pasa por `safeJoin`, que rechaza salir del proyecto. La
  excepcion es el selector de proyecto (`/api/browse`, `POST /api/project`), que
  necesita justo lo contrario y valida con `resolveWithinRoots` contra el home y
  la carpeta de arranque. Si añades rutas que miren fuera del proyecto, usa esa
  y no relajes `safeJoin`.
- El proyecto abierto cambia en caliente, asi que `src/server.js` lo guarda en el
  objeto mutable `workspace` y cada peticion lee `workspace.cwd`. Un `cwd`
  capturado en una clausura se queda con el proyecto de arranque.
