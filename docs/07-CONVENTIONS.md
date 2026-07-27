# 07 — Convenções

Regras que valem para todo o código. O objetivo é que qualquer arquivo pareça ter
sido escrito pela mesma pessoa, e que violações sejam detectadas por ferramenta,
não por revisão.

---

## 1. Workspace

pnpm workspaces + TypeScript project references.

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools"
```

Todo pacote:

```
packages/animation/
├─ package.json           name: "@theatrum/animation"
├─ tsconfig.json          extends ../../tsconfig.base.json
├─ src/
│  ├─ index.ts            ÚNICA superfície pública
│  └─ ...
└─ src/**/*.test.ts       testes ao lado do código
```

`package.json` mínimo:

```json
{
  "name": "@theatrum/animation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@theatrum/core-math": "workspace:*" }
}
```

Sem etapa de build entre pacotes durante o desenvolvimento — o Vite resolve TS
direto. Bundling acontece só no build do app.

### Regras de importação

```ts
// ✅ barrel público de camada inferior
import { evaluate } from "@theatrum/animation";

// ❌ arquivo interno de outro pacote
import { evaluate } from "@theatrum/animation/src/evaluator";

// ❌ caminho relativo cruzando pacote
import { evaluate } from "../../animation/src/evaluator";

// ✅ relativo dentro do próprio pacote
import { solveSegment } from "./segment";
```

Verificado por `eslint-plugin-import` (`no-restricted-imports`) e por
`dependency-cruiser`, cuja configuração deriva da matriz em
[02-MODULES.md](02-MODULES.md#matriz-de-dependências).

---

## 2. Nomenclatura

### Arquivos

| Tipo              | Padrão                            | Exemplo                  |
| ----------------- | --------------------------------- | ------------------------ |
| Módulo TS         | `kebab-case.ts`                   | `arc-length.ts`          |
| Componente React  | `PascalCase.tsx`                  | `TimelinePanel.tsx`      |
| Hook              | `use-kebab-case.ts`               | `use-timeline-layout.ts` |
| Teste             | `<nome>.test.ts`                  | `arc-length.test.ts`     |
| Interface de port | `<nome>.port.ts`                  | `encoder.port.ts`        |
| Registro de tipos | `<nome>.registry.ts`              | `node-types.registry.ts` |
| Shader            | `<nome>.vert.glsl` / `.frag.glsl` | `particle.vert.glsl`     |
| Barrel            | `index.ts`                        | —                        |

### Identificadores

```ts
type NodeLayout = {/* ... */}; // PascalCase; sem prefixo I
interface Renderer {
  /* ... */
} // idem
const MAX_HISTORY_ENTRIES = 500; // SCREAMING_SNAKE para constante de módulo
function buildArcLengthTable() {} // camelCase, verbo
const isVisible = true; // booleano: is/has/can/should
type NodeId = string & { __brand: "NodeId" }; // branded para IDs
```

Proibido prefixo `I` em interface. Proibido sufixo `Impl`. Proibido `Manager`,
`Helper`, `Utils` como nome de classe — se não dá um nome ao que a coisa faz, ela
faz coisas demais.

### IDs em runtime

Prefixados por tipo. Legíveis em log e em JSON.

| Prefixo | Entidade              |
| ------- | --------------------- |
| `prj_`  | projeto               |
| `cmp_`  | composição            |
| `nd_`   | nó                    |
| `kf_`   | keyframe              |
| `pth_`  | path                  |
| `ast_`  | asset                 |
| `fx_`   | instância de efeito   |
| `bhv_`  | instância de behavior |
| `act_`  | instância de action   |
| `job_`  | job de render         |

---

## 3. TypeScript

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "isolatedDeclarations": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
  },
}
```

`noUncheckedIndexedAccess` é o mais incômodo e o mais valioso: `nodes[id]` passa a
ser `Node | undefined`, forçando tratamento. Num editor onde IDs vêm de arquivo,
de plugin e de IA, isso previne uma classe inteira de crash.

