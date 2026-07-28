# 02 — Módulos

Cada módulo é um pacote do workspace com `src/index.ts` como única superfície
pública. Importar `@theatrum/animation/src/interpolate` é erro de lint.

Formato de cada entrada: **responsabilidade** (uma frase), **API pública**
(assinaturas essenciais), **depende de**, **invariantes** (o que nunca pode
acontecer).

---

# L0 — Núcleo

Zero dependências externas além de TypeScript. Nenhum acesso a DOM, GPU, rede ou
disco. 100% testável em Node puro. Este é o único código que provavelmente nunca
vai mudar.

## `core-math`

**Responsabilidade.** Geometria, curvas e álgebra linear necessárias ao motor.

```ts
// Vetores e matrizes (row-major, compatível com WebGL após transpose)
type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Mat2D = readonly [number, number, number, number, number, number]; // a b c d e f

const mat2d: {
  identity(): Mat2D;
  compose(t: Transform2D): Mat2D;
  multiply(a: Mat2D, b: Mat2D): Mat2D;
  invert(m: Mat2D): Mat2D | null;
  applyPoint(m: Mat2D, p: Vec2): Vec2;
  decompose(m: Mat2D): Transform2D;
};

// Bezier temporal (easing) — usado na interpolação de keyframes
function cubicBezierEase(p1: Vec2, p2: Vec2): (x: number) => number;
function solveBezierX(p1: Vec2, p2: Vec2, x: number, epsilon?: number): number;

// Bezier espacial — usado em paths e formas
interface CubicSegment {
  p0: Vec2;
  c0: Vec2;
  c1: Vec2;
  p1: Vec2;
}
function sampleCubic(s: CubicSegment, t: number): Vec2;
function cubicTangent(s: CubicSegment, t: number): Vec2;
function cubicLength(s: CubicSegment, samples?: number): number;
function splitCubic(s: CubicSegment, t: number): [CubicSegment, CubicSegment];

// Reparametrização por comprimento de arco — velocidade constante ao longo de path
interface ArcLengthTable {
  readonly total: number;
  readonly samples: Float64Array;
}
function buildArcLengthTable(segs: readonly CubicSegment[], resolution?: number): ArcLengthTable;
function arcLengthToT(table: ArcLengthTable, distance: number): number;

// Utilidades
function lerp(a: number, b: number, t: number): number;
function clamp(v: number, min: number, max: number): number;
function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
function shortestAngleDelta(from: number, to: number): number;
function smoothDamp(current: number, target: number, state: DampState, dt: number): number;
```

**Depende de.** Nada.

**Invariantes.**

- Todas as funções são puras e livres de alocação em caminho quente (recebem
  buffer de saída quando aplicável).
- Nenhuma função consulta tempo real, aleatoriedade ou ambiente.
- `arcLengthToT` é monotônica — pré-requisito para movimento sem tranco.

