/**
 * Expressões determinísticas para propriedades animáveis.
 *
 * Este módulo interpreta uma linguagem própria e deliberadamente pequena. Ele
 * não executa JavaScript, não acessa objetos do host e não possui laços,
 * atribuições ou fontes implícitas de tempo/aleatoriedade.
 */

export type ExpressionScalar = number | string | boolean;
export type ExpressionValue = ExpressionScalar | readonly ExpressionValue[];

export type ExpressionDiagnosticCode =
  | "expression.empty"
  | "expression.source-too-long"
  | "expression.too-complex"
  | "expression.invalid-token"
  | "expression.invalid-number"
  | "expression.unterminated-string"
  | "expression.unexpected-token"
  | "expression.unknown-identifier"
  | "expression.unknown-function"
  | "expression.invalid-arity"
  | "expression.type"
  | "expression.divide-by-zero"
  | "expression.index"
  | "expression.non-finite"
  | "expression.result-too-large";

export interface ExpressionDiagnostic {
  readonly code: ExpressionDiagnosticCode;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ExpressionProgram {
  readonly source: string;
  readonly root: ExpressionNode;
  readonly nodeCount: number;
}

export type CompileExpressionResult =
  | {
      readonly ok: true;
      readonly program: ExpressionProgram;
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly program: null;
      readonly diagnostics: readonly ExpressionDiagnostic[];
    };

export interface ExpressionContext {
  /** Frame local da propriedade; pode ser fracionário durante motion blur. */
  readonly frame: number;
  /** Valor estático/interpolado antes da expressão. */
  readonly value: ExpressionValue;
}

export type EvaluateExpressionResult =
  | {
      readonly ok: true;
      readonly value: ExpressionValue;
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly ExpressionDiagnostic[];
    };

const MAX_SOURCE_LENGTH = 4_096;
const MAX_TOKENS = 512;
const MAX_AST_NODES = 256;
const MAX_EVALUATION_STEPS = 1_024;
const MAX_VALUE_NODES = 512;
const MAX_STRING_LENGTH = 16_384;
const COMPILED_SOURCE_CACHE_LIMIT = 256;
const compiledSourceCache = new Map<string, CompileExpressionResult>();

type TokenKind =
  | "number"
  | "string"
  | "identifier"
  | "("
  | ")"
  | "["
  | "]"
  | ","
  | "?"
  | ":"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "!"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  readonly value: string | number | null;
}

interface NodeBase {
  readonly start: number;
  readonly end: number;
}

interface LiteralNode extends NodeBase {
  readonly kind: "literal";
  readonly value: ExpressionScalar;
}

interface VariableNode extends NodeBase {
  readonly kind: "variable";
  readonly name: "frame" | "value" | "pi" | "e";
}

interface ArrayNode extends NodeBase {
  readonly kind: "array";
  readonly elements: readonly ExpressionNode[];
}

interface UnaryNode extends NodeBase {
  readonly kind: "unary";
  readonly operator: "+" | "-" | "!";
  readonly argument: ExpressionNode;
}

interface BinaryNode extends NodeBase {
  readonly kind: "binary";
  readonly operator:
    "+" | "-" | "*" | "/" | "%" | "**" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

interface ConditionalNode extends NodeBase {
  readonly kind: "conditional";
  readonly condition: ExpressionNode;
  readonly consequent: ExpressionNode;
  readonly alternate: ExpressionNode;
}

interface CallNode extends NodeBase {
  readonly kind: "call";
  readonly name: BuiltinName;
  readonly arguments: readonly ExpressionNode[];
}

interface IndexNode extends NodeBase {
  readonly kind: "index";
  readonly target: ExpressionNode;
  readonly index: ExpressionNode;
}

type ExpressionNode =
  | LiteralNode
  | VariableNode
  | ArrayNode
  | UnaryNode
  | BinaryNode
  | ConditionalNode
  | CallNode
  | IndexNode;

type BuiltinName =
  | "abs"
  | "acos"
  | "asin"
  | "atan"
  | "atan2"
  | "ceil"
  | "clamp"
  | "cos"
  | "deg"
  | "exp"
  | "floor"
  | "length"
  | "lerp"
  | "log"
  | "max"
  | "min"
  | "pow"
  | "rad"
  | "round"
  | "sign"
  | "sin"
  | "smoothstep"
  | "sqrt"
  | "tan"
  | "vec";

interface Arity {
  readonly minimum: number;
  readonly maximum: number;
}

const BUILTIN_ARITIES: Readonly<Record<BuiltinName, Arity>> = Object.freeze({
  abs: { minimum: 1, maximum: 1 },
  acos: { minimum: 1, maximum: 1 },
  asin: { minimum: 1, maximum: 1 },
  atan: { minimum: 1, maximum: 1 },
  atan2: { minimum: 2, maximum: 2 },
  ceil: { minimum: 1, maximum: 1 },
  clamp: { minimum: 3, maximum: 3 },
  cos: { minimum: 1, maximum: 1 },
  deg: { minimum: 1, maximum: 1 },
  exp: { minimum: 1, maximum: 1 },
  floor: { minimum: 1, maximum: 1 },
  length: { minimum: 1, maximum: 1 },
  lerp: { minimum: 3, maximum: 3 },
  log: { minimum: 1, maximum: 1 },
  max: { minimum: 1, maximum: 16 },
  min: { minimum: 1, maximum: 16 },
  pow: { minimum: 2, maximum: 2 },
  rad: { minimum: 1, maximum: 1 },
  round: { minimum: 1, maximum: 1 },
  sign: { minimum: 1, maximum: 1 },
  sin: { minimum: 1, maximum: 1 },
  smoothstep: { minimum: 3, maximum: 3 },
  sqrt: { minimum: 1, maximum: 1 },
  tan: { minimum: 1, maximum: 1 },
  vec: { minimum: 1, maximum: 16 },
});

const BUILTIN_NAMES = new Set<string>(Object.keys(BUILTIN_ARITIES));
const VARIABLE_NAMES = new Set<string>(["frame", "value", "pi", "e"]);

class ExpressionFault extends Error {
  readonly diagnostic: ExpressionDiagnostic;