### Regras

- **Nada de `any`.** `unknown` na fronteira de I/O, estreitado por Zod. Se `any`
  for inevitável, `// eslint-disable-next-line` com justificativa por escrito.
- **Nada de asserção `as`** exceto após validação por schema ou narrowing provado.
- **`readonly` por padrão** em tipos de dado. Mutabilidade é a exceção declarada.
- **Union discriminada** em vez de campos opcionais mutuamente exclusivos:

```ts
// ❌ estados impossíveis são representáveis
interface Anchor {
  space: string;
  lngLat?: Vec2;
  position?: Vec2;
}

// ✅ o tipo impede o estado inválido
type Anchor = { space: "geo"; lngLat: Vec2 } | { space: "comp"; position: Vec2 };
```

- **Branded types** para unidades que não devem se misturar:

```ts
type Frame = number & { readonly __unit: "frame" };
type Seconds = number & { readonly __unit: "seconds" };
// passar Seconds onde se espera Frame não compila
```

Esse último resolve na raiz o bug mais provável do projeto: confundir segundos com
frames num fator de 60.

---

## 4. Erros

Duas categorias, tratamento diferente.

```ts
// ESPERADO — parte do domínio. Result.
function open(path: string): Promise<Result<Project, ProjectError>>;
function parse(input: string): Result<Frame, TimeParseError>;

// BUG — invariante violada. Lança.
invariant(node.parent !== node.id, "nó não pode ser pai de si mesmo");
```

| Categoria | Exemplos                                                          | Tratamento                           |
| --------- | ----------------------------------------------------------------- | ------------------------------------ |
| Esperado  | arquivo ausente, JSON inválido, codec indisponível, lugar ambíguo | `Result<T, E>`; UI mostra mensagem   |
| Bug       | ciclo no grafo, ID duplicado, índice fora de faixa                | `invariant()`; lança; erro reportado |

Nunca `try/catch` engolindo silenciosamente. Nunca `catch (e) { console.error(e) }`
e seguir adiante — ou trata, ou propaga.

Erros de domínio são objetos, não strings:

```ts
type ProjectError =
  | { kind: "not-found"; path: string }
  | { kind: "unsupported-version"; found: number; supported: number }
  | { kind: "corrupt"; detail: string; pointer?: string }
  | { kind: "io"; cause: unknown };
```

Isso permite a UI reagir por tipo (oferecer atualização para
`unsupported-version`, oferecer recuperação para `corrupt`) em vez de mostrar
texto cru.

---

## 5. React

- **Componentes de função.** Sem classes.
- **Sem lógica de domínio em componente.** Se a regra vale fora da UI, mora num pacote.
- **Mutação só por comando:**

```tsx
// ❌
engine.document.mutate((d) => {
  d.compositions[0].nodes[id].name = value;
});

// ✅
engine.commands.dispatch({ type: "node.rename", payload: { nodeId: id, name: value } });
```

- **Leitura por selector com igualdade estrutural.** Nunca `useDocument()` inteiro:

```tsx
const name = useDocumentSelector((d) => select.node(d, nodeId)?.name);
```

- **Memoização deliberada.** `useMemo`/`useCallback` onde há custo medido, não por
  reflexo. React 19 Compiler cobre a maioria dos casos.
- **Keys estáveis** — sempre o ID da entidade, nunca o índice do array.

### Estrutura de painel

Todo painel segue o mesmo formato:

```
panels/<nome>/
├─ <Nome>Panel.tsx        casca, registro no dock, atalhos
├─ <Nome>Canvas.tsx       desenho em canvas, se aplicável
├─ use-<nome>-*.ts        hooks locais
├─ interactions.ts        gestos de mouse/teclado
└─ index.ts
```

### Canvas vs DOM

