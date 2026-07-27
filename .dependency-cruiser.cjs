/**
 * Verificação de camadas no nível do grafo de módulos.
 *
 * A regra de ESLint pega import por import; esta pega ciclos e órfãos, que só
 * aparecem olhando o grafo inteiro. As duas juntas são o que impede a
 * arquitetura de virar sopa — verificado por ferramenta, não por disciplina.
 *
 * Derivado da matriz em docs/02-MODULES.md.
 */

/** Camadas, da mais baixa para a mais alta. Índice = número da camada. */
const LAYERS = [
  ["core-math", "core-utils", "core-time"],
  ["schema", "document"],
  ["scene-graph", "animation", "gis", "assets"],
  ["renderer", "effects", "camera", "behaviors"],
  ["commands", "project-io", "export", "scripting", "plugin-host"],
  ["engine"],
];

const pathFor = (names) => (names.length === 0 ? "$^" : `^(?:packages)/(?:${names.join("|")})/`);

/**
 * DAG dirigido permitido dentro de cada camada conceitual.
 * Deve coincidir com tools/eslint-rules/layers.mjs e docs/02-MODULES.md.
 */
const INTRA_LAYER_EDGES = [
  ["core-time", "core-utils"],
  ["document", "schema"],
  ["animation", "scene-graph"],
  ["effects", "renderer"],
  ["behaviors", "effects"],
  ["behaviors", "camera"],
  ["scripting", "commands"],
  ["plugin-host", "export"],
  ["plugin-host", "scripting"],
];

/**
 * Uma regra por pacote. Proíbe subir e proíbe toda aresta lateral que não esteja
 * no DAG explícito acima. O próprio pacote é excluído para permitir imports
 * relativos internos.
 */
const layerRules = LAYERS.flatMap((names, index) =>
  names.map((fromPackage) => {
    const allowedPeers = new Set(
      INTRA_LAYER_EDGES.filter(([from]) => from === fromPackage).map(([, to]) => to),
    );
    const forbidden = LAYERS.slice(index)
      .flat()
      .filter((candidate) => candidate !== fromPackage && !allowedPeers.has(candidate));

    return {
      name: `dependencias-${fromPackage}`,
      severity: "error",
      comment: `${fromPackage} só pode descer de camada ou seguir uma aresta lateral declarada.`,
      from: { path: `^packages/${fromPackage}/` },
      to: { path: pathFor(forbidden) },
    };
  }),
);

module.exports = {
  forbidden: [
    ...layerRules,

    {
      name: "sem-ciclos",
      severity: "error",
      comment:
        "Ciclo de dependência. Se dois módulos precisam se conhecer, um evento " +
        "ou a camada de composição resolve — import mútuo não.",
      from: {},
      to: { circular: true },
    },

    {
      name: "sem-orfaos",
      severity: "warn",
      comment: "Módulo que ninguém importa e que não importa ninguém.",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)index\\.ts$",
          "\\.test\\.ts$",
          "(^|/)tsconfig[^/]*\\.json$",
          "(^|/)[^/]*\\.config\\.[cm]?[jt]s$",
        ],
      },
      to: {},
    },

    {
      name: "nada-depende-de-app",
      severity: "error",
      comment: "Nenhum pacote pode depender de apps/. A UI é folha do grafo.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },

    {
      name: "shell-nao-depende-do-editor",
      severity: "error",
      comment: "A única aresta entre aplicações é editor → barrel de contratos do shell.",
      from: { path: "^apps/shell/" },
      to: { path: "^apps/editor/" },
    },

    {
      name: "nucleo-sem-dependencia-externa",
      severity: "error",
      comment:
        "L0 é puro: sem npm, sem DOM, sem Node. É o que permite testá-lo em " +
        "isolamento e o que o torna a parte do código que nunca muda.",
      from: { path: "^packages/core-(math|utils|time)/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "core"],
        pathNot: "^packages/core-(math|utils|time)/",
      },
    },

    {
      name: "sem-deps-de-dev-em-producao",
      severity: "error",
      comment: "Código de produção não importa devDependency.",
      from: { path: "^packages/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"] },
    },

    {
      name: "sem-modulo-nao-resolvido",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|out|coverage|node_modules)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
