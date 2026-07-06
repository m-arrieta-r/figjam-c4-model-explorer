// Assembles the plugin UI into a single dist/ui.html file. Figma loads the
// "ui" manifest entry as one iframe document with no ability to fetch
// sibling files, so the split-up sources under src/ui/ (styles.css,
// export-shared.js, export-mermaid.js, export-likec4.js, app.js) have to be
// inlined back into src/ui/index.html's <style>/<script> placeholders.
const fs = require("fs");
const path = require("path");

const uiDir = path.join(__dirname, "..", "src", "ui");
const outDir = path.join(__dirname, "..", "dist");
const outFile = path.join(outDir, "ui.html");

const JS_FILES = [
  "export-shared.js",
  "export-mermaid.js",
  "export-likec4.js",
  "app.js",
];

function read(name) {
  return fs.readFileSync(path.join(uiDir, name), "utf8");
}

function build() {
  const css = read("styles.css").trim();
  const js = JS_FILES.map(read).join("\n");
  const shell = read("index.html");

  const html = shell
    .replace("/*BUILD:INLINE_CSS*/", () => css)
    .replace("/*BUILD:INLINE_JS*/", () => js);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`[build-ui] wrote ${path.relative(process.cwd(), outFile)}`);
}

build();

if (process.argv.includes("--watch")) {
  fs.watch(uiDir, () => build());
  console.log(`[build-ui] watching ${path.relative(process.cwd(), uiDir)}`);
}
