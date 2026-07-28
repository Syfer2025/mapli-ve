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
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import { expandCalloutNodes } from "./callout-nodes.js";
import {
  drawStudioMarkers,
  layoutStudioMarkers,
  markerAt,
  type StudioMarker,
} from "./studio-markers.js";
import { createStudioProjectorPort, withStudioProjection } from "./studio-projector.js";
import { compileStudioTour, documentStudioPois, documentStudioTourTiming } from "./studio-tour.js";
import {
  collectStudioModels,
  collectStudioPois,
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

/**
 * Dimensiona e pinta a superfície dos marcadores.
 *
 * O backing store acompanha o `devicePixelRatio` pelo mesmo motivo do palco: um
 * número de 11 px desenhado em resolução de CSS fica borrado em tela HiDPI, e
 * marcador ilegível não cumpre a função de dizer qual ponto é qual.
 */
function paintMarkers(
  canvas: HTMLCanvasElement | null,
  markers: readonly StudioMarker[],
  size: readonly [number, number],
  selectedId: string | null,
): void {
  if (canvas === null || size[0] <= 0 || size[1] <= 0) return;
  const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio, 2));
  const width = Math.round(size[0] * pixelRatio);
  const height = Math.round(size[1] * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return;
  drawStudioMarkers(context, markers, {
    width: size[0],
    height: size[1],
    pixelRatio,
    selectedId,
  });
}

/**
 * Enquadramento com que um ponto nasce.
 *
 * Os ângulos são os que a câmera tinha no instante da marcação: o dono girou o
 * palco até ver a cabine, clicou nela, e a visita deve reproduzir aquela vista —
 * não um ângulo padrão que mostraria o outro lado do veículo.
 *
 * A distância é derivada do **tamanho do modelo**, não fixa. Um ponto de
 * interesse existe para ser olhado de perto, e "perto" num caça de 18 m não é
 * "perto" num porta-aviões de 330. Sem o raio (modelo ainda em parse, que o
 * chamador já barra) sobra o padrão do tipo de nó.
 */
function poiFraming(
  stage: { readonly azimuthDeg: number; readonly elevationDeg: number },
  modelRadiusMeters: number | null,
): { distanceMeters: number; azimuthDeg: number; elevationDeg: number } {
  return {
    distanceMeters:
      modelRadiusMeters === null ? 12 : Math.max(0.5, Math.min(500, modelRadiusMeters * 0.9)),
    azimuthDeg: stage.azimuthDeg,
    elevationDeg: stage.elevationDeg,
  };
}

interface StudioDebugWindow extends Window {
  __theatrumStudio?: {
    readonly status: () => ReturnType<StudioSceneRuntime["status"]>;
    /**
     * Onde um ponto do palco cai na tela, em pixels CSS.
     *
     * Diagnostico DEV, no mesmo espirito do `__theatrumScene3d.materials()`:
     * existe para o verificador poder afirmar que o rotulo tecnico segue a
     * PROJECAO da camera orbital, e nao uma posicao qualquer. Sem isto o criterio
     * teria de ler o layout de outro painel — que foi exatamente o acoplamento
     * que o ADR-014 desfez.
     */
    readonly project: (
      point: readonly [number, number, number],
    ) => readonly [number, number] | null;
    /**
     * O inverso: que ponto do palco está sob um pixel (ADR-015).
     *
     * Existe para o verificador poder provar a **ida e volta** — projetar o ponto
     * que o raycast devolveu tem de cair no mesmo pixel de onde o raio partiu. É
     * uma afirmação em pixel sobre duas transformações independentes, e é o tipo
     * de prova que pega matriz desatualizada de um frame, que nenhum teste de
     * unidade veria.
     */
    readonly pick: (
      x: number,
      y: number,
    ) => { point: readonly [number, number, number]; modelId: string } | null;
    /** Marcadores desenhados no último frame, para o critério do modo de marcação. */
    readonly markers: () => readonly { id: string; ordinal: number; screen: readonly number[] }[];
  };
}

