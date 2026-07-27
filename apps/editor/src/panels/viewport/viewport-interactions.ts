import { normalizeDegrees, rect, type Rect, type Vec2 } from "@theatrum/core-math";

export type GizmoMode = "position" | "rotation" | "scale";

export interface SelectableLayout {
  readonly bounds: Rect;
  readonly culled: boolean;
}

export interface TransformSnapshot {
  readonly position: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
}

export interface TransformDrag {
  readonly mode: GizmoMode;
  readonly start: Vec2;
  readonly current: Vec2;
  readonly center: Vec2;
  readonly initial: TransformSnapshot;
  readonly uniformScale?: boolean;
}

/**
 * Hit-test em ordem visual: o último nó desenhado é o primeiro candidato.
 * Layouts invisíveis/cortados não interceptam o clique.
 */
export function hitTestLayouts(
  layouts: ReadonlyMap<string, SelectableLayout>,
  drawOrder: readonly string[],
  point: Vec2,
  eligible: (nodeId: string) => boolean = () => true,
): string | null {
  for (let index = drawOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = drawOrder[index];
    if (nodeId === undefined || !eligible(nodeId)) continue;
    const layout = layouts.get(nodeId);
    if (layout !== undefined && !layout.culled && rect.contains(layout.bounds, point)) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Seleção por marquee na mesma ordem estável do desenho. Por padrão basta
 * interseção; Alt exige que o objeto esteja inteiramente contido.
 */
export function marqueeLayouts(
  layouts: ReadonlyMap<string, SelectableLayout>,
  drawOrder: readonly string[],
  marquee: Rect,
  options: {
    readonly contained?: boolean;
    readonly eligible?: (nodeId: string) => boolean;
  } = {},
): readonly string[] {
  const selection: string[] = [];
  const eligible = options.eligible ?? (() => true);
  for (const nodeId of drawOrder) {
    if (!eligible(nodeId)) continue;
    const layout = layouts.get(nodeId);
    if (layout === undefined || layout.culled) continue;
    const matches = options.contained
      ? containsRect(marquee, layout.bounds)
      : rect.intersects(marquee, layout.bounds);
    if (matches) selection.push(nodeId);
  }
  return Object.freeze(selection);
}

export function rectFromDrag(start: Vec2, current: Vec2): Rect {
  return {
    x: Math.min(start[0], current[0]),
    y: Math.min(start[1], current[1]),
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
  };
}

/**
 * Cálculo puro compartilhado pelos três gizmos. O viewport pode desenhar um
 * preview durante o arrasto e enviar apenas um comando no pointerup.
 */
export function transformFromDrag(drag: TransformDrag): TransformSnapshot {
  if (drag.mode === "position") {
    return {
      ...drag.initial,
      position: [
        drag.initial.position[0] + drag.current[0] - drag.start[0],
        drag.initial.position[1] + drag.current[1] - drag.start[1],
      ],
    };
  }

  if (drag.mode === "rotation") {
    const initialAngle = Math.atan2(drag.start[1] - drag.center[1], drag.start[0] - drag.center[0]);
    const currentAngle = Math.atan2(
      drag.current[1] - drag.center[1],
      drag.current[0] - drag.center[0],
    );
    return {
      ...drag.initial,
      rotation: normalizeDegrees(
        drag.initial.rotation + ((currentAngle - initialAngle) * 180) / Math.PI,
      ),
    };
  }

  const initialVector: Vec2 = [drag.start[0] - drag.center[0], drag.start[1] - drag.center[1]];
  const currentVector: Vec2 = [drag.current[0] - drag.center[0], drag.current[1] - drag.center[1]];
  const initialDistance = Math.max(1e-6, Math.hypot(...initialVector));
  const ratio = Math.max(0.01, Math.hypot(...currentVector) / initialDistance);
  if (drag.uniformScale !== false) {
    return {
      ...drag.initial,
      scale: [drag.initial.scale[0] * ratio, drag.initial.scale[1] * ratio],
    };
  }

  const xRatio =
    Math.abs(initialVector[0]) < 1e-6 ? 1 : Math.max(0.01, currentVector[0] / initialVector[0]);
  const yRatio =
    Math.abs(initialVector[1]) < 1e-6 ? 1 : Math.max(0.01, currentVector[1] / initialVector[1]);
  return {
    ...drag.initial,
    scale: [drag.initial.scale[0] * xRatio, drag.initial.scale[1] * yRatio],
  };
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
