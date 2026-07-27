/**
 * Expansão dos efeitos de um nó no que o renderer entende.
 *
 * Efeito vive **no nó**, não é um tipo de nó. A união `EffectSpec` é discriminada
 * porque os dois lados tomam caminhos diferentes daqui:
 *
 * - **Partícula** vira um nó sintético de tela, inserido logo depois do nó dono na
 *   ordem de desenho, com o buffer nas props. O renderer não sabe o que é uma
 *   explosão: só desenha a primitiva `particles`.
 * - **Filtro** vira entrada na cadeia do próprio nó dono, no `layout.filters`. Não
 *   ganha nó: é passe de imagem sobre pixel que já existe.
 *
 * A composição acontece aqui, no aplicativo, pelo mesmo motivo do passe de
 * comportamentos: manter o renderer genérico e o pacote de efeitos sem
 * conhecimento de cena.
 */

import type { EvaluatedScene } from "@theatrum/animation";
import {
  effectSeed,
  particleDrawProps,
  particleNodeId,
  type EffectRegistry,
} from "@theatrum/effects";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { Composition } from "@theatrum/schema";
import type { ScreenFilter, ScreenNode, ScreenScene } from "@theatrum/renderer";

export interface ParticleExpansion {
  readonly scene: ScreenScene;
  /** Instâncias que não puderam contribuir, com motivo. */
  readonly diagnostics: readonly {
    readonly nodeId: string;
    readonly effectId: string;
    readonly type: string;
    readonly message: string;
  }[];
  readonly particleNodes: number;
  readonly particles: number;
  readonly filters: number;
  /** Recortes ativos no frame, contados para o painel de depuração. */
  readonly mattes: number;
}

/**
 * Recorte cuja origem não está no frame.
 *
 * O backend deixa o nó inteiro quando isso acontece — some o recorte, não o nó —
 * mas o usuário precisa saber, porque a causa costuma ser fora do alcance visual:
 * o nó de origem saiu do `timeRange`, foi desligado, ou ficou de fora por solo.
 */
function matteDiagnostics(screen: ScreenScene): {
  readonly diagnostics: readonly {
    readonly nodeId: string;
    readonly effectId: string;
    readonly type: string;
    readonly message: string;
  }[];
  readonly mattes: number;
} {
  const diagnostics: {
    nodeId: string;
    effectId: string;
    type: string;
    message: string;
  }[] = [];
  let mattes = 0;
  for (const nodeId of screen.drawOrder) {
    const matte = screen.nodes.get(nodeId)?.layout.matte;
    if (matte === undefined) continue;
    mattes += 1;
    if (screen.nodes.has(matte.source)) continue;
    diagnostics.push({
      nodeId,
      effectId: "trackMatte",
      type: matte.mode,
      message: `A origem de recorte "${matte.source}" não está neste frame; o nó desenha inteiro.`,
    });
  }
  return { diagnostics: Object.freeze(diagnostics), mattes };
}

/**
 * Acrescenta um nó de partículas por emissor habilitado, imediatamente depois do
 * nó dono na ordem de desenho — a nuvem cobre o objeto que a emitiu — e anexa os
 * filtros habilitados à cadeia do próprio nó dono.
 */
