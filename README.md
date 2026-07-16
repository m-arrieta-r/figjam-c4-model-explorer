# Extract C4 from FigJam

Plugin de FigJam que extrae relaciones (conectores) entre shapes en el
lienzo y las muestra en un panel navegable, con exportación a **Mermaid C4**
o **LikeC4 DSL**.

## Qué hace

- Recorre la página actual de FigJam buscando **conectores** y resuelve el
  shape de cada extremo (origen/destino).
- Extrae de cada shape su **nombre**, **tipo de elemento C4** (Person,
  Container, Software System, etc.), **tecnología** y **descripción**, a
  partir de los textos del shape (soporta varios formatos de plantilla, ver
  más abajo).
- Muestra todo en un panel con tres pestañas:
  - **Relations**: lista de conectores con origen → etiqueta → destino. Al
    hacer clic en una relación se abre un panel con el detalle (Start/End)
    de esa relación justo debajo. Cada extremo y el conector tienen su
    propio ícono para saltar a ese elemento en el lienzo.
  - **Containers**: lista de todos los shapes resueltos, con su tipo,
    tecnología y descripción. Al hacer clic en un container se abre un panel
    con **todas sus relaciones de salida (Outgoing) y de entrada (Incoming)**;
    cada fila permite saltar al conector en el lienzo o abrir esa relación en
    la pestaña Relations.
  - **Export**: genera el diagrama en formato Mermaid C4 o LikeC4 DSL
    (toggle), con botón de copiar al portapapeles.
- Buscador que filtra por nombre, descripción, tecnología o tipo, en ambas
  pestañas (Relations y Containers).
- Con el plugin abierto, **seleccionar un shape en el lienzo** abre
  automáticamente ese container en la pestaña Containers con sus relaciones
  de entrada y salida.
- Seleccionar un conector en el lienzo y usar el botón **"View C4 relation"**
  (aparece en el panel de propiedades de Figma) abre el plugin directo en el
  detalle de esa relación. Igual con un shape y el botón
  **"View C4 container"**, que abre el plugin directo en las relaciones de
  ese container.

## Requisitos

- Figma Desktop (para importar el plugin en modo desarrollo).
- Node.js + npm.

## Instalación y build

```bash
npm install
npm run build
```

Esto genera `dist/code.js` a partir de `src/code.ts` y `dist/ui.html` a
partir de los archivos en `src/ui/` (HTML/CSS/JS separados en varios
archivos). Figma carga `dist/ui.html` directamente; ambos pasos de build son
necesarios porque Figma solo admite un único archivo de UI.

## Cargar el plugin en Figma

1. Abre Figma Desktop, ve a **Plugins → Development → Import plugin from
   manifest…**
2. Selecciona el `manifest.json` de este repo.
3. Abre un archivo de FigJam y corre el plugin desde **Plugins →
   Development → Extract C4 from FigJam**.

Si editas `src/code.ts` o cualquier archivo bajo `src/ui/`, corre
`npm run build` y vuelve a abrir el plugin (ciérralo y ábrelo de nuevo) para
que tome los archivos nuevos en `dist/`.

## Cómo estructurar los shapes en FigJam para mejores resultados

El plugin intenta extraer nombre / tipo / tecnología / descripción de varias
formas, de la más a la menos confiable:

1. **Shape con texto simple** (sticky, texto plano, shape-with-text): usa el
   texto directamente como nombre.
2. **Capas de texto nombradas semánticamente**: si dentro del shape hay
   capas de texto llamadas `Título`, `Tecnología` y `Descripción` (o sus
   equivalentes en inglés: `Title`, `Technology`/`Subtitle`, `Description`),
   se usan directamente sin importar en qué frame estén anidadas.
3. **Fallback posicional**: si no hay capas nombradas así, el plugin busca
   la anotación entre corchetes (`[Person]`, `[Container: Oracle APEX]`,
   etc.) donde sea que esté, y asume que el primer texto restante es el
   nombre y el resto es la descripción. Funciona con la mayoría de
   plantillas C4 típicas de FigJam sin configuración adicional.
4. Si no encuentra ningún texto, usa el nombre de la capa de Figma como
   último recurso, y lo marca con un ⚠ en el panel (señal de que conviene
   revisar ese shape).

La tecnología dentro de los corchetes puede incluir el tipo y la tecnología
separados por `:`, por ejemplo `[Container: Oracle APEX]` → tipo
`Container`, tecnología `Oracle APEX`. Sin `:` (`[Person]`,
`[Software System]`) se usa solo como tipo.

Si un shape no se está extrayendo como esperas, haz clic en su ícono de
"ir al elemento" (🎯) en el panel y revisa la consola del plugin (**Plugins
→ Development → Open Console**): imprime el árbol completo del nodo en
JSON, útil para reportar o depurar el caso.

## Scripts

```bash
npm run build        # compila src/code.ts -> dist/code.js y arma src/ui/* -> dist/ui.html
npm run build:code    # solo el paso de esbuild
npm run build:ui      # solo el paso que arma dist/ui.html
npm run watch         # ambos anteriores, en modo watch
npm run typecheck     # chequeo de tipos (tsc --noEmit)
```
