/**
 * Proíbe fontes de não-determinismo nos pacotes do motor.
 *
 * A invariante: renderização é função pura de (documento, frame). Sem ela não
 * existe export reproduzível, scrub para trás, motion blur nem retomada de
 * render. Ver docs/adr/ADR-003-determinism.md.
 *
 * Esta regra é a que mais paga o investimento: sem ela, um `Math.random()`
 * bem-intencionado dentro de um efeito novo quebra o export, e a descoberta
 * acontece semanas depois, em um único frame de um vídeo já publicado.
 */

const BANNED_MEMBERS = new Map([
  ["Date.now", "use ClockPort, ou receba o frame como argumento"],
  ["Math.random", "use createRng(seed) de @theatrum/core-utils"],
  ["performance.now", "use ClockPort — em export o clock é o contador de frames"],
]);

const BANNED_CONSTRUCTORS = new Map([
  ["Date", "new Date() lê o relógio; passe o timestamp por args se precisar"],
]);

/** Arquivos onde o não-determinismo é o próprio assunto, ou é inofensivo. */
const ALLOWED_PATTERNS = [
  /[/\\]core-utils[/\\]src[/\\]prng\.ts$/, // a implementação do PRNG
  /\.test\.ts$/,
  /\.bench\.ts$/,
  /[/\\]tools[/\\]/,
  /[/\\]apps[/\\]/, // UI pode animar, medir FPS, exibir hora
];

/**
 * `true` se `name` se refere ao global, e não a algo declarado no arquivo.
 *
 * Cuidado: no ESLint um global conhecido (`Math`, `Date`) **resolve** para uma
 * variável do escopo global — então testar `resolved !== null` classificaria
 * todo global como declaração local e silenciaria a regra por completo (foi
 * exatamente o bug que o teste de integração pegou). O que distingue os dois é
 * `defs`: global embutido não tem declaração.
 */
export function isGlobalIdentifier(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.variables.find((v) => v.name === name);
    if (variable !== undefined) return variable.defs.length === 0;
  }
  return true;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "proíbe tempo real e aleatoriedade não semeada nos pacotes do motor",
    },
    schema: [],
    messages: {
      banned: "{{name}} quebra o determinismo do motor. {{hint}}",
      bannedNew: "new {{name}}() quebra o determinismo do motor. {{hint}}",
    },
  },

  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (!filename.includes("/packages/")) return {};
    if (ALLOWED_PATTERNS.some((p) => p.test(context.filename))) return {};

    return {
      MemberExpression(node) {
        if (node.computed || node.object.type !== "Identifier") return;
        if (node.property.type !== "Identifier") return;

        const name = `${node.object.name}.${node.property.name}`;
        const hint = BANNED_MEMBERS.get(name);
        if (hint === undefined) return;

        // Um `Math` ou `Date` declarado no próprio arquivo não é o global.
        if (!isGlobalIdentifier(context.sourceCode.getScope(node), node.object.name)) return;

        context.report({ node, messageId: "banned", data: { name, hint } });
      },

      NewExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const hint = BANNED_CONSTRUCTORS.get(node.callee.name);
        if (hint === undefined) return;
        // `new Date(2026, 0, 1)` é determinístico; `new Date()` não.
        if (node.arguments.length > 0) return;
        if (!isGlobalIdentifier(context.sourceCode.getScope(node), node.callee.name)) return;

        context.report({
          node,
          messageId: "bannedNew",
          data: { name: node.callee.name, hint },
        });
      },
    };
  },
};
