import { describe, expect, it } from "vitest";
import { incompleteVideoReason } from "./video-encoder.js";

describe("video encoder publication guard", () => {
  it("aceita somente a quantidade exata de frames e bytes positivos", () => {
    expect(incompleteVideoReason({ frames: 5400, bytes: 1024 }, 5400)).toBeNull();
  });

  it("recusa flush parcial antes da publicação atômica", () => {
    expect(incompleteVideoReason({ frames: 5399, bytes: 1024 }, 5400)).toContain("5399/5400");
  });

  it("recusa arquivo vazio mesmo com a contagem declarada", () => {
    expect(incompleteVideoReason({ frames: 12, bytes: 0 }, 12)).toContain("bytes");
  });
});
