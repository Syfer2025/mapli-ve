import { createBuiltinNodeTypeRegistry } from "@theatrum/scene-graph";
import type { AnimatableProperty } from "@theatrum/schema";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import { readAnimatableProperty } from "../timeline/timeline-model.js";
import {
  buildGraphModel,
  findHandleAt,
  handleFromScreen,
  type GraphModel,
  type GraphViewport,
} from "./graph-model.js";
import "./GraphPanel.css";

const REGISTRY = createBuiltinNodeTypeRegistry();
const PADDING = 18;

/**
 * Superfície de debug do painel, só em dev. Handles são desenhados em canvas e
 * não existem no DOM: sem isso, um verificador teria que adivinhar coordenadas.
 */
interface GraphDebugSurface {
  readonly snapshot: () => {
    readonly path: string | null;
    readonly choices: readonly string[];
    readonly handles: readonly {
      readonly keyframeId: string;
      readonly side: "in" | "out";
      readonly x: number;
      readonly y: number;
      readonly handle: readonly [number, number];
    }[];
    readonly keyframes: readonly {
      readonly id: string;
      readonly frame: number;
      readonly x: number;
      readonly y: number;
    }[];
  };
}

declare global {
  interface Window {
    __theatrumPhase5Graph?: GraphDebugSurface;
  }
}

interface PropertyChoice {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly path: string;
  readonly label: string;
  readonly keyframes: number;
}

/**
 * Editor de curvas do nó selecionado.
 *
 * Mostra as duas curvas ao mesmo tempo — valor e velocidade — porque é a
 * comparação entre elas que revela tranco. Arrastar um handle despacha
 * `keyframe.set-easing`, então a curva, a animação e o undo andam juntos.
 */
export function GraphPanel(): ReactNode {
  const session = useEditorSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showSpeed, setShowSpeed] = useState(true);
  const dragRef = useRef<{ readonly keyframeId: string; readonly side: "in" | "out" } | null>(null);
  const modelRef = useRef<GraphModel | null>(null);

  const composition = useMemo(
    () =>
      session.document.compositions.find(
        (candidate) => candidate.id === session.selectedCompositionId,
      ) ?? session.document.compositions[0],
    [session.document, session.selectedCompositionId],
  );
  const node =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];

  /** Só entram propriedades que já têm keyframes: curva sem keyframe é reta. */
  const choices = useMemo<readonly PropertyChoice[]>(() => {
    if (node === undefined) return [];
    const found: PropertyChoice[] = [];
    for (const descriptor of REGISTRY.get(node.type)?.properties ?? []) {
      if (!descriptor.animatable) continue;
      const property = readAnimatableProperty(node, descriptor.path);
      if (property === undefined || property.keyframes.length === 0) continue;
      found.push({
        nodeId: node.id,
        nodeName: node.name,
        path: descriptor.path,
        label: descriptor.label,
        keyframes: property.keyframes.length,
      });
    }
    node.behaviors.forEach((behavior, index) => {
      for (const key of Object.keys(behavior.params)) {
        const path = `behaviors.${index}.params.${key}`;
        const property = readAnimatableProperty(node, path);
        if (property === undefined || property.keyframes.length === 0) continue;
        found.push({
          nodeId: node.id,
          nodeName: node.name,
          path,
          label: `${behavior.type} · ${key}`,
          keyframes: property.keyframes.length,
        });
      }
    });
    return Object.freeze(found);
  }, [node]);

  const activePath =
    selectedPath !== null && choices.some((choice) => choice.path === selectedPath)
      ? selectedPath
      : (choices[0]?.path ?? null);

  const property = useMemo<AnimatableProperty<unknown> | undefined>(
    () =>
      node === undefined || activePath === null
        ? undefined
        : readAnimatableProperty(node, activePath),
    [node, activePath],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (canvas === null || container === null || container === undefined) return;
    const resize = (): void => {
      const bounds = container.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height)),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const viewport = useMemo<GraphViewport>(
    () => ({
      width: size.width,
      height: size.height,
      startFrame: 0,
      endFrame: Math.max(1, composition?.duration ?? 1),
      padding: PADDING,
    }),
    [composition?.duration, size.height, size.width],
  );

  const model = useMemo<GraphModel | null>(
    () =>
      property === undefined ? null : buildGraphModel(property, viewport, composition?.fps ?? 60),
    [property, viewport, composition?.fps],
  );
  modelRef.current = model;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const scale = Math.max(1, window.devicePixelRatio);
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawGraph(context, model, viewport, session.playheadFrame, showSpeed);
  }, [model, viewport, session.playheadFrame, showSpeed, size.height, size.width]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const debug: GraphDebugSurface = Object.freeze({
      snapshot: () => {
        const current = modelRef.current;
        return {
          path: activePath,
          choices: choices.map((choice) => choice.path),
          handles:
            current === null
              ? []
              : current.handles.map((handle) => ({
                  keyframeId: handle.keyframeId,
                  side: handle.side,
                  x: handle.x,
                  y: handle.y,
                  handle: [handle.handle[0], handle.handle[1]] as [number, number],
                })),
          keyframes:
            current === null
              ? []
              : current.keyframes.map((keyframe) => ({
                  id: keyframe.id,
                  frame: keyframe.frame,
                  x: keyframe.x,
                  y: keyframe.y,
                })),
        };
      },
    });
    Object.defineProperty(window, "__theatrumPhase5Graph", { value: debug, configurable: true });
    return () => {
      if (window.__theatrumPhase5Graph === debug) {
        Reflect.deleteProperty(window, "__theatrumPhase5Graph");
      }
    };
  }, [activePath, choices]);

  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    const current = modelRef.current;
    if (current === null) return;
    const point = pointerPosition(event);
    const handle = findHandleAt(current, point.x, point.y);
    if (handle === null) return;
    // Captura é conveniência de arrasto: o navegador lança quando o id não é um
    // ponteiro ativo, e deixar escapar mataria a edição do handle.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Sem captura o arrasto continua enquanto o ponteiro estiver sobre o canvas.
    }
    dragRef.current = { keyframeId: handle.keyframeId, side: handle.side };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    const current = modelRef.current;
    if (drag === null || current === null || property === undefined || node === undefined) return;
    if (activePath === null) return;

    const index = property.keyframes.findIndex((keyframe) => keyframe.id === drag.keyframeId);
    const keyframe = property.keyframes[index];
    if (keyframe === undefined) return;
    // O segmento de referência depende do lado: `out` olha para a frente, `in`
    // para trás. Usar o segmento errado espelharia o arrasto.
    const left = drag.side === "out" ? keyframe : property.keyframes[index - 1];
    const right = drag.side === "out" ? property.keyframes[index + 1] : keyframe;
    if (left === undefined || right === undefined) return;

    const handle = handleFromScreen(
      pointerPosition(event),
      left,
      right,
      viewport,
      current.value.range,
    );
    editorActions.setPropertyKeyframeEasing(node.id, activePath, drag.keyframeId, {
      [drag.side]: { kind: "bezier", handle: [handle[0], handle[1]] },
    });
  };

  const endDrag = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Panel
      title="Editor de curvas"
      scroll={false}
      toolbar={
        <>
          <select
            className="graph-panel__select"
            aria-label="Propriedade"
            value={activePath ?? ""}
            disabled={choices.length === 0}
            onChange={(event) => setSelectedPath(event.target.value)}
          >
            {choices.length === 0 && <option value="">Sem propriedade animada</option>}
            {choices.map((choice) => (
              <option key={choice.path} value={choice.path}>
                {choice.label} ({choice.keyframes})
              </option>
            ))}
          </select>
          <label className="graph-panel__toggle">
            <input
              type="checkbox"
              checked={showSpeed}
              onChange={(event) => setShowSpeed(event.target.checked)}
            />
            Velocidade
          </label>
          <Button
            size="sm"
            aria-label="Aplicar easy ease no keyframe do playhead"
            disabled={property === undefined}
            onClick={() => {
              if (node === undefined || activePath === null || property === undefined) return;
              const atPlayhead = property.keyframes.find(
                (keyframe) => keyframe.frame === session.playheadFrame,
              );
              if (atPlayhead === undefined) return;
              editorActions.setPropertyKeyframeEasing(node.id, activePath, atPlayhead.id, {
                out: { kind: "bezier", handle: [1 / 3, 0] },
                in: { kind: "bezier", handle: [2 / 3, 1] },
              });
            }}
          >
            Easy ease
          </Button>
        </>
      }
      footer={
        <span>
          {node === undefined
            ? "Nenhum objeto selecionado"
            : `${node.name} · ${choices.length} propriedades animadas`}
        </span>
      }
    >
      <div className="graph-panel">
        <canvas
          ref={canvasRef}
          className="graph-panel__canvas"
          aria-label="Curvas de valor e velocidade"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </Panel>
  );
}

