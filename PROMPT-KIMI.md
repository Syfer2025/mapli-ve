# Prompt de continuação — Theatrum

Copie tudo abaixo da linha e cole na sessão nova.

---

Você vai continuar o **Theatrum**, um editor de animação geopolítica/militar
estilo After Effects, 100% local e offline. Repositório em `D:\maplive\map\mapli-ve`,
remote `https://github.com/Syfer2025/mapli-ve` (branch `main`, último commit
`f460b1a`).

## Antes de escrever qualquer código, leia nesta ordem

1. `docs/09-CONTINUIDADE.md` — passagem de bastão. **§1** diz onde parou, **§3** o
   que falta, **§4** as 18 armadilhas já pagas desta base, **§5** como verificar
   de verdade, **§8** o estilo de trabalho combinado com o dono.
2. `docs/08-ROADMAP.md` — estado de cada fase com critérios de saída. Atenção: a
   seção **7A+** tem três afirmações **riscadas** porque foram derrubadas por
   medição no 7A++. Leia o 7A++ antes de tocar na camada 3D.
3. `docs/adr/` — as decisões já tomadas, com alternativa honesta e consequência
   negativa declarada. **ADR-014** (palco em painel próprio) e **ADR-015** (pontos
   de interesse) são os mais recentes. O ADR-015 tem uma **nota de implementação**
   no fim com três desvios da própria letra dele, e o motivo medido de cada um.

## Bootstrap — obrigatório, e as mensagens de erro não dizem que falta bootstrap

```bash
pnpm install && pnpm data:fetch && pnpm geo:build && pnpm check
```

`Cannot find module '@theatrum/export'` é link de workspace faltando, não código
errado. `Malha "countries" ausente` pede `geo:build`. `data:fetch` é o único
comando do projeto que usa rede. Detalhe em 09-CONTINUIDADE §4.18.

Se `pnpm` não estiver no PATH da sua máquina — **é o caso da máquina do dono** —
rode os binários direto: `export PATH="$PWD/node_modules/.bin:$PATH"` e então
`tsc -b`, `tsc -p tsconfig.test.json`, `tsc -p tsconfig.node.json`,
`tsc -p apps/shell/tsconfig.json`, `tsc -p apps/editor/tsconfig.json`, `eslint .`,
`prettier --check .`, `depcruise packages apps --config .dependency-cruiser.cjs`,
`vitest run`, `electron-vite dev`. E `node tools/fetch-data.ts --verify` à mão
antes do dev, porque o `predev` também chama `pnpm`.

Estado esperado depois do bootstrap: **1.052 testes em 106 arquivos, verde**, 344
módulos e 930 dependências sem violação de camada, build electron-vite ok.

## Onde o projeto está

Fases 0–6 concluídas. Bloco 7 inteiro fechado (única exceção declarada: 7E.4,
VFX volumétrico, adiado pelo dono e bloqueado por não haver Blender/Houdini/
OpenVDB na máquina). A **Fase 8 produz MP4 H.264, GIF, ProRes 4444 com alfa e PNG
normal/alfa, byte-idênticos entre execuções** — o critério que o roteiro chama de
mais importante do projeto.

Oito verificadores dirigem o **Electron real** por CDP na porta 9222:
`verify:phase7a`, `7b` (4/4), `7c`, `7d` (4/4), `7e3` (**6/6**), `phase8` (7/7),
`phase8-video` (6/6), `phase8-formats` (5/5).

**O ADR-015 acabou de ser fechado** — era o último pedido do dono: a câmera vai
até o míssil e ele fala do míssil. Quatro peças entregues: tipo de nó
`studio.poi`, botão **Marcar pontos** com raycast na superfície do modelo,
marcadores numerados, e **Compilar roteiro**, que transforma a sequência de
pontos em keyframes das seis props de câmera do `studio.stage`.

Três coisas dele que você vai encontrar, e que não deve "melhorar" sem medir:

- **O marcador não vai no overlay Pixi do palco.** Aquele overlay É composto no
  frame de export. Marcador é chrome de autoria e mora em
  `.studio-viewport__markers`, declarado em `EXCLUDED_SURFACE_SELECTORS`. É assim
  que o critério 8 da Fase 8 — nenhum elemento de UI em nenhum frame — continua
  sendo atendido por construção, e não por alguém lembrar de desligar um modo.
- **O ponto vem de clique, não de nó do glTF.** Foi medido: o obuseiro 2S19M1 do
  dono tem 0 animações, 0 skins e 51 nós irmãos `Object_2`…`Object_50`, agrupados
  por **material** — 20 das 49 malhas atravessam mais de 60% de um eixo do
  veículo. Não existe "o nó da torre". Vale para qualquer modelo OBJ → Sketchfab.
- **POI leva a câmera até a torre; não a gira.** Girar exige `gltf.animations`,
  hoje descartado em `three-assets.ts`, e um modelo com a torre como nó separado.

## O que fazer, na ordem