**Nota sobre bezier temporal vs espacial.** São coisas diferentes e a confusão
entre as duas é a causa mais comum de animação com aparência errada. Temporal
controla _quando_ (easing, eixo x = tempo normalizado). Espacial controla _onde_
(a curva no plano). Um objeto pode ter easing suave numa trajetória em linha reta,
ou velocidade linear numa curva fechada. Ambas coexistem em
[03-DATA-MODEL.md § 5](03-DATA-MODEL.md#5-interpolação).

---

## `core-time`

**Responsabilidade.** Tempo como frame inteiro, com conversões e parsing.

```ts
type Frame = number; // inteiro; unidade canônica
type Seconds = number; // derivado; nunca persistido como tempo de keyframe

interface TimeBase {
  readonly fps: number;
  readonly dropFrame: boolean;
}

const time: {
  framesToSeconds(f: Frame, tb: TimeBase): Seconds;
  secondsToFrames(s: Seconds, tb: TimeBase): Frame; // arredonda half-up
  format(f: Frame, tb: TimeBase, style?: TimecodeStyle): string; // "00:01:23:14"
  parse(input: string, tb: TimeBase): Result<Frame, TimeParseError>;
};

/**
 * Aceita: "90" (frames) · "90f" · "2.5s" · "1m30s" · "0:02" (m:s)
 *         "00:01:23:14" (hh:mm:ss:ff) · "1:23.500" (m:s.ms)
 * Formatos ambíguos são resolvidos por regra documentada, nunca por heurística.
 */
```

**Depende de.** `core-utils` (para `Result`).

**Invariantes.**

- Tempo de keyframe é sempre inteiro. Valores fracionários vêm de subframe
  sampling (motion blur) e nunca são persistidos.
- `parse` nunca lança; devolve `Result`. Entrada vem de humano e de LLM.
- Conversão é sempre explícita: proibido passar `Seconds` onde se espera `Frame`.
  Garantido por branded types em modo estrito.

Por que frames e não segundos: [ADR-004](adr/ADR-004-time-in-frames.md).

---

## `core-utils`

**Responsabilidade.** Primitivos transversais.

```ts
// Erros esperados vs bugs
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
function invariant(cond: unknown, msg: string): asserts cond; // bug → lança

// IDs — prefixados por tipo, legíveis, estáveis
function makeId(prefix: IdPrefix): string; // "nd_7f3a2b", "kf_...", "cmp_..."

// Hash determinístico de conteúdo — chave de cache, dedup de asset
function hash32(input: string | ArrayBufferView): number;
function hashObject(value: unknown): string; // ordena chaves; estável

// PRNG determinístico — a ÚNICA fonte de aleatoriedade permitida
interface Rng {
  next(): number;
  int(max: number): number;
  range(a: number, b: number): number;
}
function createRng(seed: number): Rng; // PCG32
function hashSeed(...parts: (string | number)[]): number; // seed composta

// Event bus tipado
function createEventBus<M extends Record<string, unknown>>(): EventBus<M>;

// Descarte
interface Disposable {
  dispose(): void;
}
function disposeAll(...d: Disposable[]): void;

// Log com escopo
function createLogger(scope: string): Logger;
```

**Depende de.** Nada.

**Invariantes.**

- `createRng` é a única origem de aleatoriedade no sistema inteiro. `Math.random()`
  é proibido por lint em todos os pacotes.
- `makeId` só é chamado em camada de comando/importação — nunca durante avaliação
  ou render (geraria ID novo por frame).
- `hashObject` é estável entre execuções e entre plataformas.

---

# L1 — Dados

## `schema`

**Responsabilidade.** Definição canônica de todo formato, em Zod, e geração do
JSON Schema para consumo por IA.

```ts
export const NodeSchema: z.ZodType<Node>;
export const CompositionSchema: z.ZodType<Composition>;
export const ProjectDocumentSchema: z.ZodType<ProjectDocument>;
export const SceneScriptSchema: z.ZodType<SceneScript>;
export const CommandSchemas: Record<CommandType, z.ZodType>;

export const SCHEMA_VERSION = 1;

// Tipos TS derivados dos schemas — nunca declarados em paralelo
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
```

**Depende de.** `core-time`, `core-utils`.

**Invariantes.**

- Os tipos TypeScript são **derivados** dos schemas Zod (`z.infer`), não escritos
  à mão. Uma única fonte de verdade; impossível divergirem.
- `tools/gen-schema.ts` exporta `schemas/*.json` (JSON Schema draft 2020-12) como
  artefato de build. É esse arquivo que se entrega a um LLM.
- Mudança incompatível exige incremento de `SCHEMA_VERSION` **e** uma migração em
  `document`. Verificado por teste.

## `document`

**Responsabilidade.** Guardar o `ProjectDocument`, aplicar mutações produzindo
patches, validar, migrar entre versões.

```ts
interface DocumentStore {
  get(): ProjectDocument; // congelado (Object.freeze em dev)
  mutate(fn: (draft: Draft<ProjectDocument>) => void): MutationResult;
  replace(doc: ProjectDocument): void; // load de projeto
  subscribe(listener: (patches: Patch[]) => void): Disposable;
}
interface MutationResult {
  patches: Patch[];
  inverse: Patch[];
}

// Acesso: seletores memoizados, nunca varredura
const select: {
  node(doc: ProjectDocument, id: string): Node | undefined;
  composition(doc: ProjectDocument, id: string): Composition | undefined;
  children(doc: ProjectDocument, id: string): readonly Node[];
  ancestors(doc: ProjectDocument, id: string): readonly Node[];
  descendants(doc: ProjectDocument, id: string): readonly Node[];
  property(doc: ProjectDocument, path: PropertyPath): AnimatableProperty | undefined;
};

// Migração
function migrate(raw: unknown): Result<ProjectDocument, MigrationError>;
function registerMigration(from: number, to: number, fn: MigrationFn): void;
```

**Depende de.** `schema`, `core-*`.

**Invariantes.**

- `get()` devolve objeto congelado. Mutação fora de `mutate()` lança em dev.
- `mutate()` não valida schema (custo alto por chamada); validação roda em
  `replace()`, no save e em modo debug por comando.
- Migrações são **encadeadas e monotônicas**: v1→v2→v3. Nunca v1→v3 direto.
  Cada migração tem teste com fixture real da versão antiga.
- O documento é acíclico. `mutate` verifica ciclos de parentesco em dev.

---

# L2 — Domínio

## `scene-graph`

**Responsabilidade.** Estrutura do grafo, hierarquia, ordem, resolução de
transformações nos dois espaços de coordenadas, e o registry de tipos de nó.

```ts
interface NodeTypeDefinition<P = unknown> {
  readonly type: string; // "unit.ground", "text.title", "shape.arrow"
  readonly category: NodeCategory; // agrupa na UI
  readonly label: string;
  readonly icon: string;
  readonly defaultProps: P;
  readonly propertySchema: z.ZodType<P>;
  readonly animatable: readonly PropertyDescriptor[]; // gera Inspector e timeline
  readonly supportsChildren: boolean;
  readonly defaultAnchorSpace: AnchorSpace;
  createRenderable(ctx: RenderContext): Renderable<P>;
}

interface NodeTypeRegistry {
  register(def: NodeTypeDefinition): Disposable;
  get(type: string): NodeTypeDefinition | undefined;
  list(category?: NodeCategory): readonly NodeTypeDefinition[];
}

// Hierarquia
function worldMatrix(scene: EvaluatedScene, nodeId: string): Mat2D;
function resolveAnchor(anchor: Anchor, proj: ProjectorPort, ctx: LayoutContext): Vec2;
function resolveSize(size: SizeSpec, proj: ProjectorPort, at: Vec2): Vec2;
function topologicalOrder(comp: Composition): readonly string[];
```

**Depende de.** `document`, `core-*`.

**Invariantes.**

- Nenhum `switch` sobre `node.type` fora do registry. Adicionar um tipo de objeto
  toca em exatamente um arquivo de registro e um de renderable.
- O Inspector e as trilhas da timeline são **gerados** a partir de
  `animatable: PropertyDescriptor[]`. Nunca escritos à mão por tipo. Se um tipo
  novo ganha uma propriedade, ela aparece na UI automaticamente.
- `topologicalOrder` é estável entre chamadas para o mesmo documento — ordem de
  desenho não pode variar.

## `animation`

**Responsabilidade.** Keyframes, interpolação e o **avaliador** — a função pura
que transforma `(documento, frame)` em cena avaliada.

```ts
function evaluate(
  doc: ProjectDocument,
  compositionId: string,
  frame: Frame,
  opts?: EvaluateOptions,
): EvaluatedScene;

interface EvaluatedScene {
  readonly frame: Frame;
  readonly camera: EvaluatedCamera;
  readonly nodes: ReadonlyMap<string, EvaluatedNode>;
  readonly drawOrder: readonly string[];
}

// Interpolação de uma propriedade
function evaluateProperty<T>(prop: AnimatableProperty<T>, frame: Frame): T;
function keyframeSegment(prop: AnimatableProperty, frame: Frame): Segment | null;

// Edição de keyframes (usada pelos handlers de comando, não muta nada aqui)
function insertKeyframe<T>(
  prop: AnimatableProperty<T>,
  frame: Frame,
  value: T,
): AnimatableProperty<T>;
function setEasing(prop: AnimatableProperty, index: number, easing: EasingSpec): AnimatableProperty;
function applyPreset(prop: AnimatableProperty, preset: EasePreset): AnimatableProperty;

// Cache
interface EvaluationCache {
  invalidate(patches: Patch[]): void;
  clear(): void;
  stats(): CacheStats;
}
```

**Depende de.** `scene-graph`, `document`, `core-*`.

**Invariantes.**

- `evaluate` é **pura**. Mesmos argumentos → resultado profundamente igual, sempre.
  Testado explicitamente: avaliar frame 500 direto e avaliar 0..500 em sequência
  produzem o mesmo objeto no frame 500.
- Sem I/O, sem GPU, sem DOM. Roda em Node, em teste, sem mock.
- Nenhuma alocação de ID. Nós sintéticos de Actions recebem ID derivado
  deterministicamente (`hashSeed(parentId, actionId, index)`).
- O cache é uma otimização transparente: desligá-lo muda apenas o desempenho.

## `gis`

**Responsabilidade.** Tudo geográfico: projeção, fontes de tile, gazetteer,
geometria em coordenadas do mundo real.

```ts
interface ProjectorPort {
  project(lngLat: Vec2, altitude?: number): Vec2; // → pixel de tela
  unproject(point: Vec2): Vec2; // → lng/lat
  metersPerPixel(atLat: number): number;
  bearingToScreenAngle(bearing: number): number;
  elevationAt(lngLat: Vec2): number | null; // terreno 3D
  snapshot(): ProjectorSnapshot; // congelado, para export
}

// Geodesia
function greatCircleInterpolate(a: Vec2, b: Vec2, t: number): Vec2;
function geodesicDistance(a: Vec2, b: Vec2): number; // metros, Haversine
function initialBearing(a: Vec2, b: Vec2): number;
function destinationPoint(from: Vec2, bearing: number, meters: number): Vec2;

// Fontes de dados
interface TileSourcePort {
  readonly id: string;
  readonly kind: "vector" | "raster" | "terrain";
  url(): string;
}

// Gazetteer — o que permite a IA escrever "Kursk, RU" em vez de coordenadas
interface GazetteerPort {
  resolve(query: string): Promise<readonly GazetteerHit[]>;
  resolveExact(query: string): GazetteerHit | undefined; // síncrono, índice em memória
}
interface GazetteerHit {
  name: string;
  country: string;
  kind: PlaceKind;
  lngLat: Vec2;
  population?: number;
  score: number;
}
```

**Depende de.** `core-math`, `core-utils`.

**Invariantes.**

- **`ProjectorPort` é a única via de projeção do sistema.** Nenhum módulo faz
  aritmética de Mercator própria. Em runtime a implementação delega ao `transform`
  do MapLibre; assim o overlay não pode desalinhar do mapa, por construção.
- `ProjectorSnapshot` é imutável e serializável — o export congela a projeção do
  frame antes do layout, garantindo que um tile carregando no meio do processo não
  mova nada.
- Nada em `gis` faz requisição de rede. Fontes de tile são descritas, não buscadas.
- Interpolação entre pontos escolhe o modelo pelo caso: `great-circle` para
  aeronaves e navios, Mercator-linear para movimento terrestre. Padrão explícito
  por tipo de unidade, jamais implícito.

## `assets`

**Responsabilidade.** Registro, resolução, carga e cache de assets; biblioteca de
unidades militares.

```ts
interface AssetRegistry {
  register(asset: AssetDescriptor): Result<AssetId, AssetError>;
  get(id: AssetId): AssetDescriptor | undefined;
  resolve(id: AssetId): Promise<LoadedAsset>; // cacheado por conteúdo
  thumbnail(id: AssetId, size: number): Promise<ImageBitmap>;
  list(filter?: AssetFilter): readonly AssetDescriptor[];
}

type AssetKind = "raster" | "svg" | "sprite-sheet" | "geojson" | "font" | "audio" | "video" | "lut";

// Biblioteca de unidades — dados, não código
interface UnitLibrary {
  categories(): readonly UnitCategory[]; // infantry, armor, air, naval, artillery...
  units(filter?: UnitFilter): readonly UnitTemplate[];
  template(id: string): UnitTemplate | undefined;
}
interface UnitTemplate {
  id: string;
  label: string;
  category: UnitCategory;
  era?: [number, number]; // permite filtrar por período histórico
  nation?: string;
  assetId: AssetId;
  defaultSize: SizeSpec;
  defaultSpeed?: number; // km/h — alimenta a duração de Actions
  silhouette?: AssetId; // variante em silhueta para mapas escuros
}
```

**Depende de.** `document`, `core-utils`.

**Invariantes.**

- Assets são **endereçados por conteúdo** (SHA-256). Importar o mesmo PNG duas
  vezes gera um único arquivo no `.theatrum`.
- Nenhum caminho absoluto no documento. Só `assets/<hash>` relativo ao container
  ou `lib:<id>` para a biblioteca embutida.
- `UnitTemplate` é dado puro (JSON em `assets/library/`). Adicionar um tanque novo
  não é mudança de código.
- `defaultSpeed` alimenta as Actions: "avançar" pode calcular duração realista a
  partir da distância geodésica do path e da velocidade da unidade.

---

# L3 — Motores

## `renderer`

**Responsabilidade.** Transformar `ScreenScene` em pixels. Abstrai PixiJS e o
backend gráfico.

```ts
interface Renderer {
  readonly backend: "webgl2" | "webgpu";
  init(surfaces: SurfaceSet): Promise<void>;
  resize(size: Vec2, pixelRatio: number): void;
  render(scene: ScreenScene, slots: readonly SlotId[]): void;
  capture(slots: readonly SlotId[]): Promise<CapturedFrame>;
  invalidate(nodeIds: readonly string[] | "all"): void;
  dispose(): void;
}

type SlotId = "below-labels" | "scene" | "above-all" | "ui-overlay";

interface Compositor {
  slot(id: SlotId): RenderTarget;
  composite(order: readonly SlotId[]): void;
  captureComposite(order: readonly SlotId[]): Promise<CapturedFrame>;
}

// Um renderable por tipo de nó — implementado junto da definição do tipo
interface Renderable<P> {
  mount(ctx: RenderContext): void;
  update(node: EvaluatedNode<P>, layout: NodeLayout): void;
  unmount(): void;
}
```

**Depende de.** `scene-graph`, `gis` (só `ProjectorPort`), `core-*`.

**Invariantes.**

- O renderer **não lê o documento**. Recebe `ScreenScene` pronto. Isso permite
  testá-lo com cena sintética e mantém a fronteira de determinismo limpa.
- Nada de PixiJS vaza pela API pública. Trocar Pixi por renderer próprio é
  reescrita interna, não mudança de contrato.
- `ui-overlay` nunca entra em `captureComposite` do export. Garantido pela lista
  de slots que o `export` monta, não por checagem condicional.
- `render()` não aloca em caminho quente. Renderables são reciclados via pool.

## `effects`

**Responsabilidade.** Partículas e filtros — explosões, fumaça, fogo, rastros,
onda de choque, faíscas — de forma **determinística**.

```ts
interface EffectDefinition<P> {
  readonly type: string;
  readonly label: string;
  readonly kind: "filter" | "particles" | "generator";
  readonly paramSchema: z.ZodType<P>;
  readonly animatable: readonly PropertyDescriptor[];
  createInstance(ctx: EffectContext): EffectInstance<P>;
}

interface EffectInstance<P> {
  /** Deve produzir a MESMA saída para o mesmo (params, frame). Sem estado acumulado. */
  apply(input: RenderTarget, params: P, frame: Frame, seed: number): RenderTarget;
  dispose(): void;
}

// Partículas analíticas — resolvidas no vertex shader
interface ParticleSystemSpec {
  count: number;
  emission: "burst" | "continuous";
  lifetime: Frame;
  seed: number;
  birth: (i: number, rng: Rng) => ParticleBirth; // avaliado uma vez, cacheado
  motion: "ballistic" | "radial" | "drift" | "trail";
}
```

**Depende de.** `renderer`, `core-math`, `core-utils`.

**Invariantes.**

- **Partículas são função fechada do tempo:** `P(i, f) = origin(i) + v₀(i)·τ + ½·a·τ²`,
  com `τ = f − birth(i)` e todos os termos derivados de `hashSeed(effectId, i)`.
  Calculado no vertex shader com `f` como uniform. Consequências: zero custo de
  CPU, scrub para trás funciona, e o export é bit-exato.
- Nenhum efeito guarda estado entre frames. Se um efeito precisasse (colisão,
  flocking), entraria como _simulação de passo fixo com cache_ — mecanismo separado,
  não previsto no escopo atual.
- Seeds derivam da identidade do nó, nunca de contador global. Duplicar uma
  explosão gera variação diferente (bom), mas cada uma é reproduzível (essencial).

## `camera`

**Responsabilidade.** Modelo de câmera geográfica, sincronização com MapLibre e
helpers cinematográficos.

```ts
interface CameraState {
  center: Vec2;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface CameraPort {
  apply(state: CameraState, mode: "jump" | "ease"): void; // export usa sempre "jump"
  current(): CameraState;
  isSettled(): boolean;
  onSettled(listener: () => void): Disposable;
}

function settle(port: CameraPort, timeoutMs: number): Promise<SettleResult>;

// Helpers de enquadramento — usados pela UI e pelas Actions
function frameBounds(bounds: GeoBounds, viewport: Vec2, padding: number): CameraState;
function framePoints(points: readonly Vec2[], viewport: Vec2, padding: number): CameraState;
function followNode(nodeId: string, offset: Vec2, damping: number): CameraBehavior;
function orbit(center: Vec2, radius: number, revolutions: number): CameraBehavior;

const CINEMATIC_PRESETS: Record<"push-in" | "pull-out" | "reveal" | "sweep" | "settle", EasingSpec>;
```

**Depende de.** `gis`, `animation`, `core-*`.

**Invariantes.**

- Em export, sempre `jump`. `ease` do MapLibre é assíncrono e dependente de tempo
  real — usá-lo no export produziria posição errada.
- Zoom é logarítmico (convenção MapLibre). Interpolar zoom linearmente dá
  aproximação com aparência natural — interpolar a _escala_ linearmente daria
  aceleração visível no fim. Documentado porque parece bug.
- `settle()` resolve `{ settled: true }` ou `{ settled: false, reason }`. Nunca
  pendura para sempre; o export precisa decidir o que fazer.

## `behaviors`

**Responsabilidade.** Comportamentos declarativos que **geram** propriedades
animadas: motion paths, auto-orientação, seguir, oscilar. E as **Action Templates**
(as "simulações").

```ts
interface BehaviorDefinition<P> {
  readonly type: string;
  readonly paramSchema: z.ZodType<P>;
  /** Contribui valores durante evaluate(). Puro. */
  contribute(node: Node, params: P, frame: Frame, ctx: BehaviorContext): PropertyContribution;
}

// Motion path
interface MotionPathParams {
  pathId: string;
  progress: AnimatableProperty<number>; // 0..1 — animável, com easing
  autoOrient: boolean;
  orientOffset: number;
  banking?: number; // inclinação em curva, para aeronaves
  interpolation: "mercator" | "great-circle";
}

// Action Templates — "simulações"
interface ActionTemplate<P> {
  readonly type: string; // "advance", "attack", "bombard", ...
  readonly label: string;
  readonly paramSchema: z.ZodType<P>;
  readonly supportsLive: boolean;
  /** Expande para nós, keyframes e efeitos. Determinístico. */
  expand(params: P, ctx: ExpansionContext): ActionExpansion;
}
interface ActionExpansion {
  durationFrames: number;
  nodes: readonly Node[];
  behaviors: readonly BehaviorPlacement[];
  keyframes: readonly KeyframeWrite[];
  diagnostics: readonly Diagnostic[];
}
```

Actions previstas: `advance`, `attack`, `bombard`, `patrol`, `retreat`,
`intercept`, `dogfight`, `missile-launch`, `airstrike`, `siege`,
`amphibious-landing`, `airdrop`, `encircle`, `frontline-shift`,
`naval-blockade`, `supply-line`.

**Depende de.** `animation`, `camera`, `effects`, `gis`, `assets`.

**Invariantes.**

- **Dois modos, uma implementação.** `live`: `expand()` roda dentro de `evaluate()`,
  a Action continua editável por parâmetro. `baked`: `expand()` roda uma vez e os
  keyframes são gravados no documento por um comando, ficando editáveis
  individualmente. Não existe caminho de código separado para os dois.
- `expand()` é puro e determinístico — IDs sintéticos derivam de
  `hashSeed(actionId, ...)`.
- Uma Action nunca é caixa-preta: "Converter em keyframes" sempre existe e
  produz resultado idêntico ao modo live.

Esse par live/baked é o que resolve a tensão real: velocidade de produção (um
clique gera 40 keyframes) sem perder controle fino (dá pra ajustar o keyframe 27).

---

# L4 — Serviços

## `commands`

**Responsabilidade.** Command Bus e histórico de undo/redo.

```ts
interface CommandBus {
  dispatch<T extends CommandType>(cmd: Command<T>): CommandResult;
  transaction(label: string, fn: () => void): CommandResult;
  register<T extends CommandType>(type: T, handler: CommandHandler<T>): Disposable;
}
interface History {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  entries(): readonly HistoryEntry[]; // alimenta o painel de histórico estilo AE
  jumpTo(index: number): void;
  clear(): void;
}
```

Famílias de comando: `node.*`, `property.*`, `keyframe.*`, `effect.*`,
`behavior.*`, `action.*`, `path.*`, `composition.*`, `camera.*`, `asset.*`,
`timeline.*`, `project.*`.

**Depende de.** `document`, `schema`, `core-utils`.

**Invariantes.**

- Todo comando é serializável. Consequência: gravar sessão, repetir, criar macro
  e importar de IA usam a mesma infraestrutura.
- Handlers são puros em relação a efeito colateral externo: mutam só o draft do
  documento. Nada de I/O dentro de handler.
- Undo restaura o documento **exatamente**. Não restaura seleção nem playhead —
  esses são estado de sessão (com exceção pragmática: a seleção é restaurada por
  conveniência, mas fora do sistema de patches).
- O histórico tem teto configurável (padrão 500 entradas) e patches são compactos
  — um projeto grande com histórico longo não estoura memória.

## `project-io`

**Responsabilidade.** Ler e escrever `.theatrum`; autosave e recuperação de crash.

```ts
interface ProjectIO {
  open(path: string): Promise<Result<OpenedProject, ProjectError>>;
  save(doc: ProjectDocument, path: string, opts?: SaveOptions): Promise<Result<void, ProjectError>>;
  saveAs(doc: ProjectDocument, path: string): Promise<Result<void, ProjectError>>;
  exportBundle(doc: ProjectDocument, path: string): Promise<Result<void, ProjectError>>; // com assets embutidos
  autosave(doc: ProjectDocument): Promise<void>;
  recoverable(): Promise<readonly RecoveryCandidate[]>;
}
```

**Depende de.** `document`, `assets`, `schema`, `FileSystemPort`.

**Invariantes.**

- Escrita atômica: grava em `.tmp`, `fsync`, renomeia. Falta de energia no meio de
  um save nunca destrói o projeto anterior.
- Ler um projeto de versão futura falha com mensagem clara. Nunca tenta adivinhar.
- Autosave é incremental e vai para pasta separada — jamais sobrescreve o arquivo
  do usuário.
- Save é determinístico: mesmo documento → mesmos bytes (chaves ordenadas, sem
  timestamp dentro do `project.json`; metadados temporais ficam no `manifest.json`).

Formato completo: [04-PROJECT-FORMAT.md](04-PROJECT-FORMAT.md).

## `export`

**Responsabilidade.** Fila de render, bombeamento de frames, codificação.

```ts
interface RenderQueue {
  enqueue(job: RenderJobSpec): JobId;
  start(id: JobId): Promise<Result<RenderReport, RenderError>>;
  cancel(id: JobId): void;
  jobs(): readonly RenderJob[];
}
interface RenderJobSpec {
  compositionId: string;
  range: [Frame, Frame];
  output: OutputSpec; // codec, container, bitrate, alpha
  resolution: Vec2;
  pixelRatio: number;
  settlePolicy: SettlePolicy; // o que fazer se o mapa não estabilizar
  onProgress?: (p: RenderProgress) => void;
}
interface FramePump {
  step(frame: Frame): Promise<CapturedFrame>;
}
```

**Depende de.** `engine` internals via injeção, `renderer`, `camera`, `EncoderPort`.

**Invariantes.**

- Um frame só é escrito depois de `settle` bem-sucedido, ou conforme a
  `settlePolicy` explícita. Nunca silenciosamente.
- Relatório final registra por frame: tempo de settle, tentativas, tamanho. Um
  export com 3 frames duvidosos é detectável.
- Buffers de frame vêm de pool. Export de 5400 frames não deve gerar pressão de GC.
- Cancelar mata o processo FFmpeg e remove arquivo parcial.

Detalhes de codec e do caminho 8K: [06-RENDER-PIPELINE.md § 7](06-RENDER-PIPELINE.md#7-codificação).

## `scripting`

**Responsabilidade.** Compilar Scene Script (formato para IA) em `ProjectDocument`.

```ts
function compileScene(script: unknown, ctx: CompileContext): CompileResult;

interface CompileResult {
  document: ProjectDocument | null;
  diagnostics: readonly Diagnostic[]; // com JSON pointer, para autocorreção por IA
}
interface Diagnostic {
  severity: "error" | "warning" | "info";
  path: string; // "/timeline/4/along"
  message: string;
  hint?: string;
  didYouMean?: readonly string[];
}

interface VerbRegistry {
  register(verb: VerbDefinition): Disposable;
  list(): readonly VerbDefinition[];
}
```

**Depende de.** `behaviors`, `document`, `schema`, `gis` (gazetteer), `assets`.

**Invariantes.**

- Compilação é determinística e offline. Nenhuma chamada de rede, nenhuma IA.
- Nunca produz documento parcialmente válido: ou compila inteiro, ou devolve
  `document: null` com diagnósticos.
- Diagnósticos carregam JSON pointer e `didYouMean` — desenhados para um LLM ler o
  erro e corrigir sozinho na segunda tentativa.
- Todo verbo do Scene Script mapeia para uma Action Template ou comando já
  existente. O compilador não tem lógica de animação própria; é tradução.

Formato: [05-SCENE-SCRIPT.md](05-SCENE-SCRIPT.md).

## `plugin-host`

**Responsabilidade.** Carregar plugins locais e expor pontos de extensão.

```ts
interface PluginHost {
  discover(dir: string): Promise<readonly PluginManifest[]>;
  load(id: string): Promise<Result<LoadedPlugin, PluginError>>;
  unload(id: string): void;
}
interface PluginApi {
  nodeTypes: NodeTypeRegistry;
  effects: EffectRegistry;
  actions: ActionRegistry;
  verbs: VerbRegistry;
  exporters: ExporterRegistry;
  commands: Pick<CommandBus, "register">;
  panels: PanelRegistry;
  mapStyles: MapStyleRegistry;
  logger: Logger;
}
```

**Depende de.** todos os registries de L2/L3.

**Invariantes.**

- Plugin só toca no sistema pela `PluginApi`. Sem acesso ao documento direto, sem
  `require` de pacote interno.
- `unload` é completo — todo registro devolve `Disposable`. Recarregar plugin em
  dev não deixa resíduo.
- Sem sandbox (uso interno, plugins são do próprio operador). Registrado como
  decisão consciente, não esquecimento.

---

# L5 — Composição

## `engine`

**Responsabilidade.** Montar tudo, gerir ciclo de vida, e ser a **única** porta de
entrada da UI.

```ts
interface Engine {
  readonly document: DocumentStore;
  readonly commands: CommandBus;
  readonly history: History;
  readonly events: EventBus<AppEvents>;
  readonly registries: Registries;
  readonly camera: CameraEngine;
  readonly renderer: Renderer;
  readonly assets: AssetRegistry;
  readonly io: ProjectIO;
  readonly renderQueue: RenderQueue;
  readonly playback: PlaybackController;

  dispose(): Promise<void>;
}

function createEngine(opts: EngineOptions): Promise<Engine>;

interface EngineOptions {
  mode: "editor" | "render"; // duas instâncias coexistem no app
  ports: { fs: FileSystemPort; encoder: EncoderFactory; tiles: TileSourcePort[]; clock: ClockPort };
  plugins?: { dir: string };
}
```

**Depende de.** L4, L3, L2, L1, L0.

**Invariantes.**

- Sem singleton. `createEngine` é chamado com `mode: "editor"` na janela do editor
  e `mode: "render"` na janela oculta. Se houvesse estado global, as duas
  instâncias se corromperiam mutuamente.
- Ordem de inicialização é explícita e a falha é reportada por etapa. Um PMTiles
  corrompido dá mensagem útil, não tela branca.
- Nenhuma dependência de React. `engine` roda em Node num teste de integração.
- `mode: "render"` não instancia nada de UI: sem gizmos, sem slot `ui-overlay`,
  sem interações.

---

# L6 — Aplicações

## `apps/editor`

React 19 + Vite. Painéis dockáveis com `dockview`.

Estrutura de painel (todos seguem o mesmo formato):

```
panels/timeline/
├─ TimelinePanel.tsx        # casca, registro no dock, atalhos
├─ TimelineCanvas.tsx       # desenho em canvas das trilhas
├─ use-timeline-layout.ts   # geometria: frame ↔ px, altura de trilha
├─ interactions.ts          # arrastar keyframe, marquee, ripple
└─ index.ts
```

**Invariantes.**

- Componente React nunca chama `document.mutate()`. Só `engine.commands.dispatch()`.
- Componente nunca lê o documento inteiro. Só seletores com igualdade estrutural.
- Nada de lógica de domínio em componente. Se a regra vale fora da UI, mora num
  pacote.
- Timeline e graph editor desenham em canvas ([ADR-005](adr/ADR-005-canvas-timeline.md)).
  O resto é DOM normal.

## `apps/shell`

Electron. `main` cria janelas, menus, e implementa os adapters dos ports.
`preload` expõe superfície tipada por `contextBridge`.

```
shell/src/
├─ index.ts                 # barrel público: somente contratos do host
├─ main/
│  ├─ windows/{editor,render}.ts
│  ├─ services/{fs,dialog,ffmpeg,pmtiles,autosave,render-manager}.ts
│  └─ menu.ts
├─ preload/index.ts
└─ ipc/contracts.ts          # tipos compartilhados entre main e renderer
```

**Invariantes.**

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` nas duas janelas.
- Todo canal IPC é declarado em `contracts.ts` com tipo de request e response.
  Nada de `ipcRenderer.invoke("string-solta")`.
- Nenhuma lógica de domínio no `main`. Ele é adapter e gerente de processo.
- FFmpeg é sidecar empacotado com o app, invocado por caminho absoluto resolvido
  em runtime. Nunca depende de `PATH` do sistema.

---

## Matriz de dependências

Leitura: linha **pode importar** coluna.

| ↓ importa →     | core-* | schema | document | scene-graph | animation | gis | assets | renderer | effects | camera | behaviors | commands | project-io | export | scripting | plugin-host | engine |
| --------------- | ------ | ------ | -------- | ----------- | --------- | --- | ------ | -------- | ------- | ------ | --------- | -------- | ---------- | ------ | --------- | ----------- | ------ |
| **core-\***     | ~      | ·      | ·        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **schema**      | ✓      | ·      | ·        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **document**    | ✓      | ✓      | ·        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **scene-graph** | ✓      | ✓      | ✓        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **animation**   | ✓      | ✓      | ✓        | ✓           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **gis**         | ✓      | ✓      | ·        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **assets**      | ✓      | ✓      | ✓        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **renderer**    | ✓      | ✓      | ·        | ✓           | ·         | ✓   | ✓      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **effects**     | ✓      | ✓      | ·        | ✓           | ·         | ·   | ✓      | ✓        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **camera**      | ✓      | ✓      | ✓        | ·           | ✓         | ✓   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **behaviors**   | ✓      | ✓      | ✓        | ✓           | ✓         | ✓   | ✓      | ·        | ✓       | ✓      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **commands**    | ✓      | ✓      | ✓        | ✓           | ✓         | ·   | ✓      | ·        | ·       | ·      | ✓         | ·        | ·          | ·      | ·         | ·           | ·      |
| **project-io**  | ✓      | ✓      | ✓        | ·           | ·         | ·   | ✓      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **export**      | ✓      | ✓      | ✓        | ✓           | ✓         | ✓   | ·      | ✓        | ✓       | ✓      | ·         | ·        | ·          | ·      | ·         | ·           | ·      |
| **scripting**   | ✓      | ✓      | ✓        | ✓           | ✓         | ✓   | ✓      | ·        | ·       | ✓      | ✓         | ✓        | ·          | ·      | ·         | ·           | ·      |
| **plugin-host** | ✓      | ✓      | ·        | ✓           | ·         | ✓   | ✓      | ✓        | ✓       | ·      | ✓         | ✓        | ·          | ✓      | ✓         | ·           | ·      |
| **engine**      | ✓      | ✓      | ✓        | ✓           | ✓         | ✓   | ✓      | ✓        | ✓       | ✓      | ✓         | ✓        | ✓          | ✓      | ✓         | ✓           | ·      |
| **apps/\***     | ✓      | ✓      | ✓        | ·           | ·         | ·   | ·      | ·        | ·       | ·      | ·         | ·        | ·          | ·      | ·         | ·           | ✓      |

`~` = interno à camada, permitido entre `core-*`.
`apps/editor` importa tipos de L1/L2 para tipagem de props, mas comportamento só
via `engine`.

Há uma única aresta lateral de aplicação: `apps/editor → apps/shell`, restrita
ao barrel `@theatrum/shell`, que publica apenas o contrato tipado da ponte do
host. O shell nunca importa o editor, e alcançar `main/`, `preload/` ou `ipc/`
diretamente falha no lint.

Esta tabela é a fonte de verdade do `.dependency-cruiser.cjs`. Divergência entre
os dois é bug de configuração.