  constructor(diagnostic: ExpressionDiagnostic) {
    super(diagnostic.message);
    this.name = "ExpressionFault";
    this.diagnostic = diagnostic;
  }
}

/**
 * Compila texto em uma AST fechada. A AST contém somente os nós descritos neste
 * arquivo; identificadores e chamadas são validados antes da avaliação.
 */
export function compileExpression(source: string): CompileExpressionResult {
  if (source.length > MAX_SOURCE_LENGTH) {
    return failed(
      diagnostic(
        "expression.source-too-long",
        `A expressão excede o limite de ${MAX_SOURCE_LENGTH} caracteres.`,
        0,
        source.length,
      ),
    );
  }

  try {
    const tokens = tokenize(source);
    const parser = new ExpressionParser(tokens);
    const root = parser.parse();
    return Object.freeze({
      ok: true as const,
      program: Object.freeze({
        source,
        root: freezeNode(root),
        nodeCount: parser.nodeCount,
      }),
      diagnostics: Object.freeze([]) as readonly [],
    });
  } catch (error) {
    if (error instanceof ExpressionFault) return failed(error.diagnostic);
    throw error;
  }
}

/**
 * Avalia um programa compilado sem consultar estado externo. Falhas de tipo,
 * domínio matemático ou limites viram diagnósticos, não exceções públicas.
 */
export function evaluateExpression(
  program: ExpressionProgram,
  context: ExpressionContext,
): EvaluateExpressionResult {
  const contextIssue = validateContext(context);
  if (contextIssue !== null) return failedEvaluation(contextIssue);

  try {
    const evaluator = new ExpressionEvaluator(context);
    const value = evaluator.evaluate(program.root);
    const resultIssue = validateValueSize(value, program.root);
    if (resultIssue !== null) return failedEvaluation(resultIssue);
    return Object.freeze({
      ok: true as const,
      value: freezeValue(value),
      diagnostics: Object.freeze([]) as readonly [],
    });
  } catch (error) {
    if (error instanceof ExpressionFault) return failedEvaluation(error.diagnostic);
    throw error;
  }
}

/** Atalho para chamadores que não precisam reter o programa compilado. */
export function evaluateExpressionSource(
  source: string,
  context: ExpressionContext,
): EvaluateExpressionResult {
  const compiled = cachedCompilation(source);
  if (!compiled.ok) {
    return Object.freeze({
      ok: false as const,
      value: null,
      diagnostics: compiled.diagnostics,
    });
  }
  return evaluateExpression(compiled.program, context);
}

function cachedCompilation(source: string): CompileExpressionResult {
  const cached = compiledSourceCache.get(source);
  if (cached !== undefined) return cached;

  const compiled = compileExpression(source);
  if (compiledSourceCache.size >= COMPILED_SOURCE_CACHE_LIMIT) {
    const oldest = compiledSourceCache.keys().next().value as string | undefined;
    if (oldest !== undefined) compiledSourceCache.delete(oldest);
  }
  compiledSourceCache.set(source, compiled);
  return compiled;
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  const push = (token: Token): void => {
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) {
      throw new ExpressionFault(
        diagnostic(
          "expression.too-complex",
          `A expressão excede o limite de ${MAX_TOKENS} tokens.`,
          token.start,
          token.end,
        ),
      );
    }
  };

