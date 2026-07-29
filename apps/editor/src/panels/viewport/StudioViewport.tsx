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
import {
  mat2d,
  orbitDistanceToFit,
  type Mat2D,
  type OrbitState,
  type Vec2,
} from "@theatrum/core-math";
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
import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { editorActions, getEditorSessionSnapshot } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { importLocalModel, loadLocalModelIndex } from "../../assets/local-models.js";
import { assetDisplayName } from "@theatrum/assets";
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
import { anchorToWorld, worldToAnchor, type AnchorFrame } from "./studio-anchor.js";
import {
  DRAG_THRESHOLD_PX,
  effectiveStageCamera,
  orbitByDrag,
  panByDrag,
  zoomByWheel,
} from "./studio-camera.js";
import { decodeStudioDrop, floorPointAt, STUDIO_DROP_MIME } from "./studio-drop.js";
import { poiFramingFor } from "./studio-framing.js";
import { compileReveal } from "./studio-reveal.js";
import {
  collectStudioModel,
  collectStudioModels,
  collectStudioPois,
  collectStudioStage,
  setActiveStudioRuntime,
  StudioSceneRuntime,
  type AnchorResolver,
  type StudioPoiState,
} from "./studio-scene.js";
import "./StudioViewport.css";

/** Comportamentos são puros e sem estado: uma instância por painel serve. */
const behaviorRegistry = createBuiltinBehaviorRegistry();

/**
 * Vão que um modelo assume ao ser solto no palco, em metros.
 *
 * O padrão de `scaleMeters` no `model3d` é 30 000, que são metros de **terreno** para o
 * mapa. No palco o teto de `collectStudioModels` o corta em 500 m — e um objeto de 500 m
 * com a câmera a 40 m significa a câmera dentro do objeto. Dezoito metros é o vão de um
 * caça, aparece enquadrado de imediato, e o dono ajusta de lá.
 */
const STAGE_DROP_SIZE_METERS = 18;

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
 * A conta mora em `studio-framing.ts`, e mudou: era `raio × 0,9`, que **ignora a lente**.
 * Agora sai de `orbitDistanceToFit`, e enquadra uma fração do objeto em vez do objeto
 * inteiro — visitar o míssil não é enquadrar o caça. Ver o cabeçalho daquele módulo.
 */
