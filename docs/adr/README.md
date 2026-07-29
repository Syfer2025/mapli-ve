# Architecture Decision Records

Cada ADR registra **uma** decisão: o contexto, as alternativas consideradas, a
escolha, e as consequências aceitas.

Um ADR não é revisado por opinião. É revisado quando o gatilho registrado nele
dispara — geralmente uma medição, numa fase específica.

| #                                                    | Decisão                                               | Status                                        | Revisar em                                                         |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| [001](ADR-001-shell-electron.md)                     | Electron em vez de Tauri                              | aceito                                        | Fase 8                                                             |
| [002](ADR-002-compositor.md)                         | Composição mapa + overlay por canvases empilhados     | aceito                                        | Fase 11                                                            |
| [003](ADR-003-determinism.md)                        | Determinismo como invariante do motor                 | aceito                                        | nunca                                                              |
| [004](ADR-004-time-in-frames.md)                     | Frame inteiro como unidade canônica de tempo          | aceito                                        | nunca                                                              |
| [005](ADR-005-canvas-timeline.md)                    | Timeline e graph editor em canvas                     | aceito                                        | Fase 4                                                             |
| [006](ADR-006-maplibre.md)                           | MapLibre GL JS + PMTiles                              | aceito                                        | improvável                                                         |
| [007](ADR-007-no-rust-yet.md)                        | Nenhum Rust por enquanto                              | aceito                                        | Fases 8 e 11                                                       |
| [008](ADR-008-flat-node-map.md)                      | Mapa plano de nós em vez de árvore aninhada           | aceito                                        | improvável                                                         |
| [009](ADR-009-geo-layers-overlay.md)                 | Camadas geográficas desenhadas no overlay             | aceito                                        | Fase 11                                                            |
| [010](ADR-010-precompiled-geo-mesh.md)               | Malha geográfica pré-compilada em Int32               | aceito                                        | improvável                                                         |
| [011](ADR-011-roads-spatial-join.md)                 | Estradas agrupadas por país via junção espacial       | aceito                                        | Fase 11                                                            |
| [012](ADR-012-studio-own-canvas.md)                  | Modo estúdio em canvas próprio                        | aceito, emendado pelo 014                     | Fase 8                                                             |
| [013](ADR-013-export-frame-composition.md)           | Composição do frame de export ao vivo                 | aceito; tabela pelo 014, tamanho pelo 022     | gatilho disparado — ver ADR-022                                    |
| [014](ADR-014-studio-own-panel.md)                   | Palco 3D em painel próprio                            | aceito                                        | Fase 9, se houver mais de um palco                                 |
| [015](ADR-015-studio-points-of-interest.md)          | POI do palco vem de clique, não do arquivo 3D         | aceito, emendado pelo 016                     | quando entrar modelo com rig real                                  |
| [016](ADR-016-poi-anchored-to-object.md)             | POI ancorado no objeto, em espaço normalizado         | aceito                                        | quando entrar modelo com rig real, ou dono que não seja `model3d`  |
| [017](ADR-017-studio-authoring-camera.md)            | Câmera de autoria local ao painel do palco            | aceito                                        | quando alguém pedir _roll_ ou câmera fora do eixo no palco         |
| [018](ADR-018-studio-planar-floor-reflection.md)     | Reflexo do piso por câmera espelhada e render target  | aceito                                        | vários planos, piso fora de `y = 0` ou custo acima do orçamento    |
| [019](ADR-019-studio-aware-timeline.md)              | Mesma Timeline projeta Mapa ou Palco                  | aceito                                        | vários palcos, duas superfícies visíveis ou duração própria de POI |
| [020](ADR-020-studio-decals.md)                      | Marcação no objeto é decalque projetado               | **proposto** — plano estacionado              | marcação que precise sobreviver fora do Theatrum                   |
| [021](ADR-021-asset-animation-clips.md)              | Clipe mora no asset, tempo dele no documento          | **proposto** — plano estacionado              | mistura de clipes (andar e apontar juntos)                         |
| [022](ADR-022-export-resolution-from-composition.md) | Resolução do export vem da composição                 | aceito, emenda o 013                          | editar durante export, ou 8K                                       |
| [023](ADR-023-no-msaa-on-composed-surfaces.md)       | MSAA desligado nas superfícies compostas              | aceito                                        | borda pior apontada pelo dono, ou driver novo                      |
| [024](ADR-024-deterministic-supersampling.md)        | Suavização por supersampling, no nosso código         | **proposto** — executa a alternativa D do 023 | custo acima de 30 ms/MP, ou supersampling no preview               |
| [025](ADR-025-motion-blur-accumulation.md)           | Motion blur por acumulação de subframes no compositor | **proposto**                                  | custo acima de 250 ms/frame em 4K, ou blur de câmera no mapa       |

## Formato

```markdown
# ADR-NNN — Título curto e afirmativo

**Status:** proposto | aceito | substituído por ADR-MMM | obsoleto
**Data:** AAAA-MM-DD
**Revisar em:** Fase N | nunca | improvável

## Contexto

Que problema existe. Que restrições valem. Sem solução ainda.

## Alternativas

Cada opção real considerada, com ✅ e ❌ honestos. Uma alternativa sem
vantagem listada é sinal de que não foi considerada de verdade.

## Decisão

A escolha, em uma frase.

## Consequências

Positivas e negativas. As negativas são **aceitas**, não escondidas.
Cada custo com sua mitigação, quando existe.

## Quando revisar

O gatilho concreto. "Se X medir mais que Y na fase Z."
```

## Regras

1. **ADRs são imutáveis.** Mudou de ideia? Novo ADR que substitui o antigo. O
   antigo fica, marcado como substituído. O histórico da decisão tem valor.
2. **Uma decisão por ADR.** Se o título tem "e", provavelmente são dois.
3. **Alternativas com vantagens reais.** Espantalho não é alternativa.
4. **Consequência negativa é obrigatória.** Decisão sem custo é decisão não
   examinada.
5. **Gatilho de revisão concreto.** "Reavaliar no futuro" não é gatilho.