  while (offset < source.length) {
    const character = source[offset];
    if (character === undefined) break;
    if (isWhitespace(character)) {
      offset += 1;
      continue;
    }

    if (isDigit(character) || (character === "." && isDigit(source[offset + 1] ?? ""))) {
      const numberToken = scanNumber(source, offset);
      push(numberToken);
      offset = numberToken.end;
      continue;
    }

    if (character === '"' || character === "'") {
      const stringToken = scanString(source, offset, character);
      push(stringToken);
      offset = stringToken.end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = offset + 1;
      while (end < source.length && isIdentifierPart(source[end] ?? "")) end += 1;
      push({
        kind: "identifier",
        start: offset,
        end,
        value: source.slice(offset, end),
      });
      offset = end;
      continue;
    }

    const double = source.slice(offset, offset + 2);
    if (isDoubleOperator(double)) {
      push({ kind: double, start: offset, end: offset + 2, value: null });
      offset += 2;
      continue;
    }

    if (isSingleToken(character)) {
      push({ kind: character, start: offset, end: offset + 1, value: null });
      offset += 1;
      continue;
    }

    throw new ExpressionFault(
      diagnostic(
        "expression.invalid-token",
        `Token não permitido: "${character}".`,
        offset,
        offset + 1,
      ),
    );
  }

  push({ kind: "eof", start: source.length, end: source.length, value: null });
  return Object.freeze(tokens);
}

function scanNumber(source: string, start: number): Token {
  let end = start;
  let sawDigits = false;

  while (isDigit(source[end] ?? "")) {
    sawDigits = true;
    end += 1;
  }
  if (source[end] === ".") {
    end += 1;
    while (isDigit(source[end] ?? "")) {
      sawDigits = true;
      end += 1;
    }
  }
  if (!sawDigits) {
    throw new ExpressionFault(
      diagnostic("expression.invalid-number", "Número inválido.", start, Math.max(end, start + 1)),
    );
  }

  if (source[end] === "e" || source[end] === "E") {
    const exponentStart = end;
    end += 1;
    if (source[end] === "+" || source[end] === "-") end += 1;
    const digitsStart = end;
    while (isDigit(source[end] ?? "")) end += 1;
    if (digitsStart === end) {
      throw new ExpressionFault(
        diagnostic("expression.invalid-number", "Expoente sem dígitos.", exponentStart, end),
      );
    }
  }

  const value = Number(source.slice(start, end));
  if (!Number.isFinite(value)) {
    throw new ExpressionFault(
      diagnostic("expression.invalid-number", "O número deve ser finito.", start, end),
    );
  }
  return { kind: "number", start, end, value };
}

function scanString(source: string, start: number, quote: '"' | "'"): Token {
  let end = start + 1;
  let value = "";

  while (end < source.length) {
    const character = source[end];
    if (character === quote) {
      return { kind: "string", start, end: end + 1, value };
    }
    if (character === "\n" || character === "\r" || character === undefined) break;
    if (character !== "\\") {
      value += character;
      end += 1;
      continue;
    }

    const escaped = source[end + 1];
    if (escaped === undefined) break;
    const replacements: Readonly<Record<string, string>> = {
      "\\": "\\",
      '"': '"',
      "'": "'",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
    };
    const replacement = replacements[escaped];
    if (replacement !== undefined) {
      value += replacement;
      end += 2;
      continue;
    }
    if (escaped === "u") {
      const hexadecimal = source.slice(end + 2, end + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hexadecimal)) {
        value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
        end += 6;
        continue;
      }
    }
    throw new ExpressionFault(
      diagnostic(
        "expression.invalid-token",
        `Escape de string não permitido: "\\${escaped}".`,
        end,
        end + 2,
      ),
    );
  }

  throw new ExpressionFault(
    diagnostic(
      "expression.unterminated-string",
      "String sem delimitador de fechamento.",
      start,
      source.length,
    ),
  );
}

class ExpressionParser {
  readonly tokens: readonly Token[];
  private offset = 0;
  private nodes = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  get nodeCount(): number {
    return this.nodes;
  }

  parse(): ExpressionNode {
    if (this.current().kind === "eof") {
      this.fail("expression.empty", "A expressão está vazia.", this.current());
    }
    const expression = this.parseConditional();
    const trailing = this.current();
    if (trailing.kind !== "eof") {
      this.fail(
        "expression.unexpected-token",
        `Token inesperado depois do fim da expressão: "${tokenLabel(trailing)}".`,
        trailing,
      );
    }
    return expression;
  }