function poiFraming(
  stage: {
    readonly azimuthDeg: number;
    readonly elevationDeg: number;
    readonly fovDeg: number;
  },
  modelRadiusMeters: number | null,
): { distanceMeters: number; azimuthDeg: number; elevationDeg: number } {
  return poiFramingFor(
    { azimuthDeg: stage.azimuthDeg, elevationDeg: stage.elevationDeg, fovDeg: stage.fovDeg },
    modelRadiusMeters,
  );
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
    /**
     * Os pontos de interesse do último frame, com a ancoragem já resolvida ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
     *
     * Existe porque `props.pointX` **deixou de ser** metros de palco quando o ponto
     * tem dono, e um verificador que lesse o documento e projetasse o triplo cru
     * mediria o lugar errado com total confiança. Aqui sai o que o palco de fato
     * usa: mundo, mais o dono e a marca de órfão. Duplicar a conversão do lado do
     * verificador deixaria as duas livres para divergir em silêncio.
     */
    readonly pois: () => readonly {
      id: string;
      ownerId: string;
      orphan: boolean;
      point: readonly number[];
    }[];
    /**
     * A câmera **efetiva** deste frame, e se ela está solta ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
     *
     * O verificador precisa afirmar duas coisas que só isto responde: que arrastar o
     * mouse mudou a câmera **sem** mudar o documento, e que o enquadramento que um POI
     * grava é o da câmera solta e não o do documento. Ler as props do palco não serve
     * — é justamente a diferença entre as duas que está sob teste.
     */
    readonly camera: () => {
      target: readonly number[];
      distanceMeters: number;
      azimuthDeg: number;
      elevationDeg: number;
      authoring: boolean;
    } | null;
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
  /**
   * Os pontos de interesse do último frame, com o ponto já resolvido em metros de
   * palco. Vai por ref pelo mesmo motivo dos marcadores: quem escreve é o passe de
   * render e quem lê são os manipuladores de clique e de anexar.
   */
  const poisRef = useRef<readonly StudioPoiState[]>([]);
  /** O palco do último frame, para o clique saber de que ângulo a câmera olhava. */
  const stageRef = useRef<ReturnType<typeof collectStudioStage>>(null);
  /** Ligado, o clique marca ponto em vez de não fazer nada. */
  const [marking, setMarking] = useState(false);
  /**
   * Câmera de autoria ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
   *
   * `null` significa "a câmera é a do documento", que é o padrão. Enquanto não é nula,
   * ela **substitui** a do documento no desenho — e o preview deixa de mostrar o que o
   * export vai mostrar, que é o custo declarado no ADR e é dito na barra de estado.
   *
   * Estado, não ref: mudá-la tem de repintar. O gesto lê o valor corrente pelo
   * atualizador funcional do `useState`, que é o que evita capturar valor velho.
   */
  const [authoringCamera, setAuthoringCamera] = useState<OrbitState | null>(null);
  /**
   * Espelho da câmera de autoria para o diagnóstico DEV, que roda fora do ciclo do
   * React e por isso não pode capturar o estado por closure — armadilha 4.12.
   */
  const authoringCameraRef = useRef<OrbitState | null>(null);
  authoringCameraRef.current = authoringCamera;
  /**
   * O gesto de mouse em curso, ou `null`.
   *
   * Vai por ref porque é escrito e lido dentro do mesmo gesto, dezenas de vezes por
   * segundo: em estado, cada `pointermove` agendaria um render só para guardar a
   * posição anterior do cursor.
   */
  const gestureRef = useRef<{
    readonly pan: boolean;
    lastX: number;
    lastY: number;
    /** Soma do deslocamento em módulo, para separar clique de arrasto. */
    travelled: number;
  } | null>(null);
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
        // Por ref, não por closure: este efeito tem deps vazias e roda antes de
        // existir qualquer ponto. É a armadilha 4.12 do 09-CONTINUIDADE.
        pois: () =>
          poisRef.current.map((poi) => ({
            id: poi.id,
            ownerId: poi.ownerId,
            orphan: poi.orphan,
            point: [poi.point[0], poi.point[1], poi.point[2]],
          })),
        camera: () => {
          const stage = stageRef.current;
          if (stage === null) return null;
          return {
            target: [stage.target[0], stage.target[1], stage.target[2]],
            distanceMeters: stage.distanceMeters,
            azimuthDeg: stage.azimuthDeg,
            elevationDeg: stage.elevationDeg,
            // `stageRef` guarda a câmera EFETIVA; quem sabe se ela está solta é a ref
            // do gesto — por ref, não por closure, pela armadilha 4.12.
            authoring: authoringCameraRef.current !== null,
          };
        },
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
    const documentStage = collectStudioStage(pass.scene);
    const models = documentStage === null ? [] : collectStudioModels(pass.scene);
    /**
     * A câmera efetiva, num lugar só ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
     *
     * Substituir aqui é o que faz `pick`, `project`, os marcadores e a projeção dos
     * rótulos acompanharem sem código novo: todos leem a câmera do runtime, e é esta
     * que ele recebe. Se cada consumidor decidisse qual câmera usar, o marcador
     * ficaria um frame atrás do palco na primeira divergência.
     */
    const stage =
      documentStage === null ? null : effectiveStageCamera(documentStage, authoringCamera);
    stageRef.current = stage;
    // O palco desenha ANTES do layout, porque é ele quem diz onde, em pixels,
    // está cada modelo: a projeção sai da câmera orbital DESTE frame.
    runtime.render({ stage, models }, size[0], size[1]);

    // Marcadores depois do render do palco, pela mesma razão: a projeção deles
    // sai da câmera deste frame. Fora do modo de marcação a lista é vazia — e o
    // desenho ainda roda, porque é ele que apaga o que estava lá.
    //
    // O resolvedor de ancoragem lê o quadro do modelo DESTE frame (ADR-016): é o
    // mesmo frame que o palco acabou de desenhar, então o marcador cai sobre a
    // superfície em que o ponto está, e não sobre a pose de um frame vizinho.
    const resolveAnchor: AnchorResolver = (ownerId) => runtime.anchorFrame(ownerId);
    /**
     * Os pontos são coletados **sempre**, não só marcando. O que depende do modo é
     * o que se **desenha**: fora dele a lista de marcadores é vazia. Coletar
     * sempre é o que permite avisar de ponto órfão e anexar um ponto antigo sem
     * exigir que o dono ligue o modo de marcação para descobrir que há problema.
     */
    const pois = stage === null ? [] : collectStudioPois(pass.scene, resolveAnchor);
    poisRef.current = pois;
    const markers = layoutStudioMarkers(marking ? pois : [], (point) =>
      runtime.project(point, size[0], size[1]),
    );
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
      // Os POIs entram no layout junto com os modelos: é o que permite um
      // `label.callout` mirar o míssil em vez do avião inteiro. Ver o cabeçalho de
      // `withStudioProjection`.
      const layout =
        stage === null ? base : withStudioProjection(base, models, runtime, viewport, pois);
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
    /**
     * Ponto órfão é aviso, não silêncio ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
     *
     * Era o pedaço que o ADR-015 tinha deixado para a interface, e antes do dono
     * explícito ele não tinha como estar certo: "longe do modelo" também descreve
     * um ponto de enquadramento amplo, marcado de propósito. Com `ownerId` a
     * pergunta virou objetiva — o dono declarado respondeu ou não.
     */
    const orphans = pois.filter((poi) => poi.orphan).length;
    setStatus(
      stage === null
        ? "palco vazio · adicione um nó Palco 3D"
        : report.lastError !== null
          ? `falha ao carregar modelo · ${report.lastError}`
          : report.pending > 0
            ? `carregando ${report.pending} modelo(s)…`
            : // Câmera solta antes de tudo: enquanto ela está ativa, o preview NÃO é o
              // que o export vai gravar, e esse é o custo declarado do ADR-017. Dizer
              // isso é a mitigação; deixar implícito seria a armadilha.
              authoringCamera !== null
              ? `câmera solta · o preview não é o enquadramento do vídeo · grave ou volte para a do documento`
              : orphans > 0
                ? `${String(orphans)} ponto(s) sem objeto · o modelo a que estavam ancorados não está mais aqui`
                : marking
                  ? `marcando · ${String(markers.length)} ponto(s) · arraste para girar, clique para marcar`
                  : `${String(report.loaded)} modelo(s) · ${String(size[0])}×${String(size[1])} · arraste para girar, roda para aproximar`,
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
    // Mover a câmera de autoria tem de repintar o palco: é ela que o runtime recebe.
    authoringCamera,
  ]);

  /**
   * Começo de gesto ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
   *
   * Não decide nada ainda: só guarda de onde partiu. Quem decide entre girar e marcar é
   * o `pointerup`, pelo deslocamento acumulado — é assim que "movimentar o cenário
   * livremente ao ativar o marcar pontos" cabe num botão só, que é o que foi pedido.
   *
   * **Shift ou botão do meio deslocam** em vez de orbitar. O botão direito fica de
   * fora de propósito: ele é do menu de contexto, e roubá-lo custaria mais do que
   * paga.
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    gestureRef.current = {
      pan: event.button === 1 || event.shiftKey,
      lastX: event.clientX,
      lastY: event.clientY,
      travelled: 0,
    };
    // Captura para o gesto sobreviver ao cursor sair do painel no meio do arrasto —
    // sem isso, girar até a borda solta a câmera pela metade.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null) return;
    const deltaX = event.clientX - gesture.lastX;
    const deltaY = event.clientY - gesture.lastY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.travelled += Math.abs(deltaX) + Math.abs(deltaY);
    if (gesture.travelled < DRAG_THRESHOLD_PX) return;
    const fovDeg = stageRef.current?.fovDeg ?? 38;
    const height = sizeRef.current[1];
    setAuthoringCamera((current) => {
      // Solta a câmera a partir do enquadramento do documento: começar de um estado
      // inventado faria a imagem saltar no primeiro pixel de arrasto.
      const base = current ?? documentCamera();
      if (base === null) return current;
      return gesture.pan
        ? panByDrag(base, deltaX, deltaY, fovDeg, height)
        : orbitByDrag(base, deltaX, deltaY);
    });
  };

  /**
   * Fim de gesto: abaixo do limiar foi clique, e clique marca ponto.
   *
   * É aqui, e não em `onClick`, porque o mesmo botão faz as duas coisas e só o
   * deslocamento acumulado distingue. `onClick` dispararia também no fim de um arrasto,
   * e o dono ganharia um ponto de interesse a cada vez que girasse o cenário.
   */
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture === null) return;
    if (gesture.travelled >= DRAG_THRESHOLD_PX) return;
    markPointAt(event.clientX, event.clientY);
  };

  /** Roda aproxima e afasta. `passive: false` não é preciso: o React já registra assim. */
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (stageRef.current === null) return;
    event.preventDefault();
    const delta = event.deltaY;
    setAuthoringCamera((current) => {
      const base = current ?? documentCamera();
      return base === null ? current : zoomByWheel(base, delta);
    });
  };

  /**
   * Soltar um modelo no palco.
   *
   * O pedido do dono, literal: _"não to conseguindo jogar modelos 3D lá dentro... crie um
   * sistema de drag and drop para facilitar"_.
   *
   * Três decisões dentro disto:
   *
   * - **nasce onde foi solto**, pela interseção do raio do cursor com o piso. Sem isso
   *   todo modelo apareceria na origem e o dono teria de digitar `stageX` no Inspector,
   *   que é o oposto de facilitar;
   * - **escala de palco, não de mapa.** O padrão de `scaleMeters` no `model3d` é 30 000,
   *   que são metros de **terreno**; no palco isso vira um objeto de 500 m depois do teto
   *   de `collectStudioModels`, com a câmera dentro dele. Soltar no palco assume 18 m — o
   *   vão de um caça — para o objeto aparecer enquadrado em vez de engolir a cena;
   * - **modelo do disco atravessa a fronteira primeiro.** Soltar um item da biblioteca
   *   local importa o GLB para dentro do projeto e só então cria o nó, pelo mesmo caminho
   *   do clique. O asset novo é achado por diferença da lista antes e depois, que é
   *   determinístico — o hash de conteúdo não é previsível daqui.
   */
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const payload = decodeStudioDrop(event.dataTransfer.getData(STUDIO_DROP_MIME));
    if (payload === null) return;
    const runtime = runtimeRef.current;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (runtime === null || stage === null || container === null) {
      setStatus("adicione um nó Palco 3D antes de soltar modelos aqui");
      return;
    }
    const rect = container.getBoundingClientRect();
    const cameraPosition = runtime.status().cameraPosition;
    const floor =
      cameraPosition === null
        ? null
        : floorPointAt(
            event.clientX - rect.left,
            event.clientY - rect.top,
            [rect.width, rect.height],
            {
              position: [cameraPosition[0], cameraPosition[1], cameraPosition[2]],
              target: [stage.target[0], stage.target[1], stage.target[2]],
              fovDeg: stage.fovDeg,
            },
          );

    const place = (assetId: string, label: string): void => {
      const nodeId = editorActions.applyAsset(assetId);
      if (nodeId === null) {
        setStatus(`não foi possível criar o nó de ${label}`);
        return;
      }
      editorActions.setPropertyValue(nodeId, "props.scaleMeters", STAGE_DROP_SIZE_METERS, false);
      if (floor !== null) {
        editorActions.setPropertyValue(nodeId, "props.stageX", floor[0], false);
        editorActions.setPropertyValue(nodeId, "props.stageZ", floor[2], false);
      }
      setStatus(
        floor === null
          ? `${label} entrou no palco na origem · o cursor estava acima do horizonte`
          : `${label} entrou no palco em ${floor[0].toFixed(1)}, ${floor[2].toFixed(1)} m`,
      );
    };

    if (payload.kind === "asset") {
      const asset = session.document.assets.find((entry) => entry.src === payload.src);
      if (asset === undefined) {
        setStatus("o asset arrastado não está mais no projeto");
        return;
      }
      place(asset.id, assetDisplayName(asset));
      return;
    }

    setStatus("importando o modelo…");
    void (async () => {
      const index = await loadLocalModelIndex();
      const model = index?.models.find((entry) => entry.file === payload.file);
      if (model === undefined) {
        setStatus("o modelo arrastado não está mais na biblioteca local");
        return;
      }
      const before = new Set(session.document.assets.map((entry) => entry.id));
      const result = await importLocalModel(model, (files) =>
        editorActions.importAssetFiles([...files]),
      );
      if (!result.ok) {
        setStatus(`${result.label} não entrou: ${result.message ?? "motivo desconhecido"}`);
        return;
      }
      // A sessão já mudou; `session` aqui é a captura do render, então a lista nova vem
      // do snapshot corrente, não do closure.
      const current = getEditorSessionSnapshot().document.assets;
      const added = current.find((entry) => !before.has(entry.id));
      if (added === undefined) {
        setStatus(`${result.label} já estava no projeto · arraste-o da Biblioteca`);
        return;
      }
      place(added.id, result.label);
    })();
  };

  /** O enquadramento do documento como estado orbital, para soltar a câmera de lá. */
  const documentCamera = (): OrbitState | null => {
    const stage = stageRef.current;
    return stage === null
      ? null
      : {
          target: [stage.target[0], stage.target[1], stage.target[2]],
          distanceMeters: stage.distanceMeters,
          azimuthDeg: stage.azimuthDeg,
          elevationDeg: stage.elevationDeg,
        };
  };

  /**
   * Clique no palco em modo de marcação.
   *
   * Três respostas possíveis, e nenhuma delas é silenciosa: acertou um marcador
   * existente, seleciona aquele ponto; acertou a superfície de um modelo, cria um
   * ponto ali; errou tudo, diz que errou. A terceira é a que importa — o chão do
   * palco é infinito, então um raycast que aceitasse o piso sempre acertaria
   * alguma coisa e criaria um ponto plausível no lugar errado.
   */
  const markPointAt = (clientX: number, clientY: number): void => {
    if (!marking) return;
    const runtime = runtimeRef.current;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (runtime === null || stage === null || container === null) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

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
    /**
     * O ponto é guardado no espaço do objeto, não do palco ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
     *
     * O raycast devolve mundo, e é aqui que ele atravessa a matriz do modelo — uma
     * vez, na marcação. O dono já vinha no `hit` e antes era descartado.
     *
     * Sem quadro de ancoragem (o que só ocorre se a geometria sumir entre o
     * `pick` e esta linha) o ponto entra solto, em metros de palco: é o
     * comportamento de antes do ADR-016, e é melhor que recusar a marcação — o
     * dono clicou onde queria, e um ponto solto ainda leva a câmera até lá.
     */
    const anchor = runtime.anchorFrame(hit.modelId);
    const stored = anchor === null ? hit.point : worldToAnchor(hit.point, anchor);
    const nodeId = editorActions.addStudioPoi(
      stored,
      `Ponto ${String(markersRef.current.length + 1)}`,
      poiFraming(stage, runtime.modelRadius(hit.modelId)),
      anchor === null ? "" : hit.modelId,
    );
    setStatus(
      nodeId === null
        ? "não foi possível criar o ponto"
        : anchor === null
          ? `ponto criado solto a ${hit.distanceMeters.toFixed(1)} m da câmera · sem objeto para acompanhar`
          : `ponto criado no objeto a ${hit.distanceMeters.toFixed(1)} m da câmera · acompanha posição, rumo e escala`,
    );
  };

  /**
   * Anota o ponto selecionado: bolinha, guia, balão e a revelação animada.
   *
   * É o pedido do dono montado de ponta a ponta — _"marcar o míssil do avião e uma animação
   * de textbox aparecer uma bolinha uma linha até o text box se afastando do avião e o texto
   * aparecendo"_.
   *
   * O rótulo mira o **ponto**, não o objeto, e isso passou a ser possível porque o passe de
   * projeção do palco agora põe os POIs no layout. Do lado do `label.callout` não houve
   * mudança nenhuma: ele já procurava o alvo por id.
   *
   * A revelação entra como keyframes, no frame corrente do playhead — a anotação começa
   * onde o dono está olhando na timeline, que é o que ele quer dizer com "aqui".
   */
  const handleAnnotatePoi = (): void => {
    const nodeId = session.selectedNodeId;
    const poi = nodeId === null ? undefined : poisRef.current.find((item) => item.id === nodeId);
    if (poi === undefined) {
      setStatus("selecione um ponto do palco para anotar");
      return;
    }
    const calloutId = editorActions.addCalloutFor(poi.id, poi.name);
    if (calloutId === null) {
      setStatus("não foi possível criar a anotação");
      return;
    }
    const reveal = compileReveal(
      // Os valores de destino são os padrões do tipo de nó, que é o que a anotação acabou
      // de nascer com: a revelação leva de zero até onde o nó já está.
      { dotRadius: 4, offsetX: 140, offsetY: -90, backgroundAlpha: 0.88, borderWidth: 1 },
      {
        startFrame: session.playheadFrame,
        dotFrames: 6,
        slideFrames: 12,
        textFrames: Math.max(12, poi.name.length * 2),
      },
    );
    const ok = editorActions.writeKeyframeTracks(calloutId, reveal.writes);
    editorActions.selectNode(session.selectedCompositionId, calloutId);
    setStatus(
      ok
        ? `anotação de "${poi.name}" criada · revelação do frame ${String(session.playheadFrame)} ao ${String(reveal.endFrame)}`
        : "anotação criada, mas a revelação não foi gravada",
    );
  };

  /**
   * Grava o enquadramento composto nas seis props do palco ([ADR-017](../../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
   *
   * É exato por construção: a câmera de autoria vive no mesmo espaço de parâmetros do
   * documento, então gravar é copiar quatro números, sem conversão e sem salto. Era o
   * argumento central para recusar a câmera de voo livre.
   *
   * Pede confirmação quando há keyframe de câmera, pelo mesmo motivo que "Compilar
   * roteiro" pede: gravar o valor base de uma prop animada não muda o que se vê, e
   * silêncio aqui pareceria um botão quebrado.
   */
  const handleRecordCamera = (): void => {
    const stage = stageRef.current;
    if (stage === null || authoringCamera === null) {
      setStatus("a câmera já é a do documento · não há enquadramento novo para gravar");
      return;
    }
    const composition = session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    );
    const animated = [
      "targetX",
      "targetY",
      "targetZ",
      "distanceMeters",
      "azimuthDeg",
      "elevationDeg",
    ].some(
      (key) =>
        ((composition?.nodes[stage.nodeId]?.props[key] as { keyframes?: readonly unknown[] })
          ?.keyframes?.length ?? 0) > 0,
    );
    if (
      animated &&
      !window.confirm(
        "A câmera do palco está animada por keyframes.\n\n" +
          "Gravar o enquadramento muda o valor de repouso, e a animação continua mandando no que aparece. Continuar?",
      )
    ) {
      setStatus("gravação cancelada · a câmera solta continua ativa");
      return;
    }
    const ok = editorActions.writeStudioCamera(stage.nodeId, authoringCamera);
    if (ok) setAuthoringCamera(null);
    setStatus(
      ok
        ? `enquadramento gravado · azimute ${authoringCamera.azimuthDeg.toFixed(1)}°, ` +
            `elevação ${authoringCamera.elevationDeg.toFixed(1)}°, ` +
            `${authoringCamera.distanceMeters.toFixed(1)} m`
        : "não foi possível gravar o enquadramento",
    );
  };

  /**
   * Enquadra o objeto carregado, usando `orbitDistanceToFit`.
   *
   * A função existia em L0 desde o ADR-012 com o docstring dizendo "serve o botão
   * enquadrar", e sem chamador. Um caça de 18 m e um porta-aviões de 330 precisam da
   * mesma composição na tela, e ninguém quer achar esse número girando a roda.
   */
  const handleFrameObject = (): void => {
    const runtime = runtimeRef.current;
    const stage = stageRef.current;
    if (runtime === null || stage === null) return;
    const loaded = runtime.loadedModelIds();
    const first = loaded[0];
    if (first === undefined) {
      setStatus("nenhum modelo carregado para enquadrar");
      return;
    }
    const anchor = runtime.anchorFrame(first);
    const radius = runtime.modelRadius(first);
    if (anchor === null || radius === null) {
      setStatus("modelo ainda carregando · aguarde para enquadrar");
      return;
    }
    // O centro do objeto, não a origem do palco: enquadrar um modelo posicionado a
    // vinte metros da origem tem de olhar para o modelo.
    const center = anchorToWorld([0, 0, 0], anchor);
    setAuthoringCamera({
      target: [center[0], center[1], center[2]],
      distanceMeters: orbitDistanceToFit(radius, stage.fovDeg),
      azimuthDeg: stage.azimuthDeg,
      elevationDeg: stage.elevationDeg,
    });
    setStatus(`objeto enquadrado · câmera solta, grave se quiser manter`);
  };

  /**
   * Anexa o ponto selecionado ao objeto em que ele está ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
   *
   * Existe para os pontos marcados **antes** deste ADR, que estão em metros de
   * palco e não acompanham nada. Sem isto, o único caminho para consertar um
   * projeto antigo seria apagar e remarcar cada ponto.
   *
   * **Qual objeto.** O de menor distância ao ponto medida em raios normalizados —
   * ou seja, "de quem esta superfície está mais perto", com o tamanho de cada
   * modelo já descontado. Comparar em metros escolheria sempre o modelo maior num
   * palco com um caça e um porta-aviões.
   */
  const handleAttachPoi = (): void => {
    const runtime = runtimeRef.current;
    const nodeId = session.selectedNodeId;
    if (runtime === null || nodeId === null) {
      setStatus("selecione um ponto do palco para anexar");
      return;
    }
    const poi = poisRef.current.find((candidate) => candidate.id === nodeId);
    if (poi === undefined) {
      setStatus("selecione um ponto do palco para anexar");
      return;
    }
    if (poi.ownerId !== "" && !poi.orphan) {
      setStatus(`"${poi.name}" já está ancorado num objeto`);
      return;
    }
    let best: { readonly id: string; readonly frame: AnchorFrame; readonly ratio: number } | null =
      null;
    for (const modelId of runtime.loadedModelIds()) {
      const frame = runtime.anchorFrame(modelId);
      if (frame === null) continue;
      const local = worldToAnchor(poi.point, frame);
      const ratio =
        Math.hypot(local[0], local[1], local[2]) / Math.max(1e-6, frame.normalizedRadius);
      if (best === null || ratio < best.ratio) best = { id: modelId, frame, ratio };
    }
    if (best === null) {
      setStatus("nenhum modelo carregado no palco para ancorar o ponto");
      return;
    }
    const local = worldToAnchor(poi.point, best.frame);
    const ok = editorActions.attachStudioPoi(nodeId, best.id, local);
    setStatus(
      ok
        ? `"${poi.name}" ancorado no objeto · agora acompanha posição, rumo e escala`
        : `não foi possível ancorar "${poi.name}"`,
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
    /**
     * Onde cada parada está no frame em que a câmera chega nela ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
     *
     * O ponto ancorado num objeto animado se move, então a pose que importa é a do
     * frame de chegada — e `evaluate` é função pura de `(documento, frame)`, que é
     * exatamente a propriedade que permite perguntar isso sem tocar no playhead.
     *
     * A base do modelo (`modelBottom`) vem da geometria carregada, não do
     * documento, e é o motivo de a compilação exigir o GLB pronto. Sem ela a
     * parada sai do roteiro com diagnóstico, em vez de virar um alvo perto da
     * origem do palco.
     */
    const runtime = runtimeRef.current;
    const evaluatedByFrame = new Map<number, ReturnType<typeof evaluate>>();
    const sceneAt = (frame: number): ReturnType<typeof evaluate> => {
      const cached = evaluatedByFrame.get(frame);
      if (cached !== undefined) return cached;
      const scene = evaluate(session.document, composition.id, frame);
      evaluatedByFrame.set(frame, scene);
      return scene;
    };
    const tour = compileStudioTour(
      stops,
      documentStudioTourTiming(composition, stage.nodeId),
      (stop, frame) => {
        if (stop.ownerId === "") return stop.point;
        const bottom = runtime === null ? null : runtime.modelBottom(stop.ownerId);
        const model = collectStudioModel(sceneAt(frame), stop.ownerId);
        if (bottom === null || model === null) return null;
        return anchorToWorld(stop.point, {
          position: model.position,
          headingDeg: model.headingDeg,
          sizeMeters: model.sizeMeters,
          bottom,
        });
      },
    );
    if (tour.stops === 0) {
      setStatus(tour.diagnostics.join(" · "));
      return;
    }
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
        ? `roteiro compilado · ${String(tour.stops)} parada(s) até o frame ${String(tour.endFrame)}` +
            // Parada descartada é dita em voz alta: compilar um roteiro de cinco
            // pontos e receber três sem explicação é o tipo de silêncio que faz
            // alguém procurar defeito na câmera por meia hora.
            (tour.skipped > 0 ? ` · ${String(tour.skipped)} sem objeto, fora do roteiro` : "")
        : "falha ao gravar o roteiro",
    );
  };

  return (
    <Panel scroll={false}>
      <div
        ref={containerRef}
        className={marking ? "studio-viewport studio-viewport--marking" : "studio-viewport"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        /*
          `onDragOver` com `preventDefault` é obrigatório: sem ele o navegador recusa o
          drop e o gesto morre sem nenhuma pista do motivo. `copy` é o cursor honesto —
          arrastar da biblioteca não remove nada de lá.
        */
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(STUDIO_DROP_MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleDrop}
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
            title="Enquadrar objeto · põe a câmera à distância que mostra o modelo inteiro"
            onClick={handleFrameObject}
          >
            Enquadrar
          </Button>
          {/*
            Os dois botões da câmera solta só existem quando ela está solta. Botão
            desabilitado permanente é ruído; botão que aparece quando faz sentido é
            também o segundo aviso de que o preview não é o vídeo.
          */}
          {authoringCamera !== null && (
            <>
              <Button
                size="sm"
                variant="primary"
                title="Gravar enquadramento · escreve nas seis props de câmera do palco o que você compôs"
                onClick={handleRecordCamera}
              >
                Gravar enquadramento
              </Button>
              <Button
                size="sm"
                title="Câmera do documento · descarta o enquadramento solto e volta ao que o vídeo vai mostrar"
                onClick={() => {
                  setAuthoringCamera(null);
                  setStatus("de volta à câmera do documento");
                }}
              >
                Câmera do documento
              </Button>
            </>
          )}
          <Button
            size="sm"
            title="Anotar ponto · cria bolinha, guia e balão de texto no ponto selecionado, com a revelação animada"
            onClick={handleAnnotatePoi}
          >
            Anotar ponto
          </Button>
          <Button
            size="sm"
            title="Anexar ao objeto · o ponto selecionado passa a acompanhar posição, rumo e escala do modelo em que está"
            onClick={handleAttachPoi}
          >
            Anexar ao objeto
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
