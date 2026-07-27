# ADR-002 — Composição mapa + overlay

**Status:** aceito · **Data:** 2026-07-26 · **Revisar em:** Fase 11

## Contexto

Precisamos desenhar unidades, setas, texto e efeitos sobre um mapa MapLibre, com
alinhamento sub-pixel em qualquer zoom, bearing e pitch. Algumas camadas deveriam
idealmente ficar **abaixo** dos rótulos do mapa (áreas de controle não devem cobrir
o nome das cidades); outras acima de tudo (títulos, explosões).

Este é o ponto de maior risco técnico do projeto. Duas abordagens, com perfis de
risco muito diferentes.

## Alternativas

### A — Canvases empilhados (escolhida para as Fases 1–10)

MapLibre no seu canvas; Pixi em canvas próprio empilhado por CSS. Sincronização
projetando geo→tela pelo `transform` do MapLibre a cada frame.

- ✅ Sem compartilhamento de contexto WebGL — nenhum conflito de estado GL
- ✅ Pixi usado como foi desenhado, sem gambiarra
- ✅ Falha isolada: bug no overlay não derruba o mapa
- ✅ Implementável na Fase 4 com confiança
- ❌ Overlay é sempre **acima de tudo** no mapa. Sem `below-labels`.
- ❌ Dois contextos GL (custo de VRAM modesto e aceitável)
- ❌ Composição entre camadas limitada a alpha blending de CSS

### B — Contexto WebGL compartilhado (Fase 11, condicional)

Injetar a renderização do Pixi no contexto GL do MapLibre via `CustomLayer`.

- ✅ Interleave real: overlay em qualquer posição da ordem de camadas do estilo
- ✅ Um contexto, um framebuffer, blending real
- ❌ Pixi e MapLibre precisariam coexistir no mesmo contexto, salvando e
  restaurando estado GL a cada troca. É uma fonte conhecida de bugs
  difíceis — VAO, blend state, program binding, scissor.
- ❌ Atualização de qualquer das duas bibliotecas pode quebrar a integração
- ❌ Depuração muito mais difícil

### C — Renderer próprio dentro de `CustomLayer`

Abandonar o Pixi e escrever o renderer de overlay direto em WebGL2 dentro do
custom layer do MapLibre.

- ✅ Controle total, um contexto, sem conflito
- ❌ Custo enorme: batching, atlas de textura, mesh de texto, filtros, tudo do zero
- ❌ Atrasaria o produto em meses para ganhar uma camada de z-order

## Decisão

**Alternativa A**, atrás de uma interface `Compositor` com slots nomeados.

```ts
type SlotId = "below-labels" | "scene" | "above-all" | "ui-overlay";
interface Compositor {
  slot(id: SlotId): RenderTarget;
  composite(order: readonly SlotId[]): void;
}
```

`below-labels` existe na interface desde a Fase 4, mas mapeia para o mesmo canvas
de overlay (ou seja: acaba acima dos rótulos). Na Fase 11, se a alternativa B se
provar viável, o slot passa a usar `CustomLayer` — **mudança interna, contrato
intacto**.

## Consequências

- O produto é completo e utilizável sem `below-labels`. É uma melhoria estética
  (áreas de controle não cobrindo topônimos), não um requisito.
- A abstração de slots custa pouco agora e evita reescrita depois.
- Risco R2 em [01-ARCHITECTURE.md § 10](../01-ARCHITECTURE.md#10-riscos-técnicos-conhecidos).

## Detalhe crítico de implementação

O overlay deve redesenhar **no mesmo tick** que o mapa:

```ts
map.on("render", () => {
  if (overlay.needsRedraw) redrawOverlay();
});
```

Um `requestAnimationFrame` independente produziria um frame de defasagem, visível
como objetos "escorregando" sobre o mapa durante pan rápido. É o sintoma clássico
de overlay mal sincronizado, e é imediatamente perceptível em vídeo.

## Quando revisar

Fase 11, com protótipo isolado da alternativa B antes de qualquer compromisso.
Se o protótipo apresentar instabilidade de estado GL, a decisão é mantida
permanentemente e `below-labels` sai do escopo.