  private parseConditional(): ExpressionNode {
    const condition = this.parseLogicalOr();
    if (!this.match("?")) return condition;
    const consequent = this.parseConditional();
    this.expect(":", 'Esperado ":" no condicional.');
    const alternate = this.parseConditional();
    return this.make({
      kind: "conditional",
      condition,
      consequent,
      alternate,
      start: condition.start,
      end: alternate.end,
    });
  }

  private parseLogicalOr(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parseLogicalAnd(), ["||"]);
  }

  private parseLogicalAnd(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parseEquality(), ["&&"]);
  }

  private parseEquality(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parseComparison(), ["==", "!="]);
  }

  private parseComparison(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parseAdditive(), ["<", "<=", ">", ">="]);
  }

  private parseAdditive(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parseMultiplicative(), ["+", "-"]);
  }

  private parseMultiplicative(): ExpressionNode {
    return this.parseLeftAssociative(() => this.parsePower(), ["*", "/", "%"]);
  }

  private parsePower(): ExpressionNode {
    const left = this.parseUnary();
    const operator = this.take("**");
    if (operator === null) return left;
    const right = this.parsePower();
    return this.binary(operator, left, right);
  }

  private parseUnary(): ExpressionNode {
    const token = this.current();
    if (token.kind !== "+" && token.kind !== "-" && token.kind !== "!") {
      return this.parsePostfix();
    }
    this.advance();
    const argument = this.parseUnary();
    return this.make({
      kind: "unary",
      operator: token.kind,
      argument,
      start: token.start,
      end: argument.end,
    });
  }

  private parsePostfix(): ExpressionNode {
    let target = this.parsePrimary();
    while (this.match("[")) {
      const index = this.parseConditional();
      const closing = this.expect("]", 'Esperado "]" depois do índice.');
      target = this.make({
        kind: "index",
        target,
        index,
        start: target.start,
        end: closing.end,
      });
    }
    return target;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.current();
    if (token.kind === "number") {
      this.advance();
      return this.make({
        kind: "literal",
        value: token.value as number,
        start: token.start,
        end: token.end,
      });
    }
    if (token.kind === "string") {
      this.advance();
      return this.make({
        kind: "literal",
        value: token.value as string,
        start: token.start,
        end: token.end,
      });
    }
    if (token.kind === "identifier") return this.parseIdentifier();
    if (this.match("(")) {
      const expression = this.parseConditional();
      this.expect(")", 'Esperado ")" depois da expressão.');
      return expression;
    }
    if (this.match("[")) return this.parseArray(token);
    this.fail(
      "expression.unexpected-token",
      `Esperado valor, mas foi encontrado "${tokenLabel(token)}".`,
      token,
    );
  }

  private parseIdentifier(): ExpressionNode {
    const identifier = this.current();
    this.advance();
    const name = String(identifier.value);

    if (this.match("(")) {
      if (!BUILTIN_NAMES.has(name)) {
        this.fail("expression.unknown-function", `Função não permitida: "${name}".`, identifier);
      }
      const argumentsList: ExpressionNode[] = [];
      if (this.current().kind !== ")") {
        do {
          argumentsList.push(this.parseConditional());
        } while (this.match(","));
      }
      const closing = this.expect(")", 'Esperado ")" depois dos argumentos.');
      const builtinName = name as BuiltinName;
      const arity = BUILTIN_ARITIES[builtinName];
      if (argumentsList.length < arity.minimum || argumentsList.length > arity.maximum) {
        const expected =
          arity.minimum === arity.maximum
            ? String(arity.minimum)
            : `${arity.minimum} a ${arity.maximum}`;
        this.fail(
          "expression.invalid-arity",
          `"${name}" espera ${expected} argumento(s), recebeu ${argumentsList.length}.`,
          { ...identifier, end: closing.end },
        );
      }
      return this.make({
        kind: "call",
        name: builtinName,
        arguments: Object.freeze(argumentsList),
        start: identifier.start,
        end: closing.end,
      });
    }

    if (name === "true" || name === "false") {
      return this.make({
        kind: "literal",
        value: name === "true",
        start: identifier.start,
        end: identifier.end,
      });
    }
    if (!VARIABLE_NAMES.has(name)) {
      this.fail(
        "expression.unknown-identifier",
        `Identificador não permitido: "${name}".`,
        identifier,
      );
    }
    return this.make({
      kind: "variable",
      name: name as VariableNode["name"],
      start: identifier.start,
      end: identifier.end,
    });
  }

  private parseArray(opening: Token): ExpressionNode {
    const elements: ExpressionNode[] = [];
    if (this.current().kind !== "]") {
      do {
        elements.push(this.parseConditional());
      } while (this.match(","));
    }
    const closing = this.expect("]", 'Esperado "]" depois do vetor.');
    return this.make({
      kind: "array",
      elements: Object.freeze(elements),
      start: opening.start,
      end: closing.end,
    });
  }

  private parseLeftAssociative(
    operand: () => ExpressionNode,
    operators: readonly BinaryNode["operator"][],
  ): ExpressionNode {
    let left = operand();
    while (operators.includes(this.current().kind as BinaryNode["operator"])) {
      const operator = this.current();
      this.advance();
      const right = operand();
      left = this.binary(operator, left, right);
    }
    return left;
  }

  private binary(operator: Token, left: ExpressionNode, right: ExpressionNode): BinaryNode {
    return this.make({
      kind: "binary",
      operator: operator.kind as BinaryNode["operator"],
      left,
      right,
      start: left.start,
      end: right.end,
    });
  }

  private make<T extends ExpressionNode>(node: T): T {
    this.nodes += 1;
    if (this.nodes > MAX_AST_NODES) {
      this.fail(
        "expression.too-complex",
        `A expressão excede o limite de ${MAX_AST_NODES} operações.`,
        node,
      );
    }
    return node;
  }

  private current(): Token {
    const token = this.tokens[this.offset];
    if (token !== undefined) return token;
    const end = this.tokens[this.tokens.length - 1];
    if (end !== undefined) return end;
    throw new Error("Lexer produziu uma sequência de tokens vazia.");
  }

  private advance(): void {
    if (this.offset < this.tokens.length - 1) this.offset += 1;
  }

  private match(kind: TokenKind): boolean {
    if (this.current().kind !== kind) return false;
    this.advance();
    return true;
  }

  private take(kind: TokenKind): Token | null {
    const token = this.current();
    if (token.kind !== kind) return null;
    this.advance();
    return token;
  }

  private expect(kind: TokenKind, message: string): Token {
    const token = this.current();
    if (token.kind !== kind) {
      this.fail("expression.unexpected-token", message, token);
    }
    this.advance();
    return token;
  }

  private fail(code: ExpressionDiagnosticCode, message: string, range: NodeBase): never {
    throw new ExpressionFault(diagnostic(code, message, range.start, range.end));
  }
}

