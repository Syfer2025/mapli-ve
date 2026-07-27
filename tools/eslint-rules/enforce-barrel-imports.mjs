/**
 * Proíbe alcançar arquivos internos de outro pacote.
 *
 * `@theatrum/animation` ✅ · `@theatrum/animation/src/evaluator` ❌
 * `./local.js` ✅ · `../../animation/src/evaluator.js` ❌
 *
 * O barrel é o contrato. Sem esta regra, refatorar a estrutura interna de um
 * pacote quebra consumidores, e a "superfície pública única" prometida em
 * docs/02-MODULES.md deixa de existir na prática.
 */

import path from "node:path";
import { packageFromFilename, packageFromSpecifier, reachesIntoInternals } from "./layers.mjs";

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "força imports pelo barrel público dos pacotes do workspace" },
    schema: [],
    messages: {
      internal:
        'importe "@theatrum/{{pkg}}" em vez de alcançar o interior dele. ' +
        "Se o símbolo não está exportado no barrel, exporte-o lá — " +
        "ou ele não faz parte da API pública.",
      relativeCrossPackage: 'caminho relativo atravessando pacote. Use "@theatrum/{{pkg}}".',
    },
  },

  create(context) {
    const fromPackage = packageFromFilename(context.filename);
    const fromDirectory = path.dirname(context.filename);

    const check = (node, specifier) => {
      if (reachesIntoInternals(specifier)) {
        const pkg = packageFromSpecifier(specifier);
        if (pkg !== null && pkg !== fromPackage) {
          context.report({ node, messageId: "internal", data: { pkg } });
        }
        return;
      }

      if (!specifier.startsWith(".")) return;

      // Resolver de verdade em vez de adivinhar pelo texto: um relativo como
      // "../../animation/src/x.js" não contém "packages/" em nenhum lugar, mas
      // aponta para outro pacote depois de resolvido.
      const resolved = path.resolve(fromDirectory, specifier).replaceAll("\\", "/");
      const targetPackage = packageFromFilename(resolved);

      if (targetPackage !== null && targetPackage !== fromPackage) {
        context.report({
          node,
          messageId: "relativeCrossPackage",
          data: { pkg: targetPackage },
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
