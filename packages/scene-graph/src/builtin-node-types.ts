import { ColorSchema, Vec2Schema, animatablePropertySchema } from "@theatrum/schema";
import { z } from "zod";
import type { NodeTypeDefinition, PropertyDescriptor } from "./contracts.js";
import { createNodeTypeRegistry, type NodeTypeRegistry } from "./registry.js";

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}

const StringPropertySchema = animatablePropertySchema(z.string());
const NonEmptyStringPropertySchema = animatablePropertySchema(z.string().min(1));
const NumberPropertySchema = animatablePropertySchema(z.number().finite());
const PositiveNumberPropertySchema = animatablePropertySchema(z.number().finite().positive());
const NonNegativeNumberPropertySchema = animatablePropertySchema(z.number().finite().nonnegative());
const ColorPropertySchema = animatablePropertySchema(ColorSchema);
const UnitNumberPropertySchema = animatablePropertySchema(z.number().finite().min(0).max(1));

const COMMON_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  {
    path: "anchor",
    label: "Âncora",
    kind: "anchor",
    group: "layout",
    binding: "anchor",
    animatable: false,
  },
  {
    path: "size",
    label: "Tamanho",
    kind: "size",
    group: "layout",
    binding: "size",
    animatable: false,
  },
  {
    path: "transform.position",
    label: "Posição",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    unit: "px",
  },
  {
    path: "transform.rotation",
    label: "Rotação",
    kind: "number",
    group: "transform",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "degrees",
  },
  {
    path: "transform.scale",
    label: "Escala",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.01,
    unit: "ratio",
  },
  {
    path: "transform.opacity",
    label: "Opacidade",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "percent",
  },
  {
    path: "transform.anchorPoint",
    label: "Ponto de ancoragem",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "ratio",
  },
  {
    path: "transform.skew",
    label: "Inclinação",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "degrees",
  },
]);

function property(descriptor: PropertyDescriptor): PropertyDescriptor {
  return descriptor;
}

