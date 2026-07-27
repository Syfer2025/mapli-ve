/**
 * Gera o esqueleto dos pacotes do workspace a partir da matriz de dependências
 * definida em docs/02-MODULES.md.
 *
 * Idempotente: nunca sobrescreve src/ existente. Só cria o que falta.
 *
 *   node tools/scaffold.mjs
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** L0 → L5. A matriz completa inclui um DAG dirigido dentro de algumas camadas. */
const PACKAGES = [
  // ---- L0 · núcleo (sem dependências externas ao TS) ----
  { name: "core-math", layer: 0, deps: [] },
  { name: "core-utils", layer: 0, deps: [] },
  { name: "core-time", layer: 0, deps: ["core-utils"] },

  // ---- L1 · dados ----
  { name: "schema", layer: 1, deps: ["core-time", "core-utils"] },
  { name: "document", layer: 1, deps: ["schema", "core-time", "core-utils"] },

  // ---- L2 · domínio ----
  { name: "scene-graph", layer: 2, deps: ["document", "schema", "core-math", "core-utils"] },
  {
    name: "animation",
    layer: 2,
    deps: ["document", "schema", "core-math", "core-time", "core-utils"],
  },
  { name: "gis", layer: 2, deps: ["schema", "core-math", "core-utils"] },
  { name: "assets", layer: 2, deps: ["document", "schema", "core-utils"] },

  // ---- L3 · motores ----
  {
    // Único pacote que fala com a GPU: precisa de lib.dom para canvas e WebGL.
    // Sem isso aqui, rodar o scaffold apaga a configuração e o build quebra.
    name: "renderer",
    layer: 3,
    lib: ["ES2023", "DOM"],
    deps: ["schema", "core-math", "core-time", "core-utils"],
  },
  {
    // Fase 6: descriptors de parâmetro vêm de scene-graph, como nos tipos de nó.
    name: "effects",
    layer: 3,
    deps: ["renderer", "scene-graph", "schema", "core-math", "core-time", "core-utils"],
  },
  {
    name: "camera",
    layer: 3,
    deps: ["document", "schema", "core-math", "core-time", "core-utils"],
  },
  {
    // Fase 5: motion path avalia `progress` (animation) e mede comprimento de
    // arco em metros (gis). Ambas as arestas são permitidas pela matriz L3.
    name: "behaviors",
    layer: 3,
    deps: ["animation", "document", "gis", "schema", "core-math", "core-time", "core-utils"],
  },

  // ---- L4 · serviços ----
  { name: "commands", layer: 4, deps: ["document", "schema", "core-time", "core-utils"] },
  { name: "project-io", layer: 4, deps: ["document", "schema", "core-utils"] },
  { name: "export", layer: 4, deps: ["document", "schema", "core-time", "core-utils"] },
  { name: "scripting", layer: 4, deps: ["document", "schema", "core-time", "core-utils"] },
  { name: "plugin-host", layer: 4, deps: ["schema", "core-utils"] },

  // ---- L5 · composição ----
  {
    name: "engine",
    layer: 5,
    deps: ["document", "schema", "core-math", "core-time", "core-utils"],
  },
];

/**
 * As dependências acima são o subconjunto mínimo para a Fase 1 (tudo compila
 * vazio). As dependências intra-camada L2/L3/L4 declaradas na matriz de
 * docs/02-MODULES.md são adicionadas quando cada pacote for implementado —
 * declarar agora criaria arestas que o dependency-cruiser reportaria como
 * órfãs, sem nenhum import real por trás.
 */

const LAYER_LABEL = ["núcleo", "dados", "domínio", "motores", "serviços", "composição"];

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function writeIfMissing(path, content) {
  if (await exists(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

function packageJson(pkg) {
  const dependencies = Object.fromEntries(pkg.deps.map((d) => [`@theatrum/${d}`, "workspace:*"]));
  return (
    JSON.stringify(
      {
        name: `@theatrum/${pkg.name}`,
        version: "0.0.0",
        private: true,
        type: "module",
        theatrum: { layer: pkg.layer },
        exports: { ".": "./src/index.ts" },
        ...(pkg.deps.length ? { dependencies } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function tsconfig(pkg) {
  const refs = pkg.deps.map((d) => ({ path: `../${d}` }));
  return (
    JSON.stringify(
      {
        $comment: "GERADO por tools/scaffold.mjs a partir da tabela de camadas. Não editar.",
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          composite: true,
          ...(pkg.lib === undefined ? {} : { lib: pkg.lib }),
          rootDir: "src",
          outDir: "dist",
          noEmit: false,
          emitDeclarationOnly: true,
          declaration: true,
          declarationMap: true,
          tsBuildInfoFile: "dist/.tsbuildinfo",
        },
        include: ["src/**/*.ts"],
        // Testes ficam num projeto separado (tsconfig.test.json), com Node e
        // vitest disponíveis. Assim o código de produção compila sem lib.dom e
        // sem @types/node — e a invariante "L0 é puro" passa a ser verificada
        // pelo compilador, não confiada à disciplina.
        exclude: ["**/*.test.ts", "**/*.bench.ts"],
        ...(refs.length ? { references: refs } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function barrel(pkg) {
  return `/**
 * @theatrum/${pkg.name} — L${pkg.layer} · ${LAYER_LABEL[pkg.layer]}
 *
 * Superfície pública única deste pacote. Importar
 * \`@theatrum/${pkg.name}/src/...\` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export {};
`;
}

let created = 0;
const report = [];

for (const pkg of PACKAGES) {
  const dir = join(ROOT, "packages", pkg.name);
  const made = [];
  if (await writeIfMissing(join(dir, "package.json"), packageJson(pkg))) made.push("package.json");
  if (await writeIfMissing(join(dir, "src", "index.ts"), barrel(pkg))) made.push("src/index.ts");

  // tsconfig.json é derivado puro da tabela de camadas: sempre reescrito, para
  // que mudar a tabela propague sem edição manual em 19 arquivos.
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tsconfig.json"), tsconfig(pkg), "utf8");
  made.push("tsconfig.json (regenerado)");

  if (made.length) {
    created += made.length;
    report.push(`  L${pkg.layer}  ${pkg.name.padEnd(14)} ${made.join(", ")}`);
  }
}

if (report.length) {
  console.log(`Criados ${created} arquivos:`);
  console.log(report.join("\n"));
} else {
  console.log("Nada a criar — todos os pacotes já existem.");
}

console.log(`\n${PACKAGES.length} pacotes no workspace.`);
console.log(`Raiz: ${relative(process.cwd(), ROOT) || "."}`);
