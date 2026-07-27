import {
  SLOT_IDS,
  type CapturedFrame,
  type Compositor,
  type RenderBackend,
  type RenderTarget,
  type SlotId,
} from "./contracts.js";
import { RendererError } from "./errors.js";

export function assertUniqueSlots(order: readonly SlotId[]): void {
  const seen = new Set<SlotId>();
  for (const slot of order) {
    if (!SLOT_IDS.includes(slot)) {
      throw new RendererError("backend-state", `Slot desconhecido: "${String(slot)}".`);
    }
    if (seen.has(slot)) {
      throw new RendererError("duplicate-slot", `O slot "${slot}" aparece mais de uma vez.`);
    }
    seen.add(slot);
  }
}

export function createCompositor(backend: RenderBackend): Compositor {
  const targets = new Map<SlotId, RenderTarget>();
  for (const id of SLOT_IDS) targets.set(id, Object.freeze({ id }));

  return {
    slot(id: SlotId): RenderTarget {
      const target = targets.get(id);
      if (target === undefined) {
        throw new RendererError("backend-state", `Slot desconhecido: "${String(id)}".`);
      }
      return target;
    },

    composite(order: readonly SlotId[]): void {
      assertUniqueSlots(order);
      backend.composite(order);
    },

    async captureComposite(order: readonly SlotId[]): Promise<CapturedFrame> {
      assertUniqueSlots(order);
      backend.composite(order);
      return backend.capture();
    },
  };
}