export function expandParticleEffects(
  screen: ScreenScene,
  evaluated: EvaluatedScene,
  layout: LayoutScreenScene,
  composition: Composition,
  registry: EffectRegistry,
): ParticleExpansion {
  // O recorte é independente dos efeitos: é conferido antes, para valer mesmo em
  // cena sem nenhum efeito.
  const matte = matteDiagnostics(screen);

  const owners = screen.drawOrder.filter((nodeId) => {
    const source = composition.nodes[stripPrecompPrefix(nodeId)];
    return source !== undefined && source.effects.length > 0;
  });
  if (owners.length === 0) {
    return Object.freeze({
      scene: screen,
      diagnostics: matte.diagnostics,
      particleNodes: 0,
      particles: 0,
      filters: 0,
      mattes: matte.mattes,
    });
  }

  const nodes = new Map(screen.nodes);
  const drawOrder: string[] = [];
  const mutableDiagnostics: {
    nodeId: string;
    effectId: string;
    type: string;
    message: string;
  }[] = [...matte.diagnostics];
  let particleNodes = 0;
  let particles = 0;
  let filterCount = 0;

  for (const nodeId of screen.drawOrder) {
    drawOrder.push(nodeId);
    const source = composition.nodes[stripPrecompPrefix(nodeId)];
    const host = screen.nodes.get(nodeId);
    const hostLayout = layout.layouts.get(nodeId);
    const hostEvaluated = evaluated.nodes.get(nodeId);
    if (source === undefined || host === undefined || hostLayout === undefined) continue;
    if (source.effects.length === 0) continue;
    // Nó invisível não emite: seguir emitindo custaria GPU por nada.
    if (hostEvaluated?.visible !== true) continue;

    const hostFilters: ScreenFilter[] = [];

    // Os params vêm de `evaluate`, não do documento: é o que faz keyframe em
    // parâmetro de efeito animar de verdade. `enabled` e ordem seguem o documento.
    const evaluatedEffects = new Map(
      (hostEvaluated.effects ?? []).map((effect) => [effect.id, effect]),
    );

    for (const effect of source.effects) {
      const seed = effectSeed(composition.seed, source.id, effect.id);
      const resolution = registry.resolve(
        evaluatedEffects.get(effect.id) ?? effect,
        seed,
        composition.fps,
      );
      if (resolution.status === "disabled") continue;
      if (resolution.status === "unknown-type") {
        mutableDiagnostics.push({
          nodeId,
          effectId: effect.id,
          type: effect.type,
          message: `Efeito não registrado: "${effect.type}".`,
        });
        continue;
      }
      if (resolution.status === "invalid-params") {
        mutableDiagnostics.push({
          nodeId,
          effectId: effect.id,
          type: effect.type,
          message: resolution.message,
        });
        continue;
      }

      if (resolution.spec.kind === "filter") {
        // Filtro não gera nó: entra na cadeia do dono, na ordem da lista de
        // efeitos, e o backend aplica cada passe sobre a saída do anterior.
        hostFilters.push(resolution.spec.filter);
        filterCount += 1;
        continue;
      }

      // O tempo do efeito começa quando o nó entra em cena.
      const localFrame = screen.frame - source.timeRange.in;
      const props = particleDrawProps(resolution.spec.particles, localFrame, hostEvaluated.opacity);
      const id = particleNodeId(nodeId, effect);
      const node: ScreenNode = {
        id,
        type: "effect.particles",
        slot: host.slot,
        props: props as unknown as Readonly<Record<string, unknown>>,
        layout: {
          // A nuvem herda a matriz do nó dono, então segue a âncora geográfica —
          // mas ignora escala de tamanho, porque tamanho de partícula é próprio.
          matrix: hostLayout.matrix,
          size: [1, 1],
          opacity: 1,
          visible: true,
          blendMode: "normal",
        },
      };
      nodes.set(id, node);
      drawOrder.push(id);
      particleNodes += 1;
      particles += props.count;
    }

    if (hostFilters.length > 0) {
      // A cadeia é do nó dono, então o nó é reposto com o layout acrescido — a
      // nuvem de partículas segue fora dela, porque é outro nó.
      nodes.set(nodeId, {
        ...host,
        layout: { ...host.layout, filters: Object.freeze(hostFilters) },
      });
    }
  }

  return Object.freeze({
    scene: Object.freeze({ ...screen, nodes, drawOrder: Object.freeze(drawOrder) }),
    diagnostics: Object.freeze(mutableDiagnostics),
    particleNodes,
    particles,
    filters: filterCount,
    mattes: matte.mattes,
  });
}

/** Nó vindo de pré-composição tem id `precomp/filho`; o efeito vive no filho. */
function stripPrecompPrefix(nodeId: string): string {
  const slash = nodeId.lastIndexOf("/");
  return slash < 0 ? nodeId : nodeId.slice(slash + 1);
}
