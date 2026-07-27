/**
 * Fonte única da topologia de camadas.
 *
 * A matriz de dependências em docs/02-MODULES.md e este arquivo precisam
 * concordar. Divergência entre os dois é bug de configuração, não licença
 * para importar de cima.
 */

/** Camada conceitual de cada pacote. Arestas laterais são um DAG explícito. */
export const PACKAGE_LAYERS = Object.freeze({
  // L0 · núcleo
  "core-math": 0,
  "core-utils": 0,
  "core-time": 0,
  // L1 · dados
  schema: 1,
  document: 1,
  // L2 · domínio
  "scene-graph": 2,
  animation: 2,
  gis: 2,
  assets: 2,
  // L3 · motores
  renderer: 3,
  effects: 3,
  camera: 3,
  behaviors: 3,
  // L4 · serviços
  commands: 4,
  "project-io": 4,
  export: 4,
  scripting: 4,
  "plugin-host": 4,
  // L5 · composição
  engine: 5,
  // L6 · aplicações
  editor: 6,
  shell: 6,
});

export const LAYER_NAMES = Object.freeze([
  "núcleo",
  "dados",
  "domínio",
  "motores",
  "serviços",
  "composição",
  "aplicações",
]);

/**
 * Arestas dirigidas permitidas dentro de uma mesma camada conceitual.
 *
 * `core-time → core-utils`: dentro de L0, `core-time` precisa de `Result` para
 * o parser não lançar.
 * As demais arestas correspondem exatamente à matriz normativa de
 * `docs/02-MODULES.md`. Só a direção listada é válida; a inversa continua
 * proibida, preservando um DAG testável dentro de cada camada.
 *
 * `editor → shell`: o renderer consome somente o barrel de contratos da ponte
 * do host (`@theatrum/shell`). A dependência inversa é proibida; por isso a
 * aresta continua acíclica e não permite que a UI alcance implementações do
 * main/preload.
 */
export const INTRA_LAYER_EXCEPTIONS = Object.freeze([
  { from: "core-time", to: "core-utils" },
  { from: "document", to: "schema" },
  { from: "animation", to: "scene-graph" },
  { from: "effects", to: "renderer" },
  { from: "behaviors", to: "effects" },
  { from: "behaviors", to: "camera" },
  { from: "scripting", to: "commands" },
  { from: "plugin-host", to: "export" },
  { from: "plugin-host", to: "scripting" },
  { from: "editor", to: "shell" },
]);

const THEATRUM_SCOPE = "@theatrum/";

/** Extrai o nome do pacote de um especificador `@theatrum/x` ou `@theatrum/x/y`. */
export function packageFromSpecifier(specifier) {
  if (!specifier.startsWith(THEATRUM_SCOPE)) return null;
  const rest = specifier.slice(THEATRUM_SCOPE.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

/** `true` se o especificador aponta para um arquivo interno de outro pacote. */
export function reachesIntoInternals(specifier) {
  if (!specifier.startsWith(THEATRUM_SCOPE)) return false;
  return specifier.slice(THEATRUM_SCOPE.length).includes("/");
}

/** Deduz o pacote a partir do caminho do arquivo em disco. */
export function packageFromFilename(filename) {
  const normalized = filename.replaceAll("\\", "/");
  const match = /\/(?:packages|apps)\/([^/]+)\//.exec(normalized);
  return match === null ? null : match[1];
}

export function isImportAllowed(fromPackage, toPackage) {
  if (fromPackage === toPackage) return true;

  const fromLayer = PACKAGE_LAYERS[fromPackage];
  const toLayer = PACKAGE_LAYERS[toPackage];
  if (fromLayer === undefined || toLayer === undefined) return true; // pacote desconhecido: outra regra trata

  if (toLayer < fromLayer) return true;

  return INTRA_LAYER_EXCEPTIONS.some((e) => e.from === fromPackage && e.to === toPackage);
}
