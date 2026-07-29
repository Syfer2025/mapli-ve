# ADR-023 — MSAA desligado nas superfícies que o export compõe

**Status:** aceito · **Data:** 2026-07-29 · **Revisar em:** quando o dono apontar
borda visivelmente pior, ou quando o driver mudar

## Contexto

Ao medir o gatilho do [ADR-022](ADR-022-export-resolution-from-composition.md) —
export em resolução escolhida — apareceu um defeito que não tem nada a ver com
resolução escolhida e vale mais que ela:

**acima de cerca de 2 megapixels, repintar o mesmo estado não devolve os mesmos
bytes.**

Isso é um ataque direto ao critério 2 da [Fase 8](../08-ROADMAP.md#fase-8--exportação),
que o roteiro chama de o mais importante do projeto inteiro, e ao
[ADR-003](ADR-003-determinism.md), que declara determinismo como invariante do
motor. Passou despercebido porque o frame de export até hoje sai do tamanho do
painel — **1248 × 566 nesta máquina, 0,71 MP**, abaixo do limiar. O
`verify:phase8` está 7/7 há sessões porque nunca exportou grande.

## Medição

Máquina: Windows 10, Electron 43, ANGLE/D3D11, NVIDIA RTX 3060 Ti. Sondas em
`scratchpad/probe-export-resolution-6a.mjs` e `scratchpad/probe-studio-msaa.mjs`.

O método: pôr o container num tamanho, esperar `settle` e quietude do overlay,
ler o canvas, forçar repintura, ler de novo, comparar SHA-256. Sem tocar no
documento nem na câmera entre as leituras.

### O limiar, e que ele não é do tamanho

| Tamanho     | MP   | Mapa `antialias: true` | Mapa `antialias: false` | Palco Three | Overlay Pixi |
| ----------- | ---- | ---------------------- | ----------------------- | ----------- | ------------ |
| 1248 × 566  | 0,71 | idêntico               | idêntico                | idêntico    | idêntico     |
| 1920 × 1080 | 2,07 | idêntico               | idêntico                | idêntico    | idêntico     |
| 2560 × 1440 | 3,69 | **diverge**            | idêntico                | **diverge** | idêntico     |
| 3072 × 1728 | 5,31 | **diverge**            | idêntico                | —           | —            |
| 3840 × 2160 | 8,29 | **diverge**            | idêntico                | **diverge** | idêntico     |

`SAMPLES` valia **4** em todas as linhas com `antialias: true` e **0** com ele
desligado — o driver não trocou a contagem de amostras no meio, então não é isso.
O que muda é só a flag.

Duas leituras que fecham o diagnóstico:

- **A assinatura da divergência é de resolve, não de estado.** Em 3840 × 2160 o
  mapa diferia em **42 pixels de 8.294.400** (0,0005%), delta máximo **6** por
  canal, sobre preenchimento de terra em tom claro, numa faixa oblíqua. Estado
  errado dá região inteira ou deslocamento; rótulo entrando dá delta de ~200.
- **O Pixi não sofre**, com `antialias: true` igual aos outros. Ele resolve o
  multiamostrado no render target dele antes de blitar, e é justamente a etapa
  que os outros dois entregam ao driver.

### O que custa desligar

Mapa em 1920 × 1080, enquadramento fixo no Estreito de Hormuz, estilo detalhado.
Duas rodadas de cada configuração:

| O quê                                                 | MSAA 4   | MSAA 0          |
| ----------------------------------------------------- | -------- | --------------- |
| Energia de borda (média de \|Δverde\| entre vizinhos) | 1,0665   | 1,0848 / 1,0785 |
| Degraus duros (Δ > 40)                                | 6394     | 6455 / 6398     |
| Cores distintas num recorte de 480 × 320              | **2025** | **1642**        |

Ou seja: **1% mais degraus duros e 19% menos valores intermediários.** Os dois
recortes salvos em PNG são indistinguíveis a olho no mesmo zoom. É pouco porque
o MapLibre já suaviza preenchimento e traço **no shader dele**; o MSAA só
acrescenta nas arestas de geometria que não passam por essa suavização.

### De onde a flag veio

`git log -S antialias` aponta um commit só: `b12765d`, "Export de sequência PNG
byte-idêntico". Ela entrou **junto** com o `preserveDrawingBuffer`, e o docstring
extenso ao lado justifica só o `preserveDrawingBuffer`. Não há decisão registrada
para o `antialias: true`, e `false` é o padrão do próprio MapLibre. Foi carona.

## Alternativas

### A. Desligar o MSAA nas superfícies compostas

✅ Repetição bit a bit em todos os tamanhos medidos, até 3840 × 2160.
✅ Volta ao padrão do MapLibre, e remove uma flag que nunca teve justificativa.
✅ Preview e export continuam **o mesmo pipeline**, que é o que
[06-RENDER-PIPELINE § 1](../06-RENDER-PIPELINE.md#1-duas-execuções-um-pipeline)
exige para os dois não divergirem.
❌ Borda 1% mais dura no preview e no arquivo, e 19% menos valores
intermediários. Some com o pouco de suavização que o MSAA acrescentava.
❌ Toca uma reclamação aberta do dono — "contornos do mapa meio grosseiros" — na
direção errada, ainda que por pouco.

### B. Manter o MSAA e limitar o export a 2 MP

✅ Nada muda no que já está verde.
❌ Mata o [ADR-022](ADR-022-export-resolution-from-composition.md): 1920 × 1080 é
2,07 MP e já está **em cima** do limiar. Não há folga.
❌ Deixa um limite de determinismo dependendo de um número que ninguém vê, e o
`verify:phase8` continuaria verde por exportar pequeno.

### C. MSAA no preview, sem MSAA no export — duas superfícies

✅ Guarda a suavização onde o usuário olha e o determinismo onde ele grava.
❌ `antialias` é atributo de contexto e se fixa na criação: exige a **janela de
render oculta**, que o ADR-022 mediu e recusou por cache frio a cada export.
❌ Preview e export passariam a ser pipelines diferentes de propósito, que é
exatamente o que o 06-RENDER-PIPELINE proíbe.

### D. Suavização por supersampling no lugar do MSAA

Exportar acima e reduzir por filtro conhecido, no nosso código.

✅ Determinístico por construção — a redução é aritmética nossa, não do driver.
✅ Qualidade melhor que MSAA 4×, e uniforme entre as três superfícies.
❌ Custo linear no fator: 2× em cada eixo são 4× os pixels, e o readback medido
já é 3,5 ms/MP.
❌ Não resolve o preview, que continuaria sem suavização nenhuma.
❌ É trabalho novo com decisão própria, e não é pré-requisito de nada hoje.

## Decisão

**Alternativa A: `antialias: false` no canvas do mapa e no renderer do palco.**

O overlay Pixi fica como está — ele já repete bit a bit e resolve o
multiamostrado no próprio render target, então desligar só pioraria a imagem sem
comprar nada.

Determinismo é invariante declarado; suavização de borda é preferência. Quando os
dois se cruzam, o invariante ganha — e o preço medido é 1%.

## Consequências

- **O critério 2 da Fase 8 passa a valer acima de 2 MP**, que é a condição para o
  ADR-022 existir. Sem isto, escolher a resolução seria escolher entre resolução
  e determinismo.
- **A borda fica 1% mais dura, no preview e no arquivo.** Aceito e medido. A
  reclamação em aberto do dono sobre contorno grosseiro **não era isto**: o
  MapLibre suaviza preenchimento e traço no shader, e o MSAA acrescentava
  sobretudo nas arestas de geometria. A pergunta "onde exatamente está grosseiro"
  continua para o dono, e a resposta provavelmente está em quantização da malha,
  largura de traço ou HiDPI — não em MSAA.
- **`SAMPLES` vira afirmação de teste, não confiança.** Alguém vai reintroduzir
  `antialias: true` por qualidade, e o custo não aparece em nenhum teste que
  exporte no tamanho do painel. O verificador tem de exportar **acima de 2 MP** e
  afirmar `SAMPLES === 0` nas duas superfícies, senão esta decisão se desfaz em
  silêncio na primeira vez que alguém mexer.
- **O palco perde MSAA nas arestas do modelo 3D**, onde ele fazia mais efeito que
  no mapa. É o custo mais visível desta decisão, e a mitigação honesta é o
  supersampling da alternativa D quando alguém reclamar — com o ADR próprio que
  ela pede.

## Quando revisar

1. Quando o dono apontar borda visivelmente pior em captura específica. Aí a
   alternativa D entra com medição de custo em 4K.
2. Quando o driver ou a versão do Chromium mudar: o limiar de 2 MP é desta
   combinação ANGLE/D3D11 + RTX 3060 Ti, e o verificador é o que vai contar se
   ele mudou.
3. Se aparecer superfície nova composta pelo export, ela entra nesta decisão
   antes de entrar no `frame-composer`.
