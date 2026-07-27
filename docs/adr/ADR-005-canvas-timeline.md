# ADR-005 — Timeline e graph editor em canvas

**Status:** aceito · **Data:** 2026-07-26 · **Revisar em:** Fase 4

## Contexto

A timeline exibe, simultaneamente:

- 50–300 trilhas (uma por nó, mais uma por propriedade animada expandida)
- 500–5.000 keyframes visíveis
- Barras de duração de layer, marcadores, work area, playhead, régua de tempo
- Curvas de valor e velocidade no graph editor

E precisa redesenhar a 60 fps durante scrub, arraste de keyframe e zoom.

## Decisão

**Canvas 2D** para as trilhas da timeline, o graph editor e as curvas.
**DOM** para tudo o resto — cabeçalhos de trilha, painéis, menus, campos.

## Alternativas

### DOM puro (um elemento por keyframe)

- ✅ Hit-testing e acessibilidade nativos, CSS
- ❌ 5.000 nós DOM que mudam de posição a 60 fps. Recalc de estilo e layout do
  Chromium não sustenta isso. Medição típica: 30–80 ms por frame com 3.000
  elementos posicionados absolutamente.
- ❌ Memória: ~1 KB por nó DOM.

### SVG

- ❌ Mesmo problema do DOM — cada `<circle>` é um nó no mesmo pipeline de layout.

### Virtualização de DOM (renderizar só o visível)

- ✅ Reduz a contagem de nós
- ❌ Ajuda no eixo vertical (trilhas), mas não no horizontal: com a timeline
  ampliada, 2.000 keyframes de uma trilha podem estar visíveis ao mesmo tempo.
- ❌ Complexidade alta de virtualização em dois eixos, com resultado ainda
  inferior a canvas.

### WebGL

- ✅ Sustentaria 100× mais elementos
- ❌ Desproporcional. Canvas 2D com culling já atende o orçamento de 4 ms com
  folga. Complicaria texto (rótulos de trilha, timecode) sem ganho perceptível.

## Consequências

Positivas:

- Redesenho da timeline inteira em < 4 ms com culling por viewport.
- Controle total de aparência — keyframes em losango, tipos de easing distintos,
  cores de label, barras de duração com cantos.
- Uma única superfície redesenhada: sem inconsistência de sub-frame entre elementos.

Negativas e mitigações:

| Custo                     | Mitigação                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Hit-testing manual        | Índice espacial (quadtree ou grid uniforme) reconstruído por mudança, não por frame                                          |
| Sem acessibilidade nativa | Camada DOM invisível espelhando os elementos para leitor de tela; cabeçalhos de trilha são DOM real e navegáveis por teclado |
| Cursor e hover manuais    | `interactions.ts` centraliza; hover por hit-test em `mousemove` com throttle                                                 |
| Nada de CSS               | Design tokens lidos em JS a partir de `getComputedStyle` na raiz, uma vez, e em troca de tema                                |
| Suporte a HiDPI manual    | `canvas.width = cssWidth × devicePixelRatio`, escala no contexto                                                             |
| Seleção de texto          | Não aplicável — a timeline não tem texto selecionável                                                                        |

## Fronteira

```
┌──────────────────┬───────────────────────────────────────┐
│  DOM             │  CANVAS                               │
│                  │                                       │
│  cabeçalho de    │  ═══════════════════════════ playhead │
│  trilha:         │  ◆────────◆         ◆                 │
│  nome, olho,     │      ◆         ◆────────◆             │
│  cadeado, solo,  │  ▬▬▬▬▬▬▬▬▬▬▬  barra de duração        │
│  cor, expandir   │  ◆   ◆   ◆   ◆   ◆                    │
│                  │                                       │
│  (~200 nós,      │  (1 canvas, milhares de elementos     │
│   scroll         │   desenhados, culling por viewport)   │
│   virtualizado)  │                                       │
└──────────────────┴───────────────────────────────────────┘
```

A divisão vertical é natural: os cabeçalhos são poucos, precisam de widget
interativo real (checkbox, campo de texto, color picker) e de acessibilidade. As
trilhas são muitas e são desenho.

## Aplica-se também a

- **Graph editor** — curvas bezier com handles arrastáveis
- **Viewport** — mapa e overlay (já são canvas por natureza)
- **Waveform de áudio** (Fase 11)
- **Miniaturas de vídeo** na timeline (Fase 11)

## Quando revisar

Fase 4, se o hit-testing manual se mostrar fonte recorrente de bug. A alternativa
nesse caso não é voltar a DOM — é isolar melhor a camada de interação, com um
índice espacial mais rigoroso e testes de propriedade sobre hit-test.
