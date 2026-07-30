import { describe, expect, it } from "vitest";
import { positionFloatingMenu } from "./floating-menu.js";

describe("positionFloatingMenu", () => {
  it("abre abaixo da âncora e permanece dentro da lateral direita", () => {
    expect(
      positionFloatingMenu(
        { left: 900, top: 40, right: 920, bottom: 60 },
        { width: 1024, height: 700 },
      ),
    ).toEqual({ left: 800, top: 64, maxHeight: 432 });
  });

  it("abre acima quando não há espaço útil abaixo", () => {
    expect(
      positionFloatingMenu(
        { left: 12, top: 560, right: 32, bottom: 580 },
        { width: 900, height: 600 },
      ),
    ).toEqual({ left: 12, top: 124, maxHeight: 432 });
  });

  it("protege as margens em viewport estreito e limita a altura", () => {
    expect(
      positionFloatingMenu(
        { left: -20, top: 20, right: 0, bottom: 40 },
        { width: 200, height: 140 },
      ),
    ).toEqual({ left: 8, top: 44, maxHeight: 88 });
  });
});
