/**
 * Proíbe importar de uma camada superior ou por uma aresta lateral não listada.
 *
 * Sem verificação automática, as camadas vazam em duas semanas. Importar
 * dentro da mesma camada só é aceito quando a direção aparece no DAG explícito
 * de `layers.mjs`: `effects → renderer` é contrato; `renderer → effects` falha.
 *
 * Ver docs/01-ARCHITECTURE.md § 1.
 */

import {
  LAYER_NAMES,
  PACKAGE_LAYERS,
  isImportAllowed,
  packageFromFilename,
  packageFromSpecifier,
} from "./layers.mjs";

const describe = (pkg) => {
  const layer = PACKAGE_LAYERS[pkg];
  return layer === undefined ? pkg : `${pkg} (L${layer} · ${LAYER_NAMES[layer]})`;
};

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "impede import de camada igual ou superior entre pacotes do workspace",
    },
    schema: [],
    messages: {
      crossLayer:
        "{{from}} não pode importar {{to}}: a aresta não existe no DAG de dependências. " +
        "Para comunicação desacoplada use o Event Bus; para mutação, o Command Bus.",
      unknownPackage:
        'pacote "{{to}}" não está em tools/eslint-rules/layers.mjs — ' +
        "registre a camada dele antes de importar.",
    },
  },

  create(context) {
    const fromPackage = packageFromFilename(context.filename);
    if (fromPackage === null) return {};

    const check = (node, specifier) => {
      const toPackage = packageFromSpecifier(specifier);
      if (toPackage === null || toPackage === fromPackage) return;

      if (PACKAGE_LAYERS[toPackage] === undefined) {
        context.report({ node, messageId: "unknownPackage", data: { to: toPackage } });
        return;
      }

      if (!isImportAllowed(fromPackage, toPackage)) {
        context.report({
          node,
          messageId: "crossLayer",
          data: { from: describe(fromPackage), to: describe(toPackage) },
        });
      }
    };

    return {
      ImportDeclaration(node) {
        check(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source) check(node.source, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          check(node.source, node.source.value);
        }
      },
    };
  },
};
