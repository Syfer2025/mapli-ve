import type { Vec2 } from "@theatrum/core-math";
import type {
  CapturedFrame,
  Compositor,
  RenderBackend,
  Renderable,
  Renderer,
  ScreenNode,
  ScreenScene,
  SlotId,
  SurfaceSet,
} from "./contracts.js";
import { assertUniqueSlots, createCompositor } from "./compositor.js";
import { RendererError } from "./errors.js";
import type { RenderableRegistry } from "./registry.js";

export interface CreateRendererOptions {
  readonly backend: RenderBackend;
  readonly registry: RenderableRegistry;
  readonly missingRenderable?: "throw" | "skip";
}

interface MountedRenderable {
  readonly id: string;
  type: string;
  slot: SlotId;
  renderable: Renderable;
}

export function createRenderer(options: CreateRendererOptions): Renderer {
  return new RetainedRenderer(options);
}

class RetainedRenderer implements Renderer {
  readonly backend;
  readonly #renderBackend: RenderBackend;
  readonly #registry: RenderableRegistry;
  readonly #compositor: Compositor;
  readonly #missingRenderable: "throw" | "skip";
  readonly #mounted = new Map<string, MountedRenderable>();
  #state: "new" | "ready" | "disposed" = "new";
  #size: Vec2 = [1, 1];
  #pixelRatio = 1;

  constructor(options: CreateRendererOptions) {
    this.#renderBackend = options.backend;
    this.backend = options.backend.kind;
    this.#registry = options.registry;
    this.#compositor = createCompositor(options.backend);
    this.#missingRenderable = options.missingRenderable ?? "throw";
  }

  async init(surfaces: SurfaceSet): Promise<void> {
    if (this.#state !== "new") {
      throw new RendererError("invalid-lifecycle", `init() inválido no estado "${this.#state}".`);
    }
    await this.#renderBackend.init(surfaces);
    this.#state = "ready";
  }

  resize(size: Vec2, pixelRatio: number): void {
    this.#assertReady();
    validateSize(size, pixelRatio);
    this.#size = [size[0], size[1]];
    this.#pixelRatio = pixelRatio;
    this.#renderBackend.resize(size, pixelRatio);
  }