function drawGraph(
  context: CanvasRenderingContext2D,
  model: GraphModel | null,
  viewport: GraphViewport,
  playheadFrame: number,
  showSpeed: boolean,
): void {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;

  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = token("--bg-input", "#0e1216");
  context.fillRect(0, 0, viewport.width, viewport.height);

  context.strokeStyle = token("--border-subtle", "#252d35");
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = viewport.padding + ((viewport.height - viewport.padding * 2) * index) / 4;
    context.beginPath();
    context.moveTo(0, Math.round(y) + 0.5);
    context.lineTo(viewport.width, Math.round(y) + 0.5);
    context.stroke();
  }

  if (model === null) {
    context.fillStyle = token("--fg-faint", "#8d99a6");
    context.font = "12px system-ui";
    context.fillText("Anime uma propriedade para ver a curva.", 12, viewport.height / 2);
    return;
  }

  if (showSpeed) {
    context.strokeStyle = token("--warning", "#c9963f");
    context.lineWidth = 1.5;
    context.setLineDash([5, 3]);
    strokePoints(context, model.speed.points);
    context.setLineDash([]);
  }

  context.strokeStyle = token("--accent", "#2f9e93");
  context.lineWidth = 2;
  strokePoints(context, model.value.points);

  const playheadX = Math.round(
    ((playheadFrame - viewport.startFrame) / Math.max(1, viewport.endFrame - viewport.startFrame)) *
      viewport.width,
  );
  context.strokeStyle = token("--danger", "#cf5a4f");
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(playheadX + 0.5, 0);
  context.lineTo(playheadX + 0.5, viewport.height);
  context.stroke();

  context.fillStyle = token("--fg", "#dfe4ea");
  for (const keyframe of model.keyframes) {
    context.fillRect(keyframe.x - 3, keyframe.y - 3, 6, 6);
  }

  context.strokeStyle = token("--fg-muted", "#8d99a6");
  context.fillStyle = token("--accent", "#2f9e93");
  for (const handle of model.handles) {
    const anchor = model.keyframes.find((keyframe) => keyframe.id === handle.keyframeId);
    if (anchor !== undefined) {
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(handle.x, handle.y);
      context.stroke();
    }
    context.beginPath();
    context.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
    context.fill();
  }
}

function strokePoints(
  context: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  const [first, ...rest] = points;
  if (first === undefined || rest.length === 0) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.stroke();
}