class ExpressionEvaluator {
  readonly context: ExpressionContext;
  private steps = 0;

  constructor(context: ExpressionContext) {
    this.context = context;
  }

  evaluate(node: ExpressionNode): ExpressionValue {
    this.steps += 1;
    if (this.steps > MAX_EVALUATION_STEPS) {
      this.fail(
        "expression.too-complex",
        `A avaliação excedeu ${MAX_EVALUATION_STEPS} operações.`,
        node,
      );
    }

    switch (node.kind) {
      case "literal":
        return node.value;
      case "variable":
        return this.variable(node);
      case "array":
        return Object.freeze(node.elements.map((element) => this.evaluate(element)));
      case "unary":
        return this.unary(node);
      case "binary":
        return this.binary(node);
      case "conditional":
        return this.conditional(node);
      case "call":
        return this.call(node);
      case "index":
        return this.index(node);
    }
  }

  private variable(node: VariableNode): ExpressionValue {
    switch (node.name) {
      case "frame":
        return this.context.frame;
      case "value":
        return this.context.value;
      case "pi":
        return Math.PI;
      case "e":
        return Math.E;
    }
  }

  private unary(node: UnaryNode): ExpressionValue {
    const argument = this.evaluate(node.argument);
    if (node.operator === "!") {
      if (typeof argument !== "boolean") {
        this.fail("expression.type", 'O operador "!" exige booleano.', node);
      }
      return !argument;
    }
    return mapNumeric(argument, (value) => (node.operator === "-" ? -value : value), node, this);
  }

  private binary(node: BinaryNode): ExpressionValue {
    const left = this.evaluate(node.left);
    if (node.operator === "&&" || node.operator === "||") {
      if (typeof left !== "boolean") {
        this.fail(
          "expression.type",
          `O lado esquerdo de "${node.operator}" deve ser booleano.`,
          node.left,
        );
      }
      if (node.operator === "&&" && !left) return false;
      if (node.operator === "||" && left) return true;
      const right = this.evaluate(node.right);
      if (typeof right !== "boolean") {
        this.fail(
          "expression.type",
          `O lado direito de "${node.operator}" deve ser booleano.`,
          node.right,
        );
      }
      return right;
    }

    const right = this.evaluate(node.right);
    switch (node.operator) {
      case "+":
        if (typeof left === "string" && typeof right === "string") {
          return left + right;
        }
        return numericBinary(left, right, (a, b) => a + b, node, this);
      case "-":
        return numericBinary(left, right, (a, b) => a - b, node, this);
      case "*":
        return numericBinary(left, right, (a, b) => a * b, node, this);
      case "/":
        return numericBinary(
          left,
          right,
          (a, b) => {
            if (b === 0) this.fail("expression.divide-by-zero", "Divisão por zero.", node);
            return a / b;
          },
          node,
          this,
        );
      case "%":
        return numericBinary(
          left,
          right,
          (a, b) => {
            if (b === 0) this.fail("expression.divide-by-zero", "Resto por zero.", node);
            return a % b;
          },
          node,
          this,
        );
      case "**":
        return numericBinary(left, right, (a, b) => a ** b, node, this);
      case "==":
        return equalValue(left, right);
      case "!=":
        return !equalValue(left, right);
      case "<":
      case "<=":
      case ">":
      case ">=":
        return compareValues(left, right, node.operator, node, this);
    }
  }