| Usar canvas               | Usar DOM                 |
| ------------------------- | ------------------------ |
| Trilhas da timeline       | Painéis, menus, diálogos |
| Graph editor de curvas    | Campos do Inspector      |
| Viewport (mapa + overlay) | Árvore do projeto        |
| Miniaturas de waveform    | Barras de ferramentas    |

Critério: mais de ~200 elementos que redesenham a 60 fps → canvas.
Ver [ADR-005](adr/ADR-005-canvas-timeline.md).

---

## 6. Testes

```
tests/
├─ e2e/                        Playwright + Electron
├─ golden/
│  ├─ projects/                fixtures .theatrum
│  ├─ frames/                  PNGs de referência
│  └─ migrations/v1/           fixtures de versão antiga
└─ perf/                       benchmarks com orçamento
```

| Nível        | Ferramenta               | Cobre                                                                          |
| ------------ | ------------------------ | ------------------------------------------------------------------------------ |
| Unidade      | Vitest                   | `core-*`, `animation`, `gis`, `document`, `scripting`                          |
| Propriedade  | Vitest + fast-check      | interpolação, arc-length, tempo, transform                                     |
| Golden frame | Vitest + canvas headless | `renderer`, `effects`                                                          |
| Integração   | Vitest                   | `engine` completo em Node, sem UI                                              |
| E2E          | Playwright               | fluxos do editor                                                               |
| Performance  | Vitest bench             | orçamentos da § 10 de [06](06-RENDER-PIPELINE.md#10-orçamentos-de-performance) |

### Testes obrigatórios por área

**Determinismo** (bloqueia merge):

```ts
it("avaliar frame 500 direto == avaliar sequencialmente até 500", () => {
  const direct = evaluate(doc, "cmp_main", 500);
  let seq!: EvaluatedScene;
  for (let f = 0; f <= 500; f++) seq = evaluate(doc, "cmp_main", f);
  expect(hashScene(direct)).toBe(hashScene(seq));
});

it("render é reproduzível em ordem aleatória de frames", async () => {
  const a = await renderFrames(doc, [0, 137, 900]);
  const b = await renderFrames(doc, [900, 0, 137]);
  expect(a).toEqual(b);
});
```

**Propriedade:**

```ts
it("arcLengthToT é monotônica", () => {
  fc.assert(
    fc.property(arbPath(), fc.array(fc.double(0, 1)), (path, ds) => {
      const table = buildArcLengthTable(path);
      const ts = ds.sort().map((d) => arcLengthToT(table, d * table.total));
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
    }),
  );
});
```

**Round-trip:**

```ts
it("save → open == documento original", async () => {
  await io.save(doc, tmp);
  const reopened = await io.open(tmp);
  expect(reopened.value.document).toEqual(doc);
});

it("save é determinístico byte a byte", async () => {
  await io.save(doc, a);
  await io.save(doc, b);
  expect(await readFile(a)).toEqual(await readFile(b));
});
```

Golden frames guardam PNG de referência e comparam com tolerância por pixel
(≤ 2/255 por canal, ≤ 0,1% dos pixels), para absorver diferença de driver sem
deixar passar regressão real.

---

## 7. Lint e formatação

```
eslint.config.js          flat config
prettier.config.cjs       printWidth 100, sem ponto e vírgula opcional
.dependency-cruiser.cjs   camadas
```

### Regras customizadas

Escritas para este projeto, em `tools/eslint-rules/`.

```js
// no-nondeterminism
// Proíbe Date.now, performance.now, new Date, Math.random em packages/*
// exceto em core-utils/prng.ts (a implementação) e em testes.

// no-direct-document-mutation
// Proíbe .mutate( fora de packages/commands/**

// enforce-barrel-imports
// Proíbe import de @theatrum/*/src/**

// no-cross-layer-import
// Deriva da matriz de dependências; falha em import de camada ≥
```

`no-nondeterminism` é a que mais paga o investimento: sem ela, um
`Math.random()` bem-intencionado num efeito novo quebra o export, e a
descoberta acontece semanas depois.

### Scripts

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build && electron-builder",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint . && prettier --check .",
    "lint:arch": "depcruise packages apps --config",
    "test": "vitest run",
    "test:golden": "vitest run --project golden",
    "test:perf": "vitest bench",
    "gen:schema": "tsx tools/gen-schema.ts",
    "check": "pnpm typecheck && pnpm lint && pnpm lint:arch && pnpm test"
  }
}
```

`pnpm check` é o portão. Roda antes de qualquer commit.

---

## 8. Comentários

Comentar **por quê**, não **o quê**.

```ts
// ❌ repete o código
// incrementa o contador
count++;

