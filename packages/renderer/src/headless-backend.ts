import type { Mat2D, Vec2 } from "@theatrum/core-math";
import {
  SLOT_IDS,
  type CapturedFrame,
  type NodeLayout,
  type RenderBackend,
  type SlotId,
  type SurfaceSet,
  type VisualPrimitive,
} from "./contracts.js";
import { RendererError } from "./errors.js";

export type HeadlessBackendEvent =
  | { readonly kind: "init" }
  | { readonly kind: "resize"; readonly size: Vec2; readonly pixelRatio: number }
  | { readonly kind: "mount"; readonly nodeId: string; readonly slot: SlotId }
  | { readonly kind: "move"; readonly nodeId: string; readonly slot: SlotId }
  | { readonly kind: "update"; readonly nodeId: string }
  | { readonly kind: "unmount"; readonly nodeId: string }
  | { readonly kind: "order"; readonly slot: SlotId; readonly nodeIds: readonly string[] }
  | { readonly kind: "composite"; readonly slots: readonly SlotId[] }
  | { readonly kind: "dispose" };

export interface HeadlessNodeSnapshot {
  readonly id: string;
  readonly slot: SlotId;
  readonly visual: VisualPrimitive;
  readonly layout: NodeLayout;
}

export interface HeadlessBackendSnapshot {
  readonly size: Vec2;
  readonly pixelRatio: number;
  readonly compositeOrder: readonly SlotId[];
  readonly slots: readonly {
    readonly id: SlotId;
    readonly nodes: readonly HeadlessNodeSnapshot[];
  }[];
}

export interface HeadlessRenderBackend extends RenderBackend {
  readonly kind: "headless";
  snapshot(): HeadlessBackendSnapshot;
  events(): readonly HeadlessBackendEvent[];
}

interface RetainedNode {
  readonly id: string;
  slot: SlotId;
  visual?: VisualPrimitive;
  layout?: NodeLayout;
}

/**
 * Backend sem DOM/GPU usado por testes, plugins e validação de determinismo.
 * Materializa exatamente a mesma árvore retida, mas captura um command buffer.
 */
