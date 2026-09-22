# Clawd Deck

Una capa web local sobre **Claude Code por terminal**: el mismo agente de
siempre, pero con Clawd animado segun lo que esta haciendo, y con las utilidades
del proyecto (CLAUDE.md, skills, comandos, agentes, MCP, hooks, sesiones) a un
clic — mas una boveda de documentacion para guardar lo que vas aprendiendo del
propio Claude Code.

No sustituye a la terminal: la envuelve. Por debajo corre
`claude -p --input-format stream-json --output-format stream-json`, asi que todo
lo que funciona en tu terminal funciona aqui.

```
┌───────────────┬───────────────────────────────┬──────────────────┐
│   Clawd       │   conversacion                │   utilidades     │
│   animado     │   mensajes, herramientas,     │   CLAUDE.md      │
│   + metricas  │   permisos y resumen de turno │   skills         │
│   + navegacion│                               │   documentacion  │
└───────────────┴───────────────────────────────┴──────────────────┘
```

## Arranque

```bash
git clone https://github.com/RenatoEspina/Interfaz-claude
cd Interfaz-claude
node bin/clawd.js --cwd /ruta/a/tu/proyecto --open
```

No hay `npm install`: cero dependencias. Solo hacen falta **Node 20+** y el CLI
`claude` en el PATH.

La terminal imprime una URL con token, del estilo
`http://127.0.0.1:4317/?token=…`. Abrela y ya esta.

### Opciones

| Bandera | Por defecto | Para que |
| --- | --- | --- |
| `--port <n>` | `4317` | Puerto HTTP. |
| `--host <h>` | `127.0.0.1` | Interfaz de escucha. |
| `--cwd <ruta>` | directorio actual | Proyecto sobre el que trabaja Claude. Tambien se cambia desde la web. |
| `--add-dir <ruta>` | — | Carpeta extra accesible para las herramientas (repetible). Sin esto el CLI confina todo al proyecto. |
| `--docs <ruta>` | `<cwd>/docs` | Carpeta de la boveda de documentacion. |
| `--model <id>` | el de tu configuracion | `opus`, `sonnet`, `haiku`, `claude-opus-5`… |
| `--permission-mode <m>` | `acceptEdits` | `manual`, `auto`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions`. |
| `--effort <nivel>` | — | `low`, `medium`, `high`, `xhigh`, `max`. |
| `--claude-bin <ruta>` | `claude` | Otro binario de Claude Code. |
| `--read-only` | off | La interfaz no puede escribir archivos del proyecto. |
| `--no-token` | off | Sin token. Solo en entornos aislados. |
| `--autostart` | off | Levanta el proceso de Claude Code al arrancar. |
| `--open` | off | Intenta abrir el navegador. |

Tambien valen las variables `CLAWD_DECK_PORT`, `CLAWD_DECK_HOST`,
`CLAWD_DECK_MODEL`, `CLAWD_DECK_PERMISSION_MODE`, `CLAWD_DECK_TOKEN` y
`CLAWD_DECK_CLAUDE_BIN`.

## Que trae

**Clawd animado.** El sprite pixelado de la terminal, con trece escenas
distintas: lee un libro cuando usa `Read`, teclea con las dos pinzas cuando
corre `Bash`, barre con una lupa cuando hace `Grep`, gira un globo cuando sale a
la red, se inclina con un signo de interrogacion cuando necesita permiso, salta
entre destellos al terminar y se pone rojo con los ojos en cruz si algo falla.

**Conversacion completa.** Texto en streaming token a token, bloques de
pensamiento, tarjetas por herramienta que se despliegan para ver entrada y
resultado, y un resumen por turno con duracion, pasos, coste y tokens.

**Utilidades del proyecto**, en el panel derecho:

- *Resumen* — estado de git, cuentas de skills/comandos/agentes/MCP y atajos.
- *Proyecto* — cambia en caliente la carpeta sobre la que trabaja Claude, sin
  reiniciar el servidor. Tambien se abre pulsando la ruta en la cabecera del
  chat. Se navega por tu home y por la carpeta de arranque; al cambiar se cierra
  la conversacion anterior (su `session_id` pertenece al proyecto viejo) y los
  demas paneles pasan a mirar el proyecto nuevo.
- *CLAUDE.md* — todos los archivos de memoria detectados, con editor.
- *Skills* — las del proyecto, las tuyas y las de plugins, con su SKILL.md.
- *Comandos* — los `/comando` de `.claude/commands` y el catalogo completo que
  reporta el CLI (los suyos, los de plugins y las skills). Los que no piden
  argumentos se ejecutan con un boton; los que si, se insertan en el compositor.
- *Agentes* — los subagentes de `.claude/agents`.
- *Config & MCP* — servidores MCP, hooks y los `settings.json` que aplican.
- *Archivos* — navegador del proyecto con visor y editor.
- *Sesiones* — transcripciones anteriores guardadas por Claude Code.
- *Documentacion* — la boveda: crear, buscar y editar notas en markdown.

**Boveda de documentacion.** `docs/` es una carpeta de markdown normal, versionada
con el repo, que el panel lista, busca y edita. Viene sembrada con documentacion
del propio Claude Code por terminal: [banderas del CLI](docs/claude-code/cli-banderas.md),
[modo stream-json](docs/claude-code/modo-stream-json.md),
[personalizacion](docs/claude-code/personalizacion.md) y
[permisos y sesiones](docs/claude-code/permisos-y-sesiones.md).

## Atajos

| Tecla | Accion |
| --- | --- |
| `Enter` | Enviar |
| `Shift+Enter` | Salto de linea |
| `Esc` | Interrumpir el turno en curso |
| `/` | Saltar al compositor |

## Seguridad

Esto lanza un agente capaz de ejecutar comandos en tu maquina. El panel escucha
solo en `127.0.0.1`, exige un token y rechaza rutas fuera del proyecto, pero la
barrera de verdad es el **modo de permisos**. No lo expongas fuera de tu equipo
y usa `bypassPermissions` unicamente en entornos desechables.

## Estructura

```
bin/clawd.js            arranque y banderas
src/server.js           HTTP, API JSON y canal SSE
src/claude-session.js   proceso de Claude Code y traduccion del stream
src/activity.js         herramienta -> estado de la mascota
src/project.js          descubrimiento de CLAUDE.md, skills, comandos, MCP, git
src/docs.js             boveda de documentacion
web/                    interfaz sin framework (HTML, CSS, modulos ES)
docs/                   la boveda
```

Los detalles de por dentro estan en
[docs/clawd-deck/arquitectura.md](docs/clawd-deck/arquitectura.md) y el catalogo
de animaciones en [docs/clawd-deck/estados-de-clawd.md](docs/clawd-deck/estados-de-clawd.md).

## Licencia

MIT.