  private conditional(node: ConditionalNode): ExpressionValue {
    const condition = this.evaluate(node.condition);
    if (typeof condition !== "boolean") {
      this.fail("expression.type", "A condição deve resultar em booleano.", node.condition);
    }
    return this.evaluate(condition ? node.consequent : node.alternate);
  }

  private call(node: CallNode): ExpressionValue {
    const values = node.arguments.map((argument) => this.evaluate(argument));
    const first = values[0];
    switch (node.name) {
      case "abs":
        return this.unaryMath(first, Math.abs, node);
      case "acos":
        return this.unaryMath(first, Math.acos, node);
      case "asin":
        return this.unaryMath(first, Math.asin, node);
      case "atan":
        return this.unaryMath(first, Math.atan, node);
      case "ceil":
        return this.unaryMath(first, Math.ceil, node);
      case "cos":
        return this.unaryMath(first, Math.cos, node);
      case "exp":
        return this.unaryMath(first, Math.exp, node);
      case "floor":
        return this.unaryMath(first, Math.floor, node);
      case "log":
        return this.unaryMath(first, Math.log, node);
      case "round":
        return this.unaryMath(first, Math.round, node);
      case "sign":
        return this.unaryMath(first, Math.sign, node);
      case "sin":
        return this.unaryMath(first, Math.sin, node);
      case "sqrt":
        return this.unaryMath(first, Math.sqrt, node);
      case "tan":
        return this.unaryMath(first, Math.tan, node);
      case "deg":
        return this.unaryMath(first, (value) => (value * 180) / Math.PI, node);
      case "rad":
        return this.unaryMath(first, (value) => (value * Math.PI) / 180, node);
      case "atan2":
        return this.binaryMath(values, Math.atan2, node);
      case "pow":
        return this.binaryMath(values, Math.pow, node);
      case "clamp":
        return numericTernary(
          this.required(values, 0, node),
          this.required(values, 1, node),
          this.required(values, 2, node),
          (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum),
          node,
          this,
        );
      case "lerp":
        return numericTernary(
          this.required(values, 0, node),
          this.required(values, 1, node),
          this.required(values, 2, node),
          (start, end, progress) => start + (end - start) * progress,
          node,
          this,
        );
      case "smoothstep":
        return numericTernary(
          this.required(values, 0, node),
          this.required(values, 1, node),
          this.required(values, 2, node),
          (edge0, edge1, value) => {
            if (edge0 === edge1) {
              this.fail("expression.divide-by-zero", "smoothstep exige bordas diferentes.", node);
            }
            const progress = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
            return progress * progress * (3 - 2 * progress);
          },
          node,
          this,
        );
      case "min":
        return this.reduceNumeric(values, Math.min, node);
      case "max":
        return this.reduceNumeric(values, Math.max, node);
      case "length":
        return vectorLength(this.required(values, 0, node), node, this);
      case "vec":
        return Object.freeze(values);
    }
  }

  private unaryMath(
    value: ExpressionValue | undefined,
    operation: (input: number) => number,
    node: CallNode,
  ): ExpressionValue {
    return mapNumeric(this.requiredValue(value, node), operation, node, this);
  }

  private binaryMath(
    values: readonly ExpressionValue[],
    operation: (left: number, right: number) => number,
    node: CallNode,
  ): ExpressionValue {
    return numericBinary(
      this.required(values, 0, node),
      this.required(values, 1, node),
      operation,
      node,
      this,
    );
  }

  private reduceNumeric(
    values: readonly ExpressionValue[],
    operation: (left: number, right: number) => number,
    node: CallNode,
  ): ExpressionValue {
    let result = mapNumeric(this.required(values, 0, node), (value) => value, node, this);
    for (let index = 1; index < values.length; index += 1) {
      result = numericBinary(result, this.required(values, index, node), operation, node, this);
    }
    return result;
  }