export function createHeadlessRenderBackend(): HeadlessRenderBackend {
  const nodes = new Map<string, RetainedNode>();
  const slotOrders = new Map<SlotId, string[]>(SLOT_IDS.map((slot) => [slot, []]));
  const eventLog: HeadlessBackendEvent[] = [];
  let size: Vec2 = [1, 1];
  let pixelRatio = 1;
  let compositeOrder: readonly SlotId[] = [];
  let state: "new" | "ready" | "disposed" = "new";

  function assertReady(): void {
    if (state !== "ready") {
      throw new RendererError("backend-state", `Backend headless não está pronto (${state}).`);
    }
  }

  function removeFromSlot(nodeId: string, slot: SlotId): void {
    const order = slotOrders.get(slot);
    if (order === undefined) return;
    const index = order.indexOf(nodeId);
    if (index >= 0) order.splice(index, 1);
  }

  function snapshot(): HeadlessBackendSnapshot {
    assertReady();
    const slots = compositeOrder.map((slot) => {
      const order = slotOrders.get(slot) ?? [];
      const retained = order.map((nodeId) => {
        const node = nodes.get(nodeId);
        if (node === undefined || node.visual === undefined || node.layout === undefined) {
          throw new RendererError(
            "backend-state",
            `Nó "${nodeId}" não possui visual/layout no backend headless.`,
          );
        }
        return {
          id: node.id,
          slot: node.slot,
          visual: cloneVisual(node.visual),
          layout: cloneLayout(node.layout),
        };
      });
      return { id: slot, nodes: retained };
    });

    return {
      size: cloneVec2(size),
      pixelRatio,
      compositeOrder: [...compositeOrder],
      slots,
    };
  }

  return {
    kind: "headless",

    async init(_surfaces: SurfaceSet): Promise<void> {
      if (state !== "new") {
        throw new RendererError("backend-state", `init() inválido no estado "${state}".`);
      }
      state = "ready";
      eventLog.push({ kind: "init" });
    },

    resize(nextSize: Vec2, nextPixelRatio: number): void {
      assertReady();
      size = cloneVec2(nextSize);
      pixelRatio = nextPixelRatio;
      eventLog.push({ kind: "resize", size: cloneVec2(nextSize), pixelRatio: nextPixelRatio });
    },

    mount(nodeId: string, slot: SlotId): void {
      assertReady();
      if (nodes.has(nodeId)) {
        throw new RendererError("backend-state", `Nó "${nodeId}" já está montado.`);
      }
      nodes.set(nodeId, { id: nodeId, slot });
      slotOrders.get(slot)?.push(nodeId);
      eventLog.push({ kind: "mount", nodeId, slot });
    },

    move(nodeId: string, slot: SlotId): void {
      assertReady();
      const node = requireNode(nodes, nodeId);
      if (node.slot === slot) return;
      removeFromSlot(nodeId, node.slot);
      node.slot = slot;
      slotOrders.get(slot)?.push(nodeId);
      eventLog.push({ kind: "move", nodeId, slot });
    },

    update(nodeId: string, visual: VisualPrimitive, layout: NodeLayout): void {
      assertReady();
      const node = requireNode(nodes, nodeId);
      node.visual = cloneVisual(visual);
      node.layout = cloneLayout(layout);
      eventLog.push({ kind: "update", nodeId });
    },

    unmount(nodeId: string): void {
      assertReady();
      const node = requireNode(nodes, nodeId);
      removeFromSlot(nodeId, node.slot);
      nodes.delete(nodeId);
      eventLog.push({ kind: "unmount", nodeId });
    },

    setOrder(slot: SlotId, nodeIds: readonly string[]): void {
      assertReady();
      const seen = new Set<string>();
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          throw new RendererError("duplicate-node", `Nó "${nodeId}" está duplicado no slot.`);
        }
        seen.add(nodeId);
        const node = requireNode(nodes, nodeId);
        if (node.slot !== slot) {
          throw new RendererError(
            "backend-state",
            `Nó "${nodeId}" pertence a "${node.slot}", não a "${slot}".`,
          );
        }
      }
      slotOrders.set(slot, [...nodeIds]);
      eventLog.push({ kind: "order", slot, nodeIds: [...nodeIds] });
    },

    composite(order: readonly SlotId[]): void {
      assertReady();
      compositeOrder = [...order];
      eventLog.push({ kind: "composite", slots: [...order] });
    },

    async capture(): Promise<CapturedFrame> {
      assertReady();
      const data = new TextEncoder().encode(JSON.stringify(snapshot()));
      return {
        width: Math.round(size[0] * pixelRatio),
        height: Math.round(size[1] * pixelRatio),
        pixelRatio,
        encoding: "command-buffer",
        data,
      };
    },

    snapshot,

    events(): readonly HeadlessBackendEvent[] {
      return eventLog.map(cloneEvent);
    },

    dispose(): void {
      if (state === "disposed") return;
      nodes.clear();
      for (const slot of SLOT_IDS) slotOrders.set(slot, []);
      compositeOrder = [];
      state = "disposed";
      eventLog.push({ kind: "dispose" });
    },
  };
}

function requireNode(nodes: ReadonlyMap<string, RetainedNode>, nodeId: string): RetainedNode {
  const node = nodes.get(nodeId);
  if (node === undefined) {
    throw new RendererError("backend-state", `Nó "${nodeId}" não está montado.`);
  }
  return node;
}

function cloneVec2(value: Vec2): Vec2 {
  return [value[0], value[1]];
}

function cloneMat2D(value: Mat2D): Mat2D {
  return [value[0], value[1], value[2], value[3], value[4], value[5]];
}

function cloneLayout(layout: NodeLayout): NodeLayout {
  return {
    matrix: cloneMat2D(layout.matrix),
    size: cloneVec2(layout.size),
    opacity: layout.opacity,
    visible: layout.visible,
    blendMode: layout.blendMode,
  };
}

function clonePoints(points: readonly Vec2[]): readonly Vec2[] {
  return points.map(cloneVec2);
}

function cloneVisual(visual: VisualPrimitive): VisualPrimitive {
  switch (visual.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { ...visual };
    case "image":
      return { ...visual };
    case "line":
      return { ...visual, points: clonePoints(visual.points) };
    case "polygon":
      return { ...visual, points: clonePoints(visual.points) };
    case "circle":
      return { ...visual };
    case "symbol":
      return { ...visual };
    case "particles":
      // O buffer é imutável e compartilhado: copiar 5.000 partículas por frame
      // anularia a razão de existir do buffer estático.
      return { ...visual };
  }
}

function cloneEvent(event: HeadlessBackendEvent): HeadlessBackendEvent {
  switch (event.kind) {
    case "resize":
      return { ...event, size: cloneVec2(event.size) };
    case "order":
      return { ...event, nodeIds: [...event.nodeIds] };
    case "composite":
      return { ...event, slots: [...event.slots] };
    default:
      return { ...event };
  }
}