  render(scene: ScreenScene, slots: readonly SlotId[]): void {
    this.#assertReady();
    validateScene(scene);
    assertUniqueSlots(slots);

    if (
      scene.size[0] !== this.#size[0] ||
      scene.size[1] !== this.#size[1] ||
      scene.pixelRatio !== this.#pixelRatio
    ) {
      this.resize(scene.size, scene.pixelRatio);
    }

    const selectedSlots = new Set(slots);

    for (const nodeId of scene.drawOrder) {
      const node = scene.nodes.get(nodeId);
      if (node === undefined || !selectedSlots.has(node.slot)) continue;
      const mounted = this.#mounted.get(nodeId);
      const requiresFactory = mounted === undefined || mounted.type !== node.type;
      if (
        requiresFactory &&
        this.#missingRenderable === "throw" &&
        !this.#registry.has(node.type)
      ) {
        throw new RendererError(
          "missing-renderable",
          `Nenhuma factory registrada para o tipo "${node.type}".`,
        );
      }
    }

    const desired = new Set<string>();
    const orderBySlot = new Map<SlotId, string[]>(slots.map((slot) => [slot, []]));

    for (const nodeId of scene.drawOrder) {
      const node = scene.nodes.get(nodeId);
      if (node === undefined) continue;
      if (!selectedSlots.has(node.slot)) continue;

      if (!this.#renderNode(node)) continue;
      desired.add(nodeId);
      const order = orderBySlot.get(node.slot);
      order?.push(nodeId);
    }

    for (const entry of [...this.#mounted.values()]) {
      if (selectedSlots.has(entry.slot) && !desired.has(entry.id)) {
        this.#unmount(entry);
      }
    }

    for (const slot of slots) {
      this.#renderBackend.setOrder(slot, orderBySlot.get(slot) ?? []);
    }
    this.#compositor.composite(slots);
  }

  capture(slots: readonly SlotId[]): Promise<CapturedFrame> {
    this.#assertReady();
    return this.#compositor.captureComposite(slots);
  }

  invalidate(nodeIds: readonly string[] | "all"): void {
    if (this.#state === "disposed") return;
    const ids = nodeIds === "all" ? [...this.#mounted.keys()] : nodeIds;
    const seen = new Set<string>();
    for (const nodeId of ids) {
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      const entry = this.#mounted.get(nodeId);
      if (entry !== undefined) this.#unmount(entry);
    }
  }

  dispose(): void {
    if (this.#state === "disposed") return;
    if (this.#state === "ready") {
      for (const entry of [...this.#mounted.values()]) this.#unmount(entry);
    }
    this.#renderBackend.dispose();
    this.#state = "disposed";
  }

  #renderNode(node: ScreenNode): boolean {
    let entry = this.#mounted.get(node.id);
    if (entry !== undefined && entry.type !== node.type) {
      this.#unmount(entry);
      entry = undefined;
    }

    if (entry === undefined) {
      const factory = this.#registry.get(node.type);
      if (factory === undefined) {
        if (this.#missingRenderable === "skip") return false;
        throw new RendererError(
          "missing-renderable",
          `Nenhuma factory registrada para o tipo "${node.type}".`,
        );
      }

      const renderable = factory();
      this.#renderBackend.mount(node.id, node.slot);
      try {
        renderable.mount({
          nodeId: node.id,
          submit: (visual, layout) => {
            this.#renderBackend.update(node.id, visual, layout);
          },
        });
      } catch (error: unknown) {
        this.#renderBackend.unmount(node.id);
        throw error;
      }

      entry = { id: node.id, type: node.type, slot: node.slot, renderable };
      this.#mounted.set(node.id, entry);
    } else if (entry.slot !== node.slot) {
      this.#renderBackend.move(node.id, node.slot);
      entry.slot = node.slot;
    }

    entry.renderable.update(node, node.layout);
    return true;
  }

  #unmount(entry: MountedRenderable): void {
    this.#mounted.delete(entry.id);
    try {
      entry.renderable.unmount();
    } finally {
      this.#renderBackend.unmount(entry.id);
    }
  }

  #assertReady(): void {
    if (this.#state !== "ready") {
      throw new RendererError(
        "invalid-lifecycle",
        `Renderer não está pronto (estado "${this.#state}").`,
      );
    }
  }
}

function validateSize(size: Vec2, pixelRatio: number): void {
  if (
    !Number.isFinite(size[0]) ||
    size[0] <= 0 ||
    !Number.isFinite(size[1]) ||
    size[1] <= 0 ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0
  ) {
    throw new RendererError("backend-state", "Tamanho e pixelRatio devem ser positivos e finitos.");
  }
}

function validateScene(scene: ScreenScene): void {
  validateSize(scene.size, scene.pixelRatio);
  if (!Number.isFinite(scene.frame)) {
    throw new RendererError("backend-state", "O frame da cena deve ser finito.");
  }

  const seen = new Set<string>();
  for (const nodeId of scene.drawOrder) {
    if (seen.has(nodeId)) {
      throw new RendererError("duplicate-node", `Nó "${nodeId}" está duplicado em drawOrder.`);
    }
    seen.add(nodeId);
    const node = scene.nodes.get(nodeId);
    if (node === undefined) {
      throw new RendererError("missing-node", `drawOrder referencia o nó ausente "${nodeId}".`);
    }
    if (node.id !== nodeId) {
      throw new RendererError(
        "backend-state",
        `A chave "${nodeId}" aponta para o nó de id "${node.id}".`,
      );
    }
    validateNode(node);
  }
  if (seen.size !== scene.nodes.size) {
    throw new RendererError("missing-node", "A cena contém nós fora de drawOrder.");
  }
}

function validateNode(node: ScreenNode): void {
  const values = [...node.layout.matrix, ...node.layout.size, node.layout.opacity];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RendererError("backend-state", `Layout inválido para o nó "${node.id}".`);
  }
  if (node.layout.size[0] < 0 || node.layout.size[1] < 0) {
    throw new RendererError("backend-state", `Tamanho negativo no nó "${node.id}".`);
  }
}