// ✅ explica a decisão
// Zoom é logarítmico no MapLibre: interpolar linearmente o valor de zoom
// dá aproximação de aparência natural. Interpolar a escala linearmente
// causaria aceleração visível no fim do movimento.
const zoom = lerp(a.zoom, b.zoom, t);
```

JSDoc em toda API pública exportada de um barrel. Corpo de função privada, só
onde a intenção não é óbvia.

Marcadores:

| Marcador           | Significado                                           |
| ------------------ | ----------------------------------------------------- |
| `// TODO(fase-7):` | Trabalho planejado, com fase                          |
| `// HACK:`         | Solução consciente com justificativa obrigatória      |
| `// PERF:`         | Escrito assim por medição — não "simplificar"         |
| `// DETERMINISM:`  | Toca no invariante de determinismo; cuidado ao editar |
| `// INVARIANT:`    | Pressuposto que o código depende                      |

`// PERF:` e `// DETERMINISM:` existem porque são exatamente os lugares onde uma
"limpeza" bem-intencionada reintroduz um bug já resolvido.

---

## 9. Git

Repositório ainda não inicializado. Quando for:

```
.gitignore:
  node_modules/  dist/  out/  .vite/
  data/basemap/*.pmtiles      # centenas de MB — baixados por tools/fetch-data.ts
  tests/golden/frames/*.actual.png
  *.theatrum-recovery
```

Commits em português, imperativo, com escopo:

```
feat(animation): interpolação bezier temporal com solver Newton-Raphson
fix(export): aguardar geração de settle correta antes de capturar
perf(timeline): desenhar keyframes em canvas com culling por viewport
docs(adr): registrar decisão de composição mapa+overlay
refactor(scene-graph): mover resolução de anchor para o registry
test(gis): propriedade de monotonicidade em arc-length
```

Uma fase = uma branch. Merge só com `pnpm check` verde.

Os `.pmtiles` ficam fora do repositório por tamanho — `tools/fetch-data.ts` baixa
e verifica hash. É o único momento do projeto que toca a rede, e é explícito.

---

## 10. Acessibilidade e ergonomia

Uso interno não é desculpa para interface ruim — o operador vai passar centenas de
horas aqui.

- **Todo comando tem atalho.** Mapa de teclas configurável em JSON.
- **Atalhos seguem o After Effects** onde há equivalente: `V` seleção, `G` caneta,
  `U` revelar keyframes, `Shift+F3` graph editor, `[` `]` trim, `N` `B` work area.
- **Setas movem 1 px, `Shift+Setas` movem 10 px.** Convenção universal.
- **Arrastar número em campo numérico** (scrub) em todo campo de valor.
- **Contraste mínimo 4,5:1** para texto — trabalho em tela escura por horas.
- **Nenhuma cor como único portador de informação.** Facções também se distinguem
  por padrão de hachura ou símbolo.
- **Foco visível sempre.** Navegação por teclado em todos os painéis.
- **Nada de animação de UI acima de 200 ms.** Ferramenta profissional não deve
  fazer o usuário esperar transição.
- **Undo cobre tudo.** Incluindo importar Scene Script, aplicar preset, bake de
  Action. Se uma operação não é reversível, ela pede confirmação.

O último item é o mais importante do ponto de vista de confiança: um usuário que
sabe que `Ctrl+Z` sempre funciona experimenta mais e trabalha mais rápido.
