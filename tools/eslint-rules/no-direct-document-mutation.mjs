/**
 * Proíbe chamar `.mutate(` fora de `packages/commands` e `packages/document`.
 *
 * O documento é a única verdade e só muda pelo Command Bus. Escrita direta
 * pularia a validação, o histórico de undo e a invalidação dirigida por patch —
 * três coisas que dependem de haver exatamente um caminho de escrita.
 *
 * Ver docs/01-ARCHITECTURE.md § 3.
 */

/** Onde a mutação direta é legítima. */
const ALLOWED = [
  /[/\\]packages[/\\]commands[/\\]/, // implementa o bus
  /[/\\]packages[/\\]document[/\\]/, // implementa o store
  /[/\\]packages[/\\]project-io[/\\]/, // replace() ao carregar projeto
  /\.test\.ts$/,
];

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "mutação do documento só via Command Bus" },
    schema: [],
    messages: {
      direct:
        "não mute o documento direto. Use engine.commands.dispatch({ type: ... }) — " +
        "escrita fora do Command Bus pula validação, undo e invalidação por patch.",
    },
  },

  create(context) {
    if (ALLOWED.some((p) => p.test(context.filename))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "mutate") return;

        // Só reporta quando o receptor parece ser o store do documento.
        const receiver = callee.object;
        const receiverName =
          receiver.type === "Identifier"
            ? receiver.name
            : receiver.type === "MemberExpression" &&
                !receiver.computed &&
                receiver.property.type === "Identifier"
              ? receiver.property.name
              : null;

        if (receiverName === null) return;
        if (!/^(document|documentStore|doc|store)$/i.test(receiverName)) return;

        context.report({ node, messageId: "direct" });
      },
    };
  },
};
