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
 * ETAPA 1 do ADR-014. Rótulos técnicos (`label.callout`), efeitos e filtros ainda
 * não desenham aqui — eles vivem no overlay Pixi, que continua no Viewport. É
 * regressão temporária declarada no ADR, e a etapa 2 a fecha.
 */

import { evaluate } from "@theatrum/animation";
import { applySceneBehaviors, createBuiltinBehaviorRegistry } from "@theatrum/behaviors";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Panel } from "../../ui/index.js";
import {
  collectStudioModels,
  collectStudioStage,
  setActiveStudioRuntime,
  StudioSceneRuntime,
} from "./studio-scene.js";
import "./StudioViewport.css";

/** Comportamentos são puros e sem estado: uma instância por painel serve. */
const behaviorRegistry = createBuiltinBehaviorRegistry();

interface StudioDebugWindow extends Window {
  __theatrumStudio?: { readonly status: () => ReturnType<StudioSceneRuntime["status"]> };
}

export function StudioViewport(): ReactNode {
  const session = useEditorSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<StudioSceneRuntime | null>(null);
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
    runtime.render({ stage, models }, size[0], size[1]);
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
  }, [session.document, session.playheadFrame, session.selectedCompositionId, size, assetRevision]);

  return (
    <Panel scroll={false}>
      <div ref={containerRef} className="studio-viewport">
        <canvas ref={canvasRef} className="studio-viewport__stage" aria-hidden="true" />
        <p className="studio-viewport__status">{status}</p>
      </div>
    </Panel>
  );
}
