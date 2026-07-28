/**
 * Painel do Palco 3D — o ambiente de apresentação de equipamento.
 *
 * Aba irmã do Viewport, não sobreposição nele. A razão está no
 * [ADR-014](../../../../../docs/adr/ADR-014-studio-own-panel.md): enquanto o
 * palco era um canvas empilhado dentro do Viewport com o mapa escondido por CSS,
 * qualquer coisa que zerasse `visible` no nó do palco — opacidade, `enabled`,
 * faixa de tempo, solo em outro nó — reacendia o MAPA por baixo. Modo não pode
 * ser efeito colateral de CSS sobre outro painel.
 *
 * Este painel roda o seu próprio passe de avaliação. Isso parece duplicação e não
 * é: o palco precisa da cena avaliada no frame corrente, e `evaluate` é função
 * pura — chamar duas vezes com a mesma entrada dá o mesmo resultado, e o custo é
 * o de percorrer o grafo, não de tocar GPU. O que ele NÃO faz é o resto do
 * `SceneOverlay`: sem caneta, sem marquee, sem gizmo. No palco não se desenha
 * caminho no terreno.
 *
 * Duas superfícies, na ordem: o palco 3D no fundo, o overlay Pixi por cima. É o
 * overlay que desenha os rótulos técnicos (`label.callout`) — e é por ele existir
 * aqui, e não no Viewport, que o palco é um ambiente completo em vez de um fundo.
 */

import { evaluate } from "@theatrum/animation";
import { applySceneBehaviors, createBuiltinBehaviorRegistry } from "@theatrum/behaviors";
import { mat2d, type Mat2D, type Vec2 } from "@theatrum/core-math";
import {
  createPixiRenderBackend,
  createRenderer,
  createScreenScene,
  PREVIEW_SLOT_ORDER,
  registerBuiltinRenderables,
  RenderableRegistry,
  type Renderer,
} from "@theatrum/renderer";
import { layoutScene } from "@theatrum/scene-graph";
import type { Composition } from "@theatrum/schema";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Panel } from "../../ui/index.js";
import { expandCalloutNodes } from "./callout-nodes.js";
import { createStudioProjectorPort, withStudioProjection } from "./studio-projector.js";
import {
  collectStudioModels,
  collectStudioStage,
  setActiveStudioRuntime,
  StudioSceneRuntime,
} from "./studio-scene.js";
import "./StudioViewport.css";

/** Comportamentos são puros e sem estado: uma instância por painel serve. */
const behaviorRegistry = createBuiltinBehaviorRegistry();

/**
 * Letterbox da composição no painel, igual ao Viewport: nó em espaço `comp` cai
 * no mesmo lugar relativo nos dois ambientes, e um rótulo não pula de posição ao
 * trocar de aba.
 */
function compositionToViewport(composition: Composition, viewport: Vec2): Mat2D {
  const scale = Math.min(viewport[0] / composition.width, viewport[1] / composition.height);
  return mat2d.scaling(scale, scale);
}

interface StudioDebugWindow extends Window {
  __theatrumStudio?: { readonly status: () => ReturnType<StudioSceneRuntime["status"]> };
}

