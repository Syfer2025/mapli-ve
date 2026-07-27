/**
 * Comandos `asset.*` — a Biblioteca (bloco 7A) precisa deles para importar,
 * renomear, taggear e remover assets com undo exato. Os bytes ficam fora do
 * histórico (container), o descriptor entra no documento por estes comandos.
 */

import { createDocumentStore } from "@theatrum/document";
import {
  createEmptyProjectDocument,
  type AssetDescriptor,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { createCommandBus, type CommandBus } from "./index.js";

function setup(): { bus: CommandBus; read: () => ProjectDocument; initial: ProjectDocument } {
  const initial = createEmptyProjectDocument();
  const store = createDocumentStore(initial);
  return { bus: createCommandBus(store), read: () => store.get(), initial };
}

function tank(id = "as_tank", src = "assets/ab/hash-t34.png"): AssetDescriptor {
  return {
    id,
    kind: "image",
    src,
    meta: { name: "T-34", mime: "image/png", bytes: 2048, width: 512, height: 256, tags: ["ww2"] },
  };
}

describe("comandos de asset", () => {
  it("adiciona, renomeia, altera tags e remove", () => {
    const { bus, read } = setup();

    expect(bus.dispatch({ type: "asset.add", payload: { asset: tank() } })).toMatchObject({
      ok: true,
    });
    expect(read().assets.map((entry) => entry.id)).toEqual(["as_tank"]);

    expect(
      bus.dispatch({ type: "asset.rename", payload: { assetId: "as_tank", name: "T-34/85" } }),
    ).toMatchObject({ ok: true });
    expect(read().assets[0]?.meta["name"]).toBe("T-34/85");

    expect(
      bus.dispatch({
        type: "asset.set-tags",
        payload: { assetId: "as_tank", tags: ["ww2", "urss"] },
      }),
    ).toMatchObject({ ok: true });
    expect(read().assets[0]?.meta["tags"]).toEqual(["ww2", "urss"]);

    expect(bus.dispatch({ type: "asset.remove", payload: { assetId: "as_tank" } })).toMatchObject({
      ok: true,
    });
    expect(read().assets).toEqual([]);
  });

  it("rejeita id duplicado, src duplicado e asset inexistente", () => {
    const { bus } = setup();

    bus.dispatch({ type: "asset.add", payload: { asset: tank() } });
    expect(bus.dispatch({ type: "asset.add", payload: { asset: tank() } })).toMatchObject({
      ok: false,
    });
    expect(bus.dispatch({ type: "asset.add", payload: { asset: tank("as_outro") } })).toMatchObject(
      { ok: false },
    );
    expect(bus.dispatch({ type: "asset.remove", payload: { assetId: "as_nada" } })).toMatchObject({
      ok: false,
    });
    expect(
      bus.dispatch({ type: "asset.rename", payload: { assetId: "as_nada", name: "x" } }),
    ).toMatchObject({ ok: false });
    expect(
      bus.dispatch({ type: "asset.set-tags", payload: { assetId: "as_nada", tags: [] } }),
    ).toMatchObject({ ok: false });
  });

  it("undo de asset restaura o documento inicial", () => {
    const { bus, read, initial } = setup();

    bus.dispatch({ type: "asset.add", payload: { asset: tank() } });
    bus.dispatch({ type: "asset.rename", payload: { assetId: "as_tank", name: "T-34/85" } });
    bus.dispatch({ type: "asset.remove", payload: { assetId: "as_tank" } });

    expect(bus.undo()).toBe(true);
    expect(read().assets).toHaveLength(1);
    expect(bus.undo()).toBe(true);
    expect(read().assets[0]?.meta["name"]).toBe("T-34");
    expect(bus.undo()).toBe(true);
    expect(read()).toEqual(initial);
  });
});