  private required(
    values: readonly ExpressionValue[],
    index: number,
    node: CallNode,
  ): ExpressionValue {
    return this.requiredValue(values[index], node);
  }

  private requiredValue(value: ExpressionValue | undefined, node: CallNode): ExpressionValue {
    if (value === undefined) {
      this.fail("expression.invalid-arity", "Argumento obrigatório ausente.", node);
    }
    return value;
  }

  private index(node: IndexNode): ExpressionValue {
    const target = this.evaluate(node.target);
    const index = this.evaluate(node.index);
    if (!Array.isArray(target)) {
      this.fail("expression.type", "Somente vetores aceitam índice.", node.target);
    }
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this.fail("expression.index", "O índice deve ser um número inteiro.", node.index);
    }
    const value = target[index];
    if (value === undefined) {
      this.fail(
        "expression.index",
        `Índice ${index} fora do vetor de tamanho ${target.length}.`,
        node.index,
      );
    }
    return value;
  }

  assertFinite(value: number, node: NodeBase): number {
    if (!Number.isFinite(value)) {
      this.fail("expression.non-finite", "A operação produziu um número não finito.", node);
    }
    return value;
  }

  fail(code: ExpressionDiagnosticCode, message: string, node: NodeBase): never {
    throw new ExpressionFault(diagnostic(code, message, node.start, node.end));
  }
}

function mapNumeric(
  value: ExpressionValue,
  operation: (input: number) => number,
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): ExpressionValue {
  if (typeof value === "number") return evaluator.assertFinite(operation(value), node);
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => mapNumeric(entry, operation, node, evaluator)));
  }
  evaluator.fail("expression.type", "A operação exige número ou vetor numérico.", node);
}

function numericBinary(
  left: ExpressionValue,
  right: ExpressionValue,
  operation: (a: number, b: number) => number,
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): ExpressionValue {
  if (typeof left === "number" && typeof right === "number") {
    return evaluator.assertFinite(operation(left, right), node);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      evaluator.fail("expression.type", "Vetores da operação devem ter o mesmo tamanho.", node);
    }
    return Object.freeze(
      left.map((entry, index) =>
        numericBinary(entry, right[index] as ExpressionValue, operation, node, evaluator),
      ),
    );
  }
  if (Array.isArray(left) && typeof right === "number") {
    return Object.freeze(
      left.map((entry) => numericBinary(entry, right, operation, node, evaluator)),
    );
  }
  if (typeof left === "number" && Array.isArray(right)) {
    return Object.freeze(
      right.map((entry) => numericBinary(left, entry, operation, node, evaluator)),
    );
  }
  evaluator.fail("expression.type", "A operação exige números ou vetores numéricos.", node);
}

function numericTernary(
  first: ExpressionValue,
  second: ExpressionValue,
  third: ExpressionValue,
  operation: (a: number, b: number, c: number) => number,
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): ExpressionValue {
  if (typeof first === "number" && typeof second === "number" && typeof third === "number") {
    return evaluator.assertFinite(operation(first, second, third), node);
  }

  const vector = Array.isArray(first)
    ? first
    : Array.isArray(second)
      ? second
      : Array.isArray(third)
        ? third
        : null;
  if (vector === null) {
    evaluator.fail("expression.type", "A operação exige números ou vetores numéricos.", node);
  }

  for (const value of [first, second, third]) {
    if (Array.isArray(value) && value.length !== vector.length) {
      evaluator.fail("expression.type", "Vetores da operação devem ter o mesmo tamanho.", node);
    }
    if (!Array.isArray(value) && typeof value !== "number") {
      evaluator.fail("expression.type", "A operação exige números ou vetores numéricos.", node);
    }
  }

  return Object.freeze(
    vector.map((_entry, index) =>
      numericTernary(
        vectorEntry(first, index, node, evaluator),
        vectorEntry(second, index, node, evaluator),
        vectorEntry(third, index, node, evaluator),
        operation,
        node,
        evaluator,
      ),
    ),
  );
}

function vectorEntry(
  value: ExpressionValue,
  index: number,
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): ExpressionValue {
  if (!Array.isArray(value)) return value;
  const entry = value[index];
  if (entry === undefined) {
    evaluator.fail("expression.type", "Vetor esparso não é permitido.", node);
  }
  return entry;
}

function vectorLength(
  value: ExpressionValue,
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): number {
  if (typeof value === "number") return Math.abs(value);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number")) {
    evaluator.fail("expression.type", "length exige um número ou vetor plano numérico.", node);
  }
  const sum = value.reduce((total, entry) => total + (entry as number) * (entry as number), 0);
  return evaluator.assertFinite(Math.sqrt(sum), node);
}