export function StudioViewport(): ReactNode {
  const session = useEditorSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<StudioSceneRuntime | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  /** Sobe quando o Pixi termina de inicializar: o primeiro frame precisa dele. */
  const [rendererRevision, setRendererRevision] = useState(0);
  const [size, setSize] = useState<readonly [number, number]>([0, 0]);
  /** Bump para repintar quando o GLB termina de carregar, fora do ciclo do React. */
  const [assetRevision, setAssetRevision] = useState(0);
  const [status, setStatus] = useState("palco vazio · adicione um nó Palco 3D");

  /**
   * O contexto WebGL nasce com o painel e morre com ele.
   *
   * Não criar sob demanda ao entrar no modo, apesar dos 3,6 ms medidos no
   * ADR-012: criar dentro do passe de render faria o primeiro frame sair vazio, e
   * o ciclo criar/descartar a cada troca de composição é como se esgota o
   * orçamento de dezesseis contextos. Contexto ocioso não custa GPU — sem palco
   * na cena, `render` sai na primeira linha.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const runtime = new StudioSceneRuntime(canvas);
    runtime.onNeedsRepaint(() => setAssetRevision((value) => value + 1));
    runtimeRef.current = runtime;
    // O `settle` do export precisa contar os GLB pendentes deste painel, e quem
    // dirige o export vive no outro. Um por aplicativo é o limite declarado no
    // ADR-014; se algum dia houver dois palcos, este é o ponto que muda.
    setActiveStudioRuntime(runtime);
    if (import.meta.env.DEV) {
      (window as StudioDebugWindow).__theatrumStudio = { status: () => runtime.status() };
    }
    return () => {
      runtimeRef.current = null;
      setActiveStudioRuntime(null);
      runtime.dispose();
    };
  }, []);

  /**
   * Overlay Pixi do palco — o quarto contexto WebGL do aplicativo.
   *
   * O [ADR-012](../../../../../docs/adr/ADR-012-studio-own-canvas.md) mediu o
   * orçamento: teto de 16 no Chromium, 3,6 ms para criar, um custo único na
   * abertura. O [ADR-014](../../../../../docs/adr/ADR-014-studio-own-panel.md)
   * gastou um desses porque a alternativa era o palco não ter rótulo nenhum.
   *
   * `missingRenderable: "skip"` importa aqui mais que no Viewport: no palco há
   * tipos de nó que legitimamente não desenham (contorno de país, rota geo), e
   * eles não podem virar erro só por estarem no documento.
   */
  useEffect(() => {
    const canvas = pixiCanvasRef.current;
    if (canvas === null) return;
    const registry = new RenderableRegistry();
    const builtins = registerBuiltinRenderables(registry);
    const renderer = createRenderer({
      backend: createPixiRenderBackend({ preference: "webgl2" }),
      registry,
      missingRenderable: "skip",
    });
    let alive = true;
    void renderer
      .init({ overlay: { native: canvas } })
      .then(() => {
        if (!alive) return;
        rendererRef.current = renderer;
        setRendererRevision((value) => value + 1);
      })
      .catch((error: unknown) => {
        if (alive) {
          setStatus(`GPU indisponível · ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      alive = false;
      rendererRef.current = null;
      renderer.dispose();
      builtins.dispose();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const measure = (): void => {
      const width = Math.max(0, Math.round(container.clientWidth));
      const height = Math.max(0, Math.round(container.clientHeight));
      setSize((current) =>
        current[0] === width && current[1] === height ? current : [width, height],
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime === null || size[0] <= 0 || size[1] <= 0) return;
    const composition = session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    );
    if (composition === undefined) return;

    // Duas etapas separadas de propósito, igual ao Viewport: `evaluate` é puro e
    // não conhece comportamentos (L2 não importa L3); o passe de comportamentos
    // roda depois e produz a cena com caminhos e seguimento já resolvidos.
    const pass = applySceneBehaviors(
      evaluate(session.document, composition.id, session.playheadFrame),
      session.document,
      composition.id,
      { registry: behaviorRegistry },
    );
    const stage = collectStudioStage(pass.scene);
    const models = stage === null ? [] : collectStudioModels(pass.scene);
    // O palco desenha ANTES do layout, porque é ele quem diz onde, em pixels,
    // está cada modelo: a projeção sai da câmera orbital DESTE frame.
    runtime.render({ stage, models }, size[0], size[1]);

    const renderer = rendererRef.current;
    if (renderer !== null) {
      const viewport: Vec2 = [size[0], size[1]];
      const compToScreen = compositionToViewport(composition, viewport);
      const projector = createStudioProjectorPort(viewport, stage?.fovDeg ?? 38);
      const base = layoutScene(pass.scene, projector, {
        compToScreen,
        viewport: { x: 0, y: 0, width: size[0], height: size[1] },
      });
      const layout = stage === null ? base : withStudioProjection(base, models, runtime, viewport);
      const composed = createScreenScene(pass.scene, layout, {
        size: viewport,
        pixelRatio: Math.max(1, window.devicePixelRatio),
      });
      // Rótulo com guia (7E.2) é o que a apresentação usa para falar do míssil e
      // da cabine. O projetor geo entra como o do palco: um rótulo ancorado em
      // geografia não tem alvo aqui, e é descartado em vez de inventado.
      const callouts = expandCalloutNodes(
        composed,
        pass.scene,
        layout,
        session.document.paths,
        compToScreen,
        (lngLat) => projector.project([lngLat[0], lngLat[1]]),
      );
      renderer.render(callouts.scene, PREVIEW_SLOT_ORDER);
    }

    const report = runtime.status();
    setStatus(
      stage === null
        ? "palco vazio · adicione um nó Palco 3D"
        : report.lastError !== null
          ? `falha ao carregar modelo · ${report.lastError}`
          : report.pending > 0
            ? `carregando ${report.pending} modelo(s)…`
            : `${report.loaded} modelo(s) · ${size[0]}×${size[1]}`,
    );
  }, [
    session.document,
    session.playheadFrame,
    session.selectedCompositionId,
    size,
    assetRevision,
    rendererRevision,
  ]);

  return (
    <Panel scroll={false}>
      <div ref={containerRef} className="studio-viewport">
        <canvas ref={canvasRef} className="studio-viewport__stage" aria-hidden="true" />
        <canvas ref={pixiCanvasRef} className="studio-viewport__pixi" aria-hidden="true" />
        <p className="studio-viewport__status">{status}</p>
      </div>
    </Panel>
  );
}