1. **Aviso de POI órfão na interface.** É o limite declarado do ADR-015 e o único
   pedaço dele que ficou sem entregar: o ponto guarda **metros absolutos** do
   palco, então mover o `model3d` em `stageX`/`stageZ` — ou trocar o GLB — deixa
   os pontos onde estavam, e eles podem cair no vazio. O ADR diz que "o aviso cabe
   na interface, não no modelo de dados". Não conserte mudando o modelo de dados
   sem escrever um ADR novo: amarrar POI a nó do arquivo é justamente o que o
   ADR-015 rejeitou.
2. **Resolução acima do tamanho da janela.** Hoje o frame sai no tamanho do
   viewport e o H.264 exige dimensão par (1227×643 vira 1226×642). É o gatilho
   declarado no ADR-013 para voltar à janela de render oculta — e é a decisão que
   deve fechar de vez o `packages/engine`, hoje um esqueleto enquanto
   `apps/editor` importa L2/L3 direto.
3. **Fase 7 (ações): templates de impacto.** Nada dela ameaça o que já está provado.
4. **Motion blur, checkpoint e retomada.**
5. **Duas decisões conscientes que estão pendentes por omissão, não por escolha:**
   - `tools/eslint-rules/rules.test.ts` estoura o limite de 5 s sob contenção de
     workers e passa em 4 s rodando sozinho. É orçamento de tempo, não regressão —
     mas um teste que fica vermelho conforme a carga da máquina precisa de decisão
     explícita, não de sorte.
   - `fc.assert` roda **sem semente fixa** em toda a base. Num projeto cuja tese
     central é determinismo, vale decidir de propósito entre `{ seed: N }`
     (reprodutível, achado congelado) e semente livre (continua procurando).
6. **Operacional:** rodar `pnpm dist:win` de novo para incorporar os exemplos ao
   instalador. A tentativa de 2026-07-28 parou por cota de autorização de rede,
   não por erro de código.

## Regras desta base que não são negociáveis

- **Renderização é função pura de `(documento, frame)`.** Sem `Date.now()`, sem
  `Math.random()`, sem estado acumulado. Sem isso não existe export confiável.
- **O documento é a única verdade.** Toda mutação passa pelo Command Bus.
- **Dependência forma um DAG**, verificado por `pnpm lint:arch`, não por disciplina.
- **Offline é requisito**, não modo degradado. Nada de rede no caminho crítico.
- **Decisão de arquitetura vira ADR** antes do código, com alternativas honestas e
  consequência negativa declarada. Uma decisão por arquivo.
- **Medir, não achar.** Quando o número contraria a expectativa, o número ganha.
  Três afirmações "provadas" deste roteiro já caíram por medição.
- **Limite conhecido vai para o roteiro**, não some. Afrouxar teste para ficar
  verde é o erro que este projeto não comete.
- **Entrega em blocos.** Parar no fim de cada bloco, relatar, e só então seguir.
  Nunca despejar blocos grandes de código.
- **Captura de tela não prova sozinha** (09-CONTINUIDADE §4.5). Meça em pixel, ou
  leia o estado pelo CDP.

## Quatro armadilhas que vão te morder nesta ordem

1. **Sinal do painel errado.** O dockview **só monta o painel ativo** — as
   superfícies da aba inativa não existem no DOM, e não é `visibility`, é
   montagem. Isso já quebrou quatro coisas com roupas diferentes, a última na
   sessão passada: rodar `verify:phase8` logo depois do `verify:phase7e3` faz 5 de
   7 critérios falharem com `.maplibregl-canvas ausente`, e a leitura certa não é
   "o export quebrou". **Quando algo não aparece, pergunte primeiro qual aba está
   na frente.**
2. **Trocar de aba do dockview por CDP** só é confiável despachando
   `PointerEvent('pointerdown'/'pointerup')` **no próprio elemento da aba**, com
   `bubbles`, `composed`, `pointerId` e `isPrimary` preenchidos.
   `Input.dispatchMouseEvent` por coordenada funciona "às vezes" — era a pendência
   do ADR-014, e está resolvida assim.
3. **Ângulo é grandeza modular, dos dois lados.** Do lado de quem **afirma**:
   comparar `normalizeDegrees(a)` com `normalizeDegrees(b)` por diferença linear
   atravessa a costura 0/360 (§4.17). Do lado de quem **escreve**: keyframes de
   azimute em 350° e 10° fazem a câmera dar uma volta de 340° pelo lado errado —
   por isso existe `unwrapAzimuths` em `studio-tour.ts`. Vale para banking,
   `geo-bearing` e `orbitCameraPosition`.
4. **Backtick e barra invertida em string de shell** somem sem erro (§4.1). Use as
   ferramentas de escrita de arquivo, e barra normal em caminho de Windows dentro
   de JSON.

Comece confirmando o bootstrap e a suíte verde, com os oito verificadores. Depois
relate o que encontrou antes de mexer no `settle` ou no caminho de export.