function defineNodeType<P extends Record<string, unknown>>(
  input: Omit<NodeTypeDefinition<P>, "animatable">,
): NodeTypeDefinition<P> {
  const properties = Object.freeze(
    input.properties.map((descriptor) =>
      Object.freeze({
        ...descriptor,
        ...(descriptor.options === undefined
          ? {}
          : {
              options: Object.freeze(
                descriptor.options.map((option) => Object.freeze({ ...option })),
              ),
            }),
      }),
    ),
  );
  return Object.freeze({
    ...input,
    defaultProps: deepFreeze(input.propertySchema.parse(input.defaultProps)),
    properties,
    animatable: Object.freeze(properties.filter((descriptor) => descriptor.animatable)),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const EmptyPropsSchema = z.object({}).passthrough();

const TextPropsSchema = z
  .object({
    text: StringPropertySchema,
    fontFamily: NonEmptyStringPropertySchema,
    fontSize: PositiveNumberPropertySchema,
    fontWeight: animatablePropertySchema(z.number().int().min(100).max(900)),
    color: ColorPropertySchema,
    align: animatablePropertySchema(z.enum(["left", "center", "right"])),
    lineHeight: PositiveNumberPropertySchema,
    tracking: NumberPropertySchema,
    /**
     * Halo de legibilidade e quebra de linha (7D). Opcionais porque chegaram
     * depois: um projeto salvo antes tem texto sem elas, e exigi-las
     * transformaria toda cena antiga em erro de validação.
     */
    halo: ColorPropertySchema.optional(),
    haloWidth: NonNegativeNumberPropertySchema.optional(),
    maxWidth: NonNegativeNumberPropertySchema.optional(),
  })
  .passthrough();

const TEXT_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  property({
    path: "props.text",
    label: "Texto",
    kind: "multiline-text",
    group: "content",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.fontFamily",
    label: "Fonte",
    kind: "text",
    group: "content",
    binding: "animatable",
    animatable: false,
  }),
  property({
    path: "props.fontSize",
    label: "Tamanho da fonte",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 1,
    step: 1,
    unit: "px",
  }),
  property({
    path: "props.fontWeight",
    label: "Peso",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: false,
    min: 100,
    max: 900,
    step: 100,
  }),
  property({
    path: "props.color",
    label: "Cor",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.align",
    label: "Alinhamento",
    kind: "enum",
    group: "content",
    binding: "animatable",
    animatable: false,
    options: [
      { value: "left", label: "Esquerda" },
      { value: "center", label: "Centro" },
      { value: "right", label: "Direita" },
    ],
  }),
  property({
    path: "props.lineHeight",
    label: "Altura da linha",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 0.1,
    step: 0.05,
    unit: "ratio",
  }),
  property({
    path: "props.tracking",
    label: "Espaçamento",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "px",
  }),
  property({
    path: "props.halo",
    label: "Halo",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.haloWidth",
    label: "Espessura do halo",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.5,
    unit: "px",
  }),
  property({
    path: "props.maxWidth",
    label: "Largura máxima",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 10,
    unit: "px",
  }),
]);

const ImagePropsSchema = z
  .object({
    assetId: StringPropertySchema,
    fit: animatablePropertySchema(z.enum(["contain", "cover", "fill"])),
    tint: ColorPropertySchema,
  })
  .passthrough();

const SvgPropsSchema = z
  .object({
    assetId: StringPropertySchema,
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const LinePropsSchema = z
  .object({
    points: z.array(Vec2Schema).min(2),
    stroke: ColorPropertySchema,
    strokeWidth: PositiveNumberPropertySchema,
  })
  .passthrough();

const PolygonPropsSchema = z
  .object({
    points: z.array(Vec2Schema).min(3),
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const CirclePropsSchema = z
  .object({
    radius: PositiveNumberPropertySchema,
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const SymbolPropsSchema = z
  .object({
    iconId: StringPropertySchema,
    color: ColorPropertySchema,
    outline: ColorPropertySchema,
    outlineWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const UnitPropsSchema = z
  .object({
    assetId: StringPropertySchema,
    callsign: StringPropertySchema,
    affiliation: animatablePropertySchema(z.enum(["friendly", "hostile", "neutral", "unknown"])),
    tint: ColorPropertySchema,
    /**
     * Velocidade operacional usada por Action Templates para inferir duração.
     * Opcional para abrir projetos anteriores à Fase 7.
     */
    defaultSpeedKmh: PositiveNumberPropertySchema.optional(),
  })
  .passthrough();

const Model3dPropsSchema = z
  .object({
    assetId: StringPropertySchema,
    /** Vão máximo do modelo em metros de terreno — escala visual, não física. */
    scaleMeters: PositiveNumberPropertySchema,
    altitudeMeters: NumberPropertySchema,
    /** Correção do eixo do nariz do modelo, somada ao rumo do caminho. */
    headingOffset: NumberPropertySchema,
    /**
     * Posição no chão do palco, em metros a partir do centro (x leste, z sul).
     * Só o modo estúdio lê: no mapa quem posiciona é a âncora geográfica.
     *
     * Opcionais porque chegaram depois: um projeto salvo antes do bloco 7E tem
     * `model3d` sem elas, e exigi-las transformaria toda cena antiga em erro de
     * validação. Ausente vale zero — o centro do palco.
     */
    stageX: NumberPropertySchema.optional(),
    stageZ: NumberPropertySchema.optional(),
  })
  .passthrough();

/**
 * Palco do modo estúdio: chão infinito, luz e a câmera orbital.
 *
 * Por que a câmera é um nó e não estado do painel: keyframe. Um voo de câmera é
 * animação como qualquer outra, e o único jeito de ele ser gravado, editado na
 * timeline, desfeito e exportado de forma determinística é ele viver no
 * documento, com as mesmas propriedades animáveis de qualquer nó.
 */
const StudioStagePropsSchema = z
  .object({
    targetX: NumberPropertySchema,
    targetY: NumberPropertySchema,
    targetZ: NumberPropertySchema,
    distanceMeters: PositiveNumberPropertySchema,
    azimuthDeg: NumberPropertySchema,
    elevationDeg: NumberPropertySchema,
    fovDeg: PositiveNumberPropertySchema,
    background: ColorPropertySchema,
    floor: ColorPropertySchema,
    gridColor: ColorPropertySchema,
    gridSpacingMeters: PositiveNumberPropertySchema,
    gridOpacity: UnitNumberPropertySchema,
    keyIntensity: NonNegativeNumberPropertySchema,
    rimIntensity: NonNegativeNumberPropertySchema,
    environmentIntensity: NonNegativeNumberPropertySchema,
    /** Textura procedural do piso, somada à grade. 0 devolve piso liso. */
    floorTexture: UnitNumberPropertySchema,
    /** Sombra de contato sob cada objeto do palco. 0 desliga. */
    shadowStrength: UnitNumberPropertySchema,
    /** Gradiente radial ao preto nas bordas: a sensacao de cenario infinito. */
    vignette: UnitNumberPropertySchema,
    /**
     * Nevoa junto ao horizonte, e a cor dela.
     *
     * O pedido do dono: uma nevoa clara SEMPRE ao fundo do objeto, nunca sobrepondo.
     * Ela mora no passe de fundo do piso, que desenha antes de toda geometria com
     * teste de profundidade desligado — entao "nunca sobrepoe" e propriedade da
     * construcao, nao promessa de quem escreveu. Nevoa volumetrica de verdade seria o
     * oposto: por profundidade, lavaria o modelo junto.
     *
     * Ela tambem e o que dissolve a costura entre piso e fundo, que o dono descreveu
     * como "metade da tela cortada".
     */
    horizonHaze: UnitNumberPropertySchema,
    hazeColor: ColorPropertySchema,
    /**
     * Direcao da luz principal, e com ela a direcao da sombra.
     *
     * A sombra do palco e a silhueta do objeto projetada, e ela era calculada com a luz
     * assumida **vertical** — o que da uma mancha embaixo do objeto, nao uma sombra que
     * se estica. Com a luz aimavel a sombra passa a cair para um lado, que e metade da
     * composicao de um plano de apresentacao.
     *
     * Elevacao baixa demais faz a sombra tender ao infinito, e o projetor recua para a
     * projecao vertical em vez de cortar a silhueta.
     */
    keyAzimuthDeg: NumberPropertySchema,
    keyElevationDeg: NumberPropertySchema,
    /**
     * Tempos do roteiro de visitas (ADR-015). Não são animáveis: são parâmetros
     * de **compilação**, e o que eles produzem — os keyframes das seis props de
     * câmera acima — é que é a animação. Moram no palco porque é o palco que dona
     * a câmera que o roteiro dirige, e porque assim viajam no `.theatrum` e
     * desfazem como qualquer outra propriedade.
     */
    tourStartFrame: NonNegativeNumberPropertySchema,
    tourTravelFrames: PositiveNumberPropertySchema,
    tourHoldFrames: NonNegativeNumberPropertySchema,
  })
  .passthrough();

/**
 * Ponto de interesse do palco ([ADR-015](../../../docs/adr/ADR-015-studio-points-of-interest.md)).
 *
 * Onde a câmera para para o dono falar do míssil, da cabine, do escapamento. O
 * ponto nasce de um **clique na superfície do modelo** e mora aqui, no documento
 * — não num nó do arquivo 3D. A premissa contrária foi medida e morreu: o 2S19M1
 * tem 51 nós irmãos chamados `Object_2`…`Object_50`, agrupados por material, e
 * 20 das 49 malhas atravessam mais de 60% de um eixo do veículo. Não existe "o
 * nó da torre" para oferecer numa lista.
 *
 * **O enquadramento é absoluto, não relativo ao que a câmera estava fazendo.**
 * Distância, azimute e elevação aqui são os mesmos números que o `studio.stage`
 * já anima, então visitar um ponto é copiar seis valores — sem composição, sem
 * ambiguidade de base. Relativo obrigaria a câmera a depender de onde o roteiro
 * passou antes, e a câmera precisa continuar função pura de (documento, frame):
 * é ela que o export byte-idêntico da Fase 8 reproduz.
 */
const StudioPoiPropsSchema = z
  .object({
    /**
     * Objeto a que o ponto pertence ([ADR-016](../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
     *
     * Vazio: `pointX/Y/Z` são metros de palco, e o ponto fica onde está
     * independentemente do que o objeto faça — que é a leitura de todo ponto
     * marcado antes do ADR-016, e um uso legítimo para enquadramento amplo.
     *
     * Preenchido com o id de um `model3d`: `pointX/Y/Z` passam a ser o **espaço
     * normalizado** daquele modelo, e o ponto acompanha posição, altitude, rumo e
     * escala. É o que faz o ponto continuar no míssil quando o avião cresce.
     */
    ownerId: StringPropertySchema,
    pointX: NumberPropertySchema,
    pointY: NumberPropertySchema,
    pointZ: NumberPropertySchema,
    distanceMeters: PositiveNumberPropertySchema,
    azimuthDeg: NumberPropertySchema,
    elevationDeg: NumberPropertySchema,
  })
  .passthrough();

/**
 * Região e rio compartilham as props porque compartilham a primitiva. O que muda
 * é o padrão: região fecha e preenche, rio só traça.
 *
 * Preenchimento e contorno são **independentes de propósito**. `fillAlpha: 0` dá
 * só contorno; `strokeWidth: 0` dá só área pintada. Nenhum dos dois é o modo
 * canônico — mapa de guerra usa os dois, às vezes no mesmo nó ao longo do tempo.
 * O brilho neon em volta não é prop: é o filtro `glow` da Fase 6, que funciona
 * aqui porque o nó tem contêiner Pixi próprio (ver ADR-009).
 */
const GeoShapePropsSchema = z
  .object({
    /** Identidade na malha compilada, como `c:UKR` ou `s:BR-PR`. */
    geoId: StringPropertySchema,
    fill: ColorPropertySchema,
    fillAlpha: UnitNumberPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
    strokeAlpha: UnitNumberPropertySchema,
  })
  .passthrough();

/**
 * Rota 2D: o instrumento clássico do mapa de guerra.
 *
 * `trimStart`/`trimEnd` são a revelação animada — a seta crescendo em direção ao
 * objetivo — e medem **comprimento de arco**, não índice de vértice: um caminho
 * com vértices amontoados numa curva revelaria aos trancos se medisse por
 * vértice.
 *
 * Estilo e cabeça são independentes de propósito. Uma linha tracejada com ponta
 * de seta é um eixo de ataque previsto; a mesma rota preenchida é um avanço
 * consumado; sem ponta, é uma linha de suprimento. O mesmo nó cobre os três, e a
 * escolha é do autor — não há modo canônico.
 */
const RoutePropsSchema = z
  .object({
    /** Caminho do projeto que esta rota desenha. */
    pathId: StringPropertySchema,
    color: ColorPropertySchema,
    width: NonNegativeNumberPropertySchema,
    /** 0 desliga o tracejado e a rota vira linha contínua. */
    dashPx: NonNegativeNumberPropertySchema,
    gapPx: NonNegativeNumberPropertySchema,
    /** Anda com o padrão sem mover a rota: a "formiguinha" de marcha. */
    dashOffset: NumberPropertySchema,
    trimStart: UnitNumberPropertySchema,
    trimEnd: UnitNumberPropertySchema,
    /** 0 não desenha ponta. */
    arrowSize: NonNegativeNumberPropertySchema,
    arrowSpread: NonNegativeNumberPropertySchema,
    /** Liga a seta de avanço preenchida no lugar da linha. */
    filled: animatablePropertySchema(z.boolean()),
    fill: ColorPropertySchema,
    fillAlpha: UnitNumberPropertySchema,
    bodyWidth: NonNegativeNumberPropertySchema,
    headWidth: NonNegativeNumberPropertySchema,
    headLength: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const FrontlinePropsSchema = z
  .object({
    /**
     * GeoJSON deliberadamente embutido: a linha de frente é conteúdo autoral,
     * não uma referência ao catálogo geográfico nem a um arquivo externo.
     */
    geometry: z
      .object({
        type: z.literal("LineString"),
        coordinates: z.array(Vec2Schema).min(2),
      })
      .passthrough(),
    color: ColorPropertySchema,
    width: NonNegativeNumberPropertySchema,
    dashPx: NonNegativeNumberPropertySchema,
    gapPx: NonNegativeNumberPropertySchema,
    trimStart: UnitNumberPropertySchema,
    trimEnd: UnitNumberPropertySchema,
  })
  .passthrough();

const CalloutPropsSchema = z
  .object({
    text: StringPropertySchema,
    /** Nó que o rótulo acompanha. Vazio deixa o rótulo parado na âncora. */
    targetId: StringPropertySchema,
    /** Alternativa ao nó: ponto de um caminho, em [0,1]. */
    pathId: StringPropertySchema,
    progress: UnitNumberPropertySchema,
    offsetX: NumberPropertySchema,
    offsetY: NumberPropertySchema,
    color: ColorPropertySchema,
    fontSize: PositiveNumberPropertySchema,
    background: ColorPropertySchema,
    backgroundAlpha: UnitNumberPropertySchema,
    borderColor: ColorPropertySchema,
    borderWidth: NonNegativeNumberPropertySchema,
    cornerRadius: NonNegativeNumberPropertySchema,
    leaderWidth: NonNegativeNumberPropertySchema,
    leaderColor: ColorPropertySchema,
    /**
     * A bolinha no alvo, e a revelacao animada da anotacao.
     *
     * Pedido do dono, na ordem dele: "marcar o missil do aviao e uma animacao de
     * textbox aparecer uma bolinha uma linha ate o text box se afastando do aviao e o
     * texto aparecendo falando sobre o missel".
     *
     * As tres pecas da revelacao sao props animaveis, nao um player: o roteiro compila
     * para keyframes, do mesmo jeito que a camera do ADR-015. Assim a timeline mostra,
     * o editor de curvas ajusta, o Ctrl+Z desfaz e o export reproduz.
     */
    dotRadius: NonNegativeNumberPropertySchema,
    dotColor: ColorPropertySchema,
    leaderProgress: UnitNumberPropertySchema,
    textReveal: UnitNumberPropertySchema,
  })
  .passthrough();

const Route3dPropsSchema = z
  .object({
    /** Caminho compartilhado do projeto (`document.paths`) que a rota traça. */
    pathId: StringPropertySchema,
    color: ColorPropertySchema,
    /** Diâmetro do tubo em metros de terreno. */
    widthMeters: PositiveNumberPropertySchema,
    /** Altitude da rota inteira; some no perfil junto com `arcMeters`. */
    altitudeMeters: NumberPropertySchema,
    /** Ápice somado no meio do caminho — é isto que dá a parábola balística. */
    arcMeters: NonNegativeNumberPropertySchema,
    /** Trecho visível do caminho. Animar os dois dá desenho progressivo e rastro. */
    progressStart: NonNegativeNumberPropertySchema,
    progressEnd: NonNegativeNumberPropertySchema,
    /** Opacidade da cortina vertical até o terreno. 0 desliga. */
    curtainOpacity: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const ASSET_ID_PROPERTY = property({
  path: "props.assetId",
  label: "Asset",
  kind: "asset",
  group: "content",
  binding: "animatable",
  animatable: false,
});

const COLOR_PROPERTY = property({
  path: "props.color",
  label: "Cor",
  kind: "color",
  group: "appearance",
  binding: "animatable",
  animatable: true,
});

const STROKE_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  property({
    path: "props.stroke",
    label: "Traço",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.strokeWidth",
    label: "Espessura",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.1,
    unit: "px",
  }),
]);

const POINTS_PROPERTY = property({
  path: "props.points",
  label: "Pontos",
  kind: "points",
  group: "content",
  binding: "geometry",
  animatable: false,
});

export const GROUP_NODE_TYPE = defineNodeType({
  type: "group",
  category: "structure",
  label: "Grupo",
  icon: "layers",
  defaultProps: {},
  propertySchema: EmptyPropsSchema,
  properties: COMMON_PROPERTIES,
  supportsChildren: true,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const NULL_NODE_TYPE = defineNodeType({
  type: "null",
  category: "structure",
  label: "Objeto nulo",
  icon: "crosshair",
  defaultProps: {},
  propertySchema: EmptyPropsSchema,
  properties: COMMON_PROPERTIES,
  supportsChildren: true,
  defaultAnchorSpace: "parent",
  defaultSizeMode: "screen",
});

const PrecompPropsSchema = z
  .object({
    compositionId: StringPropertySchema,
    /** Congela o conteúdo interno no frame apontado por `timeRemap`. */
    freeze: animatablePropertySchema(z.boolean()),
  })
  .passthrough();

/**
 * Pré-composição: um nó que carrega outra composição inteira. A expansão é do
 * avaliador (`animation`), porque aninhar é operação de tempo e hierarquia — o
 * `timeRemap` do nó escolhe qual frame interno entra, e o transform dele vira o
 * pai da raiz aninhada. Aqui só vive a declaração do tipo.
 */
export const PRECOMP_NODE_TYPE = defineNodeType({
  type: "precomp",
  category: "structure",
  label: "Pré-composição",
  icon: "layers-2",
  defaultProps: {
    compositionId: animatable(""),
    freeze: animatable(false),
  },
  propertySchema: PrecompPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.compositionId",
      label: "Composição",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.freeze",
      label: "Congelar",
      kind: "boolean",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
  ],
  supportsChildren: true,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const TEXT_TITLE_NODE_TYPE = defineNodeType({
  type: "text.title",
  category: "text",
  label: "Título",
  icon: "type",
  defaultProps: {
    text: animatable("Título"),
    fontFamily: animatable("Inter"),
    fontSize: animatable(72),
    fontWeight: animatable(700),
    color: animatable("#ffffffff"),
    align: animatable("center" as const),
    lineHeight: animatable(1.1),
    tracking: animatable(0),
    // Halo nasce ligado no texto de mapa: um topônimo sem contorno sobre imagem
    // de satélite é ilegível na primeira sombra de nuvem que cruzar.
    halo: animatable("#0b1118e6"),
    haloWidth: animatable(3),
    maxWidth: animatable(0),
  },
  propertySchema: TextPropsSchema,
  properties: [...COMMON_PROPERTIES, ...TEXT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const TEXT_LABEL_NODE_TYPE = defineNodeType({
  type: "text.label",
  category: "text",
  label: "Rótulo",
  icon: "tag",
  defaultProps: {
    text: animatable("Rótulo"),
    fontFamily: animatable("Inter"),
    fontSize: animatable(24),
    fontWeight: animatable(600),
    color: animatable("#ffffffff"),
    align: animatable("center" as const),
    lineHeight: animatable(1.2),
    tracking: animatable(0),
    halo: animatable("#0b1118e6"),
    haloWidth: animatable(2),
    maxWidth: animatable(0),
  },
  propertySchema: TextPropsSchema,
  properties: [...COMMON_PROPERTIES, ...TEXT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const IMAGE_NODE_TYPE = defineNodeType({
  type: "image",
  category: "media",
  label: "Imagem",
  icon: "image",
  defaultProps: {
    assetId: animatable(""),
    fit: animatable("contain" as const),
    tint: animatable("#ffffffff"),
  },
  propertySchema: ImagePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    ASSET_ID_PROPERTY,
    property({
      path: "props.fit",
      label: "Ajuste",
      kind: "enum",
      group: "content",
      binding: "animatable",
      animatable: false,
      options: [
        { value: "contain", label: "Conter" },
        { value: "cover", label: "Cobrir" },
        { value: "fill", label: "Preencher" },
      ],
    }),
    property({
      path: "props.tint",
      label: "Tonalidade",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SVG_NODE_TYPE = defineNodeType({
  type: "svg",
  category: "media",
  label: "SVG",
  icon: "bezier-curve",
  defaultProps: {
    assetId: animatable(""),
    fill: animatable("#ffffffff"),
    stroke: animatable("#000000ff"),
    strokeWidth: animatable(0),
  },
  propertySchema: SvgPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    ASSET_ID_PROPERTY,
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SHAPE_LINE_NODE_TYPE = defineNodeType({
  type: "shape.line",
  category: "shape",
  label: "Linha",
  icon: "minus",
  defaultProps: {
    points: [
      [0, 0],
      [100, 0],
    ],
    stroke: animatable("#ffffffff"),
    strokeWidth: animatable(4),
  },
  propertySchema: LinePropsSchema,
  properties: [...COMMON_PROPERTIES, POINTS_PROPERTY, ...STROKE_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SHAPE_POLYGON_NODE_TYPE = defineNodeType({
  type: "shape.polygon",
  category: "shape",
  label: "Polígono",
  icon: "pentagon",
  defaultProps: {
    points: [
      [50, 0],
      [100, 100],
      [0, 100],
    ],
    fill: animatable("#3b82f680"),
    stroke: animatable("#60a5faff"),
    strokeWidth: animatable(2),
  },
  propertySchema: PolygonPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    POINTS_PROPERTY,
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

/**
 * Tipo escrito do zero para provar o critério 5 da Fase 4: um tipo novo toca
 * este arquivo de registro e `renderer/src/builtins.ts`. Timeline, Inspector,
 * comandos, seleção e serialização não recebem uma linha sequer.
 */
export const SHAPE_CIRCLE_NODE_TYPE = defineNodeType({
  type: "shape.circle",
  category: "shape",
  label: "Círculo",
  icon: "circle",
  defaultProps: {
    radius: animatable(48),
    fill: animatable("#3b82f680"),
    stroke: animatable("#60a5faff"),
    strokeWidth: animatable(2),
  },
  propertySchema: CirclePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.radius",
      label: "Raio",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const SYMBOL_ICON_NODE_TYPE = defineNodeType({
  type: "symbol.icon",
  category: "symbol",
  label: "Ícone",
  icon: "map-pin",
  defaultProps: {
    iconId: animatable("marker"),
    color: animatable("#ffffffff"),
    outline: animatable("#000000ff"),
    outlineWidth: animatable(1),
  },
  propertySchema: SymbolPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.iconId",
      label: "Ícone",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    COLOR_PROPERTY,
    property({
      path: "props.outline",
      label: "Contorno",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.outlineWidth",
      label: "Espessura do contorno",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.1,
      unit: "px",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

const UNIT_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  ASSET_ID_PROPERTY,
  property({
    path: "props.callsign",
    label: "Identificação",
    kind: "text",
    group: "content",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.affiliation",
    label: "Afiliação",
    kind: "enum",
    group: "content",
    binding: "animatable",
    animatable: false,
    options: [
      { value: "friendly", label: "Aliado" },
      { value: "hostile", label: "Hostil" },
      { value: "neutral", label: "Neutro" },
      { value: "unknown", label: "Desconhecido" },
    ],
  }),
  property({
    path: "props.tint",
    label: "Tonalidade",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.defaultSpeedKmh",
    label: "Velocidade operacional",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: false,
    min: 0.1,
    step: 1,
    unit: "km/h",
  }),
]);

export const UNIT_ARMOR_NODE_TYPE = defineNodeType({
  type: "unit.armor",
  category: "unit",
  label: "Blindado",
  icon: "shield",
  defaultProps: {
    assetId: animatable("lib:unit.armor.default"),
    callsign: animatable(""),
    affiliation: animatable("friendly" as const),
    tint: animatable("#ffffffff"),
    defaultSpeedKmh: animatable(45),
  },
  propertySchema: UnitPropsSchema,
  properties: [...COMMON_PROPERTIES, ...UNIT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const UNIT_INFANTRY_NODE_TYPE = defineNodeType({
  type: "unit.infantry",
  category: "unit",
  label: "Infantaria",
  icon: "person-standing",
  defaultProps: {
    assetId: animatable("lib:unit.infantry.default"),
    callsign: animatable(""),
    affiliation: animatable("friendly" as const),
    tint: animatable("#ffffffff"),
    defaultSpeedKmh: animatable(5),
  },
  propertySchema: UnitPropsSchema,
  properties: [...COMMON_PROPERTIES, ...UNIT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/**
 * Modelo 3D (GLB/glTF da Biblioteca). O Pixi não desenha nada para este tipo:
 * o visual sai da camada Three.js do viewport (`scene3d-layer.ts`), que lê a
 * âncora geo e o rumo avaliados — inclusive os do comportamento `motion-path`.
 * Export determinístico do 3D fica para a Fase 8; aqui é preview de viewport.
 */
export const MODEL3D_NODE_TYPE = defineNodeType({
  type: "model3d",
  category: "media",
  label: "Modelo 3D",
  icon: "box",
  defaultProps: {
    assetId: animatable(""),
    scaleMeters: animatable(30_000),
    altitudeMeters: animatable(0),
    headingOffset: animatable(0),
    stageX: animatable(0),
    stageZ: animatable(0),
  },
  propertySchema: Model3dPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    ASSET_ID_PROPERTY,
    property({
      path: "props.scaleMeters",
      label: "Tamanho (m)",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 1,
      step: 1000,
      unit: "meters",
    }),
    property({
      path: "props.altitudeMeters",
      label: "Altitude",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 100,
      unit: "meters",
    }),
    property({
      path: "props.headingOffset",
      label: "Correção de rumo",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 5,
      unit: "degrees",
    }),
    property({
      path: "props.stageX",
      label: "Palco · leste",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 1,
      unit: "meters",
    }),
    property({
      path: "props.stageZ",
      label: "Palco · sul",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 1,
      unit: "meters",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/**
 * Palco do modo estúdio (7E.3): o cenário infinito onde um equipamento é
 * apresentado longe de qualquer mapa.
 *
 * O nó não desenha nada no Pixi nem no mapa — ele **é** o modo. Quando existe um
 * `studio.stage` visível, o viewport troca o mapa pelo canvas do estúdio
 * ([ADR-012](../../../docs/adr/ADR-012-studio-own-canvas.md)), e os `model3d` da
 * composição passam a ser posicionados por `stageX`/`stageZ`/`altitudeMeters` em
 * metros, não por âncora geográfica.
 *
 * A câmera mora aqui, em coordenadas esféricas, porque um voo de câmera é
 * animação: alvo, distância, azimute e elevação são propriedades animáveis como
 * quaisquer outras, e a conta que as transforma em posição é pura
 * (`orbitCameraPosition`, em L0).
 *
 * Os rótulos técnicos continuam sendo `label.callout` no overlay Pixi: eles
 * seguem o nó alvo pela posição de tela, e no estúdio essa posição vem da
 * projeção 3D em vez do mapa. Nada de código novo do lado do rótulo.
 */
/**
 * Rota e seta de avanço (7C). Referencia um caminho do projeto — o mesmo que o
 * `motion-path` percorre e que o `route3d` transforma em tubo — então a rota
 * desenhada é a trajetória de verdade, não uma cópia parecida.
 *
 * A geometria (recorte, tracejado, ponta, seta gorda) sai das funções puras de
 * `@theatrum/core-math`, e a projeção do caminho geográfico é feita pelo passe
 * do viewport. Este tipo só carrega as propriedades animáveis.
 */
export const ROUTE_NODE_TYPE = defineNodeType({
  type: "route",
  category: "shape",
  label: "Rota",
  icon: "move-right",
  defaultProps: {
    pathId: animatable(""),
    color: animatable("#f2a13cff"),
    width: animatable(4),
    dashPx: animatable(0),
    gapPx: animatable(0),
    dashOffset: animatable(0),
    trimStart: animatable(0),
    trimEnd: animatable(1),
    arrowSize: animatable(22),
    arrowSpread: animatable(26),
    filled: animatable(false),
    fill: animatable("#f2a13cff"),
    fillAlpha: animatable(0.85),
    bodyWidth: animatable(18),
    headWidth: animatable(52),
    headLength: animatable(46),
  },
  propertySchema: RoutePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.pathId",
      label: "Caminho",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.filled",
      label: "Seta de avanço",
      kind: "boolean",
      group: "content",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.trimStart",
      label: "Revelar de",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "percent",
    }),
    property({
      path: "props.trimEnd",
      label: "Revelar até",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "percent",
    }),
    property({
      path: "props.color",
      label: "Cor",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.width",
      label: "Espessura",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.dashPx",
      label: "Traço",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.gapPx",
      label: "Intervalo",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.dashOffset",
      label: "Deslocamento do traço",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      step: 2,
      unit: "px",
    }),
    property({
      path: "props.arrowSize",
      label: "Ponta",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 2,
      unit: "px",
    }),
    property({
      path: "props.arrowSpread",
      label: "Abertura da ponta",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 1,
      max: 89,
      step: 2,
      unit: "degrees",
    }),
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.fillAlpha",
      label: "Opacidade do preenchimento",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.bodyWidth",
      label: "Largura do corpo",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 2,
      unit: "px",
    }),
    property({
      path: "props.headWidth",
      label: "Largura da cabeça",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 2,
      unit: "px",
    }),
    property({
      path: "props.headLength",
      label: "Comprimento da cabeça",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 2,
      unit: "px",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const STUDIO_STAGE_NODE_TYPE = defineNodeType({
  type: "studio.stage",
  category: "media",
  label: "Palco 3D",
  icon: "video",
  defaultProps: {
    targetX: animatable(0),
    targetY: animatable(0),
    targetZ: animatable(0),
    distanceMeters: animatable(40),
    azimuthDeg: animatable(35),
    elevationDeg: animatable(14),
    fovDeg: animatable(38),
    background: animatable("#0d1218ff"),
    // Piso de tom médio, não o quase-preto do fundo do mapa.
    //
    // O padrão anterior (#141a22, luminância ~10%) foi herdado da estética do
    // mapa e tornava a sombra de contato invisível: sombra funciona por
    // contraste, e num piso já quase preto não sobra para onde escurecer.
    // Medido no palco — a sombra escurecia 12% da tela e continuava ilegível.
    // Vitrine de equipamento não é fundo de mapa: o piso é a superfície em que
    // o objeto se apoia, e precisa de tom para a sombra assentar nele.
    floor: animatable("#39424fff"),
    gridColor: animatable("#5d6f84ff"),
    /**
     * Os nove valores abaixo são o **look que o dono compôs** no palco em 2026-07-28,
     * lido do documento vivo e promovido a padrão a pedido dele.
     *
     * Não são chute nem herança: cada um foi ajustado no Inspector com o palco na tela.
     * Mudar qualquer um deles "porque parece melhor" desfaz uma decisão visual tomada
     * olhando o resultado — se for preciso mexer, meça e pergunte.
     *
     * Isto muda só o que um palco **novo** traz. Documento salvo carrega os próprios
     * valores e não é afetado.
     */
    // 5 cm. Com o filtro de Nyquist do shader a grade fina desaparece em quase toda
    // distância e o que se lê é a de dez em dez (50 cm) — grade como textura de
    // superfície, não como régua.
    gridSpacingMeters: animatable(0.05),
    gridOpacity: animatable(0.55),
    keyIntensity: animatable(2.8),
    // Contraluz mais baixo que o padrão antigo: com a névoa do horizonte no máximo, o
    // halo de separação vinha do fundo e o rim em 1,8 estourava a borda do objeto.
    rimIntensity: animatable(1.1),
    // Ambiente baixo é o que deixa a luz principal desenhar forma. Em 0,75 o IBL
    // preenchia as sombras próprias do modelo e ele lia como maquete de plástico.
    environmentIntensity: animatable(0.2),
    floorTexture: animatable(1),
    shadowStrength: animatable(1),
    vignette: animatable(0.7),
    // Névoa no máximo, e numa cor bem mais escura que o cinza-azulado inicial: com
    // #8fa6bd o horizonte clareava até parecer céu de dia, e o palco é uma vitrine
    // fechada. #3c4654 dissolve a costura sem acender o fundo.
    horizonHaze: animatable(1),
    hazeColor: animatable("#3c4654ff"),
    keyAzimuthDeg: animatable(138),
    keyElevationDeg: animatable(24),
    // 30 frames de voo e 60 de pausa a 30 fps: um segundo indo, dois segundos
    // parado. Dois segundos é pouco para narrar um míssil, e é de propósito — o
    // padrão existe para o primeiro clique produzir algo que se vê inteiro sem
    // esperar, e a pausa é o número que o dono ajusta ao texto dele.
    tourStartFrame: animatable(0),
    tourTravelFrames: animatable(30),
    tourHoldFrames: animatable(60),
  },
  propertySchema: StudioStagePropsSchema,
  // Sem COMMON_PROPERTIES de proposito. O palco NAO e um objeto desenhavel: e
  // camera mais ambiente. Posicao, escala, ancora e inclinacao nao significam
  // nada nele, e `transform.opacity` era uma armadilha de verdade — o avaliador
  // deriva `visible` de `opacity > 0` (evaluate.ts), entao baixar a opacidade
  // do palco desligava o modo e trazia o MAPA de volta ao fundo. O dono achou
  // isso mexendo no Inspector. Controle que so pode causar dano nao entra.
  properties: [
    property({
      path: "props.targetX",
      label: "Alvo · leste",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.5,
      unit: "meters",
    }),
    property({
      path: "props.targetY",
      label: "Alvo · altura",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.5,
      unit: "meters",
    }),
    property({
      path: "props.targetZ",
      label: "Alvo · sul",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.5,
      unit: "meters",
    }),
    property({
      path: "props.distanceMeters",
      label: "Distância",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: 0.01,
      step: 1,
      unit: "meters",
    }),
    property({
      path: "props.azimuthDeg",
      label: "Azimute",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 5,
      unit: "degrees",
    }),
    property({
      path: "props.elevationDeg",
      label: "Elevação",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: -89,
      max: 89,
      step: 2,
      unit: "degrees",
    }),
    property({
      path: "props.fovDeg",
      label: "Campo de visão",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: 5,
      max: 120,
      step: 1,
      unit: "degrees",
    }),
    property({
      path: "props.background",
      label: "Fundo",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.floor",
      label: "Chão",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.gridColor",
      label: "Grade",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.gridSpacingMeters",
      label: "Passo da grade",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0.05,
      step: 1,
      unit: "meters",
    }),
    property({
      path: "props.gridOpacity",
      label: "Opacidade da grade",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.keyIntensity",
      label: "Luz principal",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.1,
    }),
    property({
      path: "props.rimIntensity",
      label: "Contraluz",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.1,
    }),
    property({
      path: "props.environmentIntensity",
      label: "Ambiente",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.05,
    }),
    property({
      path: "props.floorTexture",
      label: "Textura do piso",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.shadowStrength",
      label: "Sombra de contato",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.vignette",
      label: "Fechamento ao preto",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.keyAzimuthDeg",
      label: "Luz · azimute",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      step: 5,
      unit: "degrees",
    }),
    property({
      path: "props.keyElevationDeg",
      label: "Luz · elevação",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 90,
      step: 2,
      unit: "degrees",
    }),
    property({
      path: "props.horizonHaze",
      label: "Névoa no horizonte",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.hazeColor",
      label: "Cor da névoa",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    // Os três do roteiro (ADR-015). `animatable: false` de propósito: são a
    // entrada do compilador, não a animação. Uma trilha de "duração da pausa"
    // variando no tempo não teria significado — a pausa que ela descreve já
    // aconteceu, gravada nos keyframes que a compilação escreveu.
    property({
      path: "props.tourStartFrame",
      label: "Roteiro · início",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: false,
      min: 0,
      step: 1,
    }),
    property({
      path: "props.tourTravelFrames",
      label: "Roteiro · voo entre pontos",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: false,
      min: 1,
      step: 1,
    }),
    property({
      path: "props.tourHoldFrames",
      label: "Roteiro · pausa em cada ponto",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: false,
      min: 0,
      step: 1,
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

/**
 * Rota 3D: a trajetória de um caminho do projeto desenhada como tubo
 * volumétrico em altitude, não como linha colada no mapa. Igual ao `model3d`,
 * não tem primitiva Pixi — quem desenha é a camada Three.js do viewport
 * (`scene3d-layer.ts`), no mesmo depth buffer da aeronave, então rota e modelo
 * se ocluem entre si.
 *
 * A geometria vem do caminho compartilhado (`pathId`), o mesmo que o
 * `motion-path` percorre: a rota desenhada é a trajetória de verdade, não uma
 * cópia parecida. O perfil de altura é `altitudeMeters` mais um ápice senoidal
 * de `arcMeters` no meio do caminho — voo de cruzeiro é ápice zero, míssil
 * balístico é ápice grande.
 *
 * A âncora do nó não posiciona nada (o caminho já é geográfico) e existe só
 * porque todo nó tem uma; `transform.opacity` é respeitado.
 */
/** Descriptors compartilhados por região e rio: cor e opacidade separadas. */
const GEO_SHAPE_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  property({
    path: "props.geoId",
    label: "Território",
    kind: "geo-id",
    group: "content",
    binding: "animatable",
    animatable: false,
  }),
  property({
    path: "props.fill",
    label: "Preenchimento",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.fillAlpha",
    label: "Opacidade do preenchimento",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "percent",
  }),
  property({
    path: "props.stroke",
    label: "Cor do contorno",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.strokeWidth",
    label: "Espessura do contorno",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.5,
    unit: "px",
  }),
  property({
    path: "props.strokeAlpha",
    label: "Opacidade do contorno",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "percent",
  }),
]);

/**
 * País, estado ou província como nó do documento — não decoração do basemap.
 *
 * A âncora é geográfica e nasce no centro da caixa envolvente do território: os
 * anéis chegam projetados **relativos a ela**, então mover, girar ou escalar a
 * região funciona como em qualquer outro nó.
 */
export const GEO_REGION_NODE_TYPE = defineNodeType({
  type: "geo.region",
  category: "geo",
  label: "Território",
  icon: "map",
  defaultProps: {
    geoId: animatable(""),
    fill: animatable("#38bdf83d"),
    fillAlpha: animatable(0.24),
    stroke: animatable("#7dd3fcff"),
    strokeWidth: animatable(2),
    strokeAlpha: animatable(1),
  },
  propertySchema: GeoShapePropsSchema,
  properties: [...COMMON_PROPERTIES, ...GEO_SHAPE_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/** Rio: mesma primitiva, anel aberto e sem preenchimento por padrão. */
export const GEO_RIVERS_NODE_TYPE = defineNodeType({
  type: "geo.rivers",
  category: "geo",
  label: "Rio",
  icon: "waves",
  defaultProps: {
    geoId: animatable(""),
    fill: animatable("#00000000"),
    fillAlpha: animatable(0),
    stroke: animatable("#60a5faff"),
    strokeWidth: animatable(1.5),
    strokeAlpha: animatable(0.9),
  },
  propertySchema: GeoShapePropsSchema,
  properties: [...COMMON_PROPERTIES, ...GEO_SHAPE_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/**
 * Rede de estradas de um país inteiro, agrupada na compilação (ADR-011).
 *
 * Mesma primitiva do rio — anel aberto — mas a feição não é uma linha nomeada:
 * são centenas de segmentos sob um `roads:ISO`. A junção espacial que decide
 * "de quem é" cada segmento está em `tools/build-geo.ts`.
 */
export const GEO_ROADS_NODE_TYPE = defineNodeType({
  type: "geo.roads",
  category: "geo",
  label: "Estradas",
  icon: "route",
  defaultProps: {
    geoId: animatable(""),
    fill: animatable("#00000000"),
    fillAlpha: animatable(0),
    stroke: animatable("#fb923cff"),
    strokeWidth: animatable(1.5),
    strokeAlpha: animatable(0.9),
  },
  propertySchema: GeoShapePropsSchema,
  properties: [...COMMON_PROPERTIES, ...GEO_SHAPE_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/**
 * Rótulo com caixa que acompanha um objeto ou um ponto de rota.
 *
 * Duas formas de prender, e a distinção é o que o instrumento precisa:
 *
 * - **`targetId`** gruda em outro nó. O rótulo segue o objeto quadro a quadro,
 *   qualquer que seja o motivo do movimento — keyframe, comportamento, caminho.
 * - **`pathId` + `progress`** gruda num ponto do caminho. É a anotação que corre
 *   sobre o tracejado da rota, e `progress` é animável: o texto viaja com a
 *   revelação.
 *
 * `offsetX`/`offsetY` afastam a caixa do ponto, em pixels de tela, para o rótulo
 * não cobrir o que ele aponta. A linha-guia liga os dois.
 */
export const LABEL_CALLOUT_NODE_TYPE = defineNodeType({
  type: "label.callout",
  category: "text",
  label: "Rótulo com guia",
  icon: "message-square",
  defaultProps: {
    text: animatable("Rótulo"),
    targetId: animatable(""),
    pathId: animatable(""),
    progress: animatable(0.5),
    offsetX: animatable(72),
    offsetY: animatable(-56),
    color: animatable("#f4f7fbff"),
    fontSize: animatable(16),
    background: animatable("#0b1118e0"),
    backgroundAlpha: animatable(0.88),
    borderColor: animatable("#7dd3fcff"),
    borderWidth: animatable(1),
    cornerRadius: animatable(4),
    leaderWidth: animatable(1.5),
    leaderColor: animatable("#7dd3fcff"),
    dotRadius: animatable(4),
    dotColor: animatable("#7dd3fcff"),
    // 1 nos dois: rotulo criado a mao aparece inteiro. Esconder por padrao faria o
    // primeiro clique produzir um no invisivel, e ninguem descobre prop que precisa
    // ser ligada para o que acabou de criar aparecer.
    leaderProgress: animatable(1),
    textReveal: animatable(1),
  },
  propertySchema: CalloutPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.text",
      label: "Texto",
      kind: "multiline-text",
      group: "content",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.targetId",
      label: "Objeto alvo",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.pathId",
      label: "Caminho",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.progress",
      label: "Posição no caminho",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "ratio",
    }),
    property({
      path: "props.offsetX",
      label: "Afastamento X",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.offsetY",
      label: "Afastamento Y",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.fontSize",
      label: "Tamanho da fonte",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 1,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.color",
      label: "Cor do texto",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.background",
      label: "Fundo",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.backgroundAlpha",
      label: "Opacidade do fundo",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "percent",
    }),
    property({
      path: "props.borderColor",
      label: "Cor da borda",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.borderWidth",
      label: "Espessura da borda",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.5,
      unit: "px",
    }),
    property({
      path: "props.cornerRadius",
      label: "Raio do canto",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.leaderWidth",
      label: "Espessura da guia",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.5,
      unit: "px",
    }),
    property({
      path: "props.leaderColor",
      label: "Cor da guia",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.dotRadius",
      label: "Bolinha · raio",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.5,
      unit: "px",
    }),
    property({
      path: "props.dotColor",
      label: "Bolinha · cor",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.leaderProgress",
      label: "Guia · revelação",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
    property({
      path: "props.textReveal",
      label: "Texto · revelação",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.05,
      unit: "percent",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const GEO_FRONTLINE_NODE_TYPE = defineNodeType({
  type: "geo.frontline",
  category: "geo",
  label: "Linha de frente",
  icon: "git-commit-horizontal",
  defaultProps: {
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    },
    color: animatable("#ef4444ff"),
    width: animatable(5),
    dashPx: animatable(14),
    gapPx: animatable(10),
    trimStart: animatable(0),
    trimEnd: animatable(1),
  },
  propertySchema: FrontlinePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.geometry",
      label: "GeoJSON",
      kind: "points",
      group: "content",
      binding: "geometry",
      animatable: false,
    }),
    property({
      path: "props.color",
      label: "Cor",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.width",
      label: "Espessura",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.5,
      unit: "px",
    }),
    property({
      path: "props.trimEnd",
      label: "Revelação",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "percent",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const ROUTE3D_NODE_TYPE = defineNodeType({
  type: "route3d",
  category: "geo",
  label: "Rota 3D",
  icon: "route",
  defaultProps: {
    pathId: animatable(""),
    color: animatable("#f2a13cff"),
    widthMeters: animatable(6_000),
    altitudeMeters: animatable(0),
    arcMeters: animatable(0),
    progressStart: animatable(0),
    progressEnd: animatable(1),
    curtainOpacity: animatable(0.22),
  },
  propertySchema: Route3dPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.pathId",
      label: "Caminho",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.color",
      label: "Cor",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.widthMeters",
      label: "Espessura (m)",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 1,
      step: 500,
      unit: "meters",
    }),
    property({
      path: "props.altitudeMeters",
      label: "Altitude",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 1000,
      unit: "meters",
    }),
    property({
      path: "props.arcMeters",
      label: "Ápice do arco",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1000,
      unit: "meters",
    }),
    property({
      path: "props.progressStart",
      label: "Início do trecho",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "ratio",
    }),
    property({
      path: "props.progressEnd",
      label: "Fim do trecho",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "ratio",
    }),
    property({
      path: "props.curtainOpacity",
      label: "Cortina até o terreno",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      max: 1,
      step: 0.01,
      unit: "percent",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

/**
 * Parada da câmera de apresentação: "aqui é a cabine", "aqui é o míssil".
 *
 * Como o palco, **não** herda `COMMON_PROPERTIES`, e aqui o motivo é mais forte
 * ainda: um POI não desenha nada. Posição em pixels, escala e inclinação não
 * significam nada nele, e `transform.opacity` seria a mesma armadilha que o
 * ADR-014 pagou no palco — o avaliador deriva `visible` de `opacity > 0`
 * (`packages/animation/src/evaluate.ts`), então baixar a opacidade sumiria com o
 * ponto do palco sem uma palavra de explicação. Controle que só pode causar dano
 * não entra.
 *
 * O que este nó carrega são metros e graus, e é o roteiro que os transforma em
 * keyframes das props de câmera do `studio.stage`.
 *
 * **O nome do ponto é o nome do nó**, não uma prop. Todo nó já tem `name`, o
 * painel de camadas já o edita por duplo clique e o avaliador já o entrega em
 * `EvaluatedNode.name`. Uma `props.name` ao lado dele seriam dois campos "nome"
 * para a mesma coisa, livres para divergir — e seria o Inspector, não a lista de
 * camadas, o lugar onde o dono batizaria "Cabine".
 */
export const STUDIO_POI_NODE_TYPE = defineNodeType({
  type: "studio.poi",
  category: "media",
  label: "Ponto do palco",
  icon: "map-pin",
  defaultProps: {
    // Nasce sem dono: um ponto criado pelo botão "Adicionar nó" não veio de clique
    // em superfície nenhuma, então não há a que ancorá-lo. Quem marca no palco
    // preenche isto no mesmo comando que grava o ponto.
    ownerId: animatable(""),
    pointX: animatable(0),
    pointY: animatable(0),
    pointZ: animatable(0),
    // O padrão de enquadramento é mais perto e mais alto que o do palco (40 m,
    // 14°): um ponto de interesse existe para ser olhado de perto, e chegar num
    // ponto sem que a câmera se aproxime não é visita, é continuar parado.
    distanceMeters: animatable(12),
    azimuthDeg: animatable(35),
    elevationDeg: animatable(18),
  },
  propertySchema: StudioPoiPropsSchema,
  properties: [
    property({
      path: "props.ownerId",
      label: "Ancorado em · vazio = metros de palco",
      kind: "text",
      group: "layout",
      binding: "animatable",
      animatable: false,
    }),
    /**
     * Sem `unit`, e não por esquecimento: a unidade destes três **depende** de
     * `ownerId`. Sem dono são metros de palco; com dono são frações do vão do
     * modelo. Um rótulo fixo dizendo "metros" mentiria na metade dos casos, e
     * mentira em rótulo de unidade é como se marca um ponto no lugar errado com
     * total confiança. O painel do palco mostra o valor em metros na barra de
     * estado, onde ele é lido durante a marcação.
     */
    property({
      path: "props.pointX",
      label: "Ponto · leste",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.1,
    }),
    property({
      path: "props.pointY",
      label: "Ponto · altura",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.1,
    }),
    property({
      path: "props.pointZ",
      label: "Ponto · sul",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 0.1,
    }),
    property({
      path: "props.distanceMeters",
      label: "Distância da visita",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: 0.01,
      step: 0.5,
      unit: "meters",
    }),
    property({
      path: "props.azimuthDeg",
      label: "Azimute da visita",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      step: 5,
      unit: "degrees",
    }),
    property({
      path: "props.elevationDeg",
      label: "Elevação da visita",
      kind: "number",
      group: "layout",
      binding: "animatable",
      animatable: true,
      min: -89,
      max: 89,
      step: 2,
      unit: "degrees",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const BUILTIN_NODE_TYPE_IDS = Object.freeze([
  "group",
  "null",
  "precomp",
  "text.title",
  "text.label",
  "image",
  "svg",
  "shape.line",
  "shape.polygon",
  "shape.circle",
  "geo.region",
  "geo.rivers",
  "label.callout",
  "geo.roads",
  "symbol.icon",
  "unit.armor",
  "unit.infantry",
  "model3d",
  "route3d",
  "studio.stage",
  "route",
  "geo.frontline",
  "studio.poi",
] as const);

export type BuiltinNodeType = (typeof BUILTIN_NODE_TYPE_IDS)[number];

export const BUILTIN_NODE_TYPES: readonly NodeTypeDefinition[] = Object.freeze([
  GROUP_NODE_TYPE,
  NULL_NODE_TYPE,
  PRECOMP_NODE_TYPE,
  TEXT_TITLE_NODE_TYPE,
  TEXT_LABEL_NODE_TYPE,
  IMAGE_NODE_TYPE,
  SVG_NODE_TYPE,
  SHAPE_LINE_NODE_TYPE,
  SHAPE_POLYGON_NODE_TYPE,
  SHAPE_CIRCLE_NODE_TYPE,
  GEO_REGION_NODE_TYPE,
  GEO_RIVERS_NODE_TYPE,
  LABEL_CALLOUT_NODE_TYPE,
  GEO_ROADS_NODE_TYPE,
  SYMBOL_ICON_NODE_TYPE,
  UNIT_ARMOR_NODE_TYPE,
  UNIT_INFANTRY_NODE_TYPE,
  MODEL3D_NODE_TYPE,
  ROUTE3D_NODE_TYPE,
  STUDIO_STAGE_NODE_TYPE,
  ROUTE_NODE_TYPE,
  GEO_FRONTLINE_NODE_TYPE,
  STUDIO_POI_NODE_TYPE,
]);

export function createBuiltinNodeTypeRegistry(): NodeTypeRegistry {
  return createNodeTypeRegistry(BUILTIN_NODE_TYPES);
}