function compareValues(
  left: ExpressionValue,
  right: ExpressionValue,
  operator: "<" | "<=" | ">" | ">=",
  node: NodeBase,
  evaluator: ExpressionEvaluator,
): boolean {
  if (!(
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string")
  )) {
    evaluator.fail(
      "expression.type",
      "Comparações de ordem exigem dois números ou duas strings.",
      node,
    );
  }
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
}

function equalValue(left: ExpressionValue, right: ExpressionValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => equalValue(entry, right[index] as ExpressionValue))
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) return false;
  return left === right;
}

function validateContext(context: ExpressionContext): ExpressionDiagnostic | null {
  if (!Number.isFinite(context.frame)) {
    return diagnostic("expression.non-finite", "O contexto da expressão exige frame finito.", 0, 0);
  }
  return validateValueSize(context.value, { start: 0, end: 0 });
}

function validateValueSize(value: ExpressionValue, range: NodeBase): ExpressionDiagnostic | null {
  let nodes = 0;
  const pending: ExpressionValue[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > MAX_VALUE_NODES) {
      return diagnostic(
        "expression.result-too-large",
        `O valor excede o limite de ${MAX_VALUE_NODES} componentes.`,
        range.start,
        range.end,
      );
    }
    if (typeof current === "number" && !Number.isFinite(current)) {
      return diagnostic(
        "expression.non-finite",
        "O valor contém número não finito.",
        range.start,
        range.end,
      );
    }
    if (typeof current === "string" && current.length > MAX_STRING_LENGTH) {
      return diagnostic(
        "expression.result-too-large",
        `Uma string excede o limite de ${MAX_STRING_LENGTH} caracteres.`,
        range.start,
        range.end,
      );
    }
    if (Array.isArray(current)) pending.push(...current);
  }
  return null;
}

function freezeNode<T extends ExpressionNode>(node: T): T {
  switch (node.kind) {
    case "array":
      node.elements.forEach(freezeNode);
      Object.freeze(node.elements);
      break;
    case "unary":
      freezeNode(node.argument);
      break;
    case "binary":
      freezeNode(node.left);
      freezeNode(node.right);
      break;
    case "conditional":
      freezeNode(node.condition);
      freezeNode(node.consequent);
      freezeNode(node.alternate);
      break;
    case "call":
      node.arguments.forEach(freezeNode);
      Object.freeze(node.arguments);
      break;
    case "index":
      freezeNode(node.target);
      freezeNode(node.index);
      break;
    case "literal":
    case "variable":
      break;
  }
  return Object.freeze(node);
}

function freezeValue(value: ExpressionValue): ExpressionValue {
  if (!Array.isArray(value)) return value;
  if (Object.isFrozen(value)) return value;
  return Object.freeze(value.map(freezeValue));
}

function diagnostic(
  code: ExpressionDiagnosticCode,
  message: string,
  start: number,
  end: number,
): ExpressionDiagnostic {
  return Object.freeze({ code, message, start, end });
}

function failed(diagnosticEntry: ExpressionDiagnostic): CompileExpressionResult {
  return Object.freeze({
    ok: false as const,
    program: null,
    diagnostics: Object.freeze([diagnosticEntry]),
  });
}

function failedEvaluation(diagnosticEntry: ExpressionDiagnostic): EvaluateExpressionResult {
  return Object.freeze({
    ok: false as const,
    value: null,
    diagnostics: Object.freeze([diagnosticEntry]),
  });
}

function tokenLabel(token: Token): string {
  if (token.kind === "eof") return "fim";
  return token.value === null ? token.kind : String(token.value);
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isIdentifierStart(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_"
  );
}

function isIdentifierPart(character: string): boolean {
  return isIdentifierStart(character) || isDigit(character);
}

function isDoubleOperator(value: string): value is "**" | "==" | "!=" | "<=" | ">=" | "&&" | "||" {
  return (
    value === "**" ||
    value === "==" ||
    value === "!=" ||
    value === "<=" ||
    value === ">=" ||
    value === "&&" ||
    value === "||"
  );
}

function isSingleToken(
  value: string,
): value is
  "(" | ")" | "[" | "]" | "," | "?" | ":" | "+" | "-" | "*" | "/" | "%" | "!" | "<" | ">" {
  return (
    value === "(" ||
    value === ")" ||
    value === "[" ||
    value === "]" ||
    value === "," ||
    value === "?" ||
    value === ":" ||
    value === "+" ||
    value === "-" ||
    value === "*" ||
    value === "/" ||
    value === "%" ||
    value === "!" ||
    value === "<" ||
    value === ">"
  );
}