export function StudioViewport(): ReactNode {
  const session = useEditorSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * Superfície dos marcadores de ponto de interesse (ADR-015). Canvas próprio,
   * **fora** da lista do `frame-composer`: marcador é chrome de autoria, e o
   * critério 8 da Fase 8 exige que nenhum elemento de UI entre em frame algum
   * por construção. Ver o cabeçalho de `studio-markers.ts`.
   */
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<StudioSceneRuntime | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  /**
   * Os marcadores desenhados no último frame, para o clique poder acertá-los.
   * Vai por ref, não por estado: quem escreve é o passe de render e quem lê é o
   * manipulador de clique, e um `setState` aqui repintaria a cada frame.
   */
  const markersRef = useRef<readonly StudioMarker[]>([]);
  /** O palco do último frame, para o clique saber de que ângulo a câmera olhava. */
  const stageRef = useRef<ReturnType<typeof collectStudioStage>>(null);
  /** Ligado, o clique marca ponto em vez de não fazer nada. */
  const [marking, setMarking] = useState(false);
  /** Sobe quando o Pixi termina de inicializar: o primeiro frame precisa dele. */
  const [rendererRevision, setRendererRevision] = useState(0);
  const [size, setSize] = useState<readonly [number, number]>([0, 0]);
  /** Espelho do tamanho para o diagnostico, que roda fora do ciclo do React. */
  const sizeRef = useRef<readonly [number, number]>([0, 0]);
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
      (window as StudioDebugWindow).__theatrumStudio = {
        status: () => runtime.status(),
        project: (point) => runtime.project(point, sizeRef.current[0], sizeRef.current[1]),
        pick: (x, y) => {
          const hit = runtime.pick(x, y, sizeRef.current[0], sizeRef.current[1]);
          return hit === null ? null : { point: hit.point, modelId: hit.modelId };
        },
        markers: () =>
          markersRef.current.map((marker) => ({
            id: marker.id,
            ordinal: marker.ordinal,
            screen: marker.screen,
          })),
      };
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
    sizeRef.current = size;

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
    stageRef.current = stage;
    // O palco desenha ANTES do layout, porque é ele quem diz onde, em pixels,
    // está cada modelo: a projeção sai da câmera orbital DESTE frame.
    runtime.render({ stage, models }, size[0], size[1]);

    // Marcadores depois do render do palco, pela mesma razão: a projeção deles
    // sai da câmera deste frame. Fora do modo de marcação a lista é vazia — e o
    // desenho ainda roda, porque é ele que apaga o que estava lá.
    const pois = stage === null || !marking ? [] : collectStudioPois(pass.scene);
    const markers = layoutStudioMarkers(pois, (point) => runtime.project(point, size[0], size[1]));
    markersRef.current = markers;
    paintMarkers(markerCanvasRef.current, markers, size, session.selectedNodeId);

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
            : marking
              ? `marcando · ${markers.length} ponto(s) · clique na superfície do modelo`
              : `${report.loaded} modelo(s) · ${size[0]}×${size[1]}`,
    );
  }, [
    session.document,
    session.playheadFrame,
    session.selectedCompositionId,
    session.selectedNodeId,
    size,
    assetRevision,
    rendererRevision,
    marking,
  ]);

  /**
   * Clique no palco em modo de marcação.
   *
   * Três respostas possíveis, e nenhuma delas é silenciosa: acertou um marcador
   * existente, seleciona aquele ponto; acertou a superfície de um modelo, cria um
   * ponto ali; errou tudo, diz que errou. A terceira é a que importa — o chão do
   * palco é infinito, então um raycast que aceitasse o piso sempre acertaria
   * alguma coisa e criaria um ponto plausível no lugar errado.
   */
  const handleStageClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!marking) return;
    const runtime = runtimeRef.current;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (runtime === null || stage === null || container === null) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const existing = markerAt(markersRef.current, x, y);
    if (existing !== null) {
      editorActions.selectNode(session.selectedCompositionId, existing.id);
      setStatus(`ponto ${existing.ordinal} selecionado · ${existing.name}`);
      return;
    }

    // Modelo em parse não tem geometria: o raio passa direto e devolve `null`,
    // que é indistinguível de "clicou no vazio". A diferença importa, e quem a
    // conhece é o mesmo contador que o `settle` do export usa.
    if (runtime.status().pending > 0) {
      setStatus("aguarde o modelo carregar para marcar pontos");
      return;
    }

    const hit = runtime.pick(x, y, rect.width, rect.height);
    if (hit === null) {
      setStatus("clique na superfície do modelo · o chão não recebe ponto");
      return;
    }
    const nodeId = editorActions.addStudioPoi(
      hit.point,
      `Ponto ${markersRef.current.length + 1}`,
      poiFraming(stage, runtime.modelRadius(hit.modelId)),
    );
    setStatus(
      nodeId === null
        ? "não foi possível criar o ponto"
        : `ponto criado a ${hit.distanceMeters.toFixed(1)} m da câmera`,
    );
  };

  /**
   * Compila o roteiro nas props de câmera do palco.
   *
   * Pede confirmação quando já há keyframe de câmera, e não por educação: é a
   * consequência declarada do ADR-015 — a compilação **substitui** a animação de
   * câmera, então quem ajustou a curva à mão perde o ajuste. Um aviso silencioso
   * aqui seria trabalho de alguém desaparecendo sem aviso.
   */
  const handleCompileTour = (): void => {
    const composition = session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    );
    const stage = stageRef.current;
    if (composition === undefined || stage === null) {
      setStatus("sem palco na composição · nada a compilar");
      return;
    }
    const stops = documentStudioPois(composition);
    if (stops.length === 0) {
      setStatus("nenhum ponto de interesse · marque pontos antes de compilar");
      return;
    }
    const tour = compileStudioTour(stops, documentStudioTourTiming(composition, stage.nodeId));
    const existing = tour.writes.some(
      (write) =>
        ((
          composition.nodes[stage.nodeId]?.props[write.path.slice("props.".length)] as
            { keyframes?: readonly unknown[] } | undefined
        )?.keyframes?.length ?? 0) > 0,
    );
    if (
      existing &&
      !window.confirm(
        "O roteiro substitui a animação de câmera do palco.\n\n" +
          "Os keyframes atuais de alvo, distância, azimute e elevação serão descartados. Continuar?",
      )
    ) {
      setStatus("compilação cancelada · a câmera atual foi mantida");
      return;
    }
    const ok = editorActions.writeStudioTour(stage.nodeId, tour.writes);
    setStatus(
      ok
        ? `roteiro compilado · ${String(tour.stops)} parada(s) até o frame ${String(tour.endFrame)}`
        : "falha ao gravar o roteiro",
    );
  };

  return (
    <Panel scroll={false}>
      <div
        ref={containerRef}
        className={marking ? "studio-viewport studio-viewport--marking" : "studio-viewport"}
        onClick={handleStageClick}
      >
        <canvas ref={canvasRef} className="studio-viewport__stage" aria-hidden="true" />
        <canvas ref={pixiCanvasRef} className="studio-viewport__pixi" aria-hidden="true" />
        <canvas ref={markerCanvasRef} className="studio-viewport__markers" aria-hidden="true" />
        <div className="studio-viewport__tools" role="toolbar" aria-label="Palco 3D">
          <Button
            size="sm"
            variant={marking ? "primary" : "default"}
            aria-pressed={marking}
            title="Marcar pontos · clique na superfície do modelo cria um ponto de interesse; clique num marcador o seleciona"
            onClick={() => setMarking((value) => !value)}
          >
            Marcar pontos
          </Button>
          <Button
            size="sm"
            title="Compilar roteiro · transforma os pontos em keyframes de câmera, na ordem das camadas"
            onClick={handleCompileTour}
          >
            Compilar roteiro
          </Button>
        </div>
        <p className="studio-viewport__status">{status}</p>
      </div>
    </Panel>
  );
}
