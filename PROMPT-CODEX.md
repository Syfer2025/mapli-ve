# Prompt de continuação — Theatrum

Copie tudo abaixo da linha e cole na sessão nova.

---

Você vai continuar o **Theatrum**, um editor de animação geopolítica/militar estilo After
Effects, 100% local e offline. Remote `https://github.com/Syfer2025/mapli-ve`, branch `main`.

## Primeiro: preserve as duas mudanças que continuam fora dos commits

A grande sessão que estava sobre `af91230` já foi incorporada em oito blocos locais:
`2bb9ca3` (ADRs), `19dc320` (contrato de asset), `505ae7d` (fluxo do palco),
`16e1ffa` (provas ao vivo), `c79e25f` (correção documental no código), `80e0311`
(decisão do reflexo), `368bb39` (reflexo e provas) e `8decdfe` (resultado medido).
Confirme com `git log -9 --oneline` e rode `git status` antes de qualquer coisa.

Duas mudanças continuam deliberadamente fora desses commits porque são do dono —
preserve:

- `apps/editor/src/export/run-export.ts`: o campo `settleFailedFrames` no `ExportReport`
  (quais frames não assentaram, não só quantos).
- `tools/demo-missao.mjs`: script não rastreado.

Nunca use `git add -A` ou `git add .`: adicione caminhos explicitamente e confira
`git diff --cached` antes de cada commit.

## Antes de escrever qualquer código, leia nesta ordem

1. `docs/09-CONTINUIDADE.md` — passagem de bastão. **§1** onde parou, **§3** o que falta e as
   seções novas desta sessão, **§4** as 18 armadilhas antigas, **§5** como verificar de
   verdade, **§8** o estilo de trabalho combinado com o dono.
2. `docs/08-ROADMAP.md` — **§7F** é a seção nova: os nove pedidos do dono sobre o Palco 3D.
   7F.1 a 7F.6 e 7F.8 estão fechados; a Timeline do Palco é o próximo bloco. A seção
   **7A+** tem afirmações riscadas, derrubadas por medição no 7A++.
3. `docs/adr/` — **ADR-018** é a decisão e a prova final do reflexo planar. Leia também o
   **ADR-016** (POI ancorado no objeto) e o **ADR-017** (câmera de autoria), porque a
   Timeline terá de representar exatamente essas duas estruturas. O ADR-016 tem **nota de
   implementação** com três desvios da letra dele; o ADR-015 está marcado como emendado pelo 016.

## Bootstrap

```bash
pnpm install && pnpm data:fetch && pnpm geo:build && pnpm check
```

Na máquina do dono use o shim do Windows, `pnpm.cmd`; `pnpm` sem extensão pode não
estar no PATH do PowerShell. Se o shim não for localizado, chame os binários em
`node_modules/.bin` diretamente (`tsc.cmd -b`, `vitest.cmd run`, `eslint.cmd .`,
`prettier.cmd --check .`,
`depcruise.cmd packages apps --config .dependency-cruiser.cjs`,
`electron-vite.cmd dev`). Para verificar dados use
`node tools/fetch-data.ts --verify` e `tsx.cmd tools/build-geo.ts --verify` — o
segundo **precisa de tsx**, `node` puro falha com `ERR_MODULE_NOT_FOUND`.

Nesta máquina o bootstrap de dados **já está completo**: 37 assets íntegros, malha geo
compilada e verificada.

Estado esperado: **1.162 testes em 115 arquivos, verde**; 362 módulos e 963 dependências sem
violação de camada.

## Onde o projeto está

Fases 0–6 concluídas, roteiro técnico original do bloco 7 fechado (exceção declarada:
7E.4, VFX, adiado pelo dono), rodada adicional 7F com a Timeline do Palco pendente, e
**Fase 8 produzindo MP4 H.264, GIF, ProRes 4444 e PNG byte-idênticos**.

O gate desta retomada repetiu 7b, 7d, 7e3, 8 e 8-video; o 7e3 passou duas vezes
seguidas. 7a e 7c mantêm a prova do handoff anterior. O de formatos mantém a prova
histórica de outra máquina, mas não roda aqui sem FFmpeg e ffprobe:

| Verificador             | Resultado                            |
| ----------------------- | ------------------------------------ |
| `verify:phase7a`        | `ok: true` · handoff anterior        |
| `verify:phase7b`        | `ok: true` · repetido                |
| `verify:phase7c`        | verde · handoff anterior             |
| `verify:phase7d`        | 4/4 · repetido                       |
| `verify:phase7e3`       | **14/14 duas vezes · repetido**      |
| `verify:phase8`         | 7/7 · repetido                       |
| `verify:phase8-video`   | 6/6 · repetido                       |
| `verify:phase8-formats` | **5/5 histórico; indisponível aqui** |

O `verify:phase7e3` é onde está a prova do palco. Ele é **idempotente**: depois do
reflexo, duas rodadas seguidas deram 14/14 nas duas.

**`verify:phase8-formats` não é regressão — é ambiente.** FFmpeg e ffprobe estão
ausentes. O verificador aceita `THEATRUM_FFMPEG_PATH` e
`THEATRUM_FFPROBE_PATH`; preparar somente o sidecar do aplicativo não basta,
porque a prova também inspeciona os arquivos com ffprobe. Não baixe nada sem o
dono pedir. Os 5/5 registrados no roteiro vêm de outra máquina.

### O painel persistido tornava os verificadores visuais dependentes da ordem

O `verify:phase7e3` ativa a aba do Palco, e o dockview persiste essa escolha. Os
verificadores que medem o Viewport precisam trazê-lo para a frente antes de procurar
canvas/overlay; do contrário, relatam superfície ausente sem haver regressão no que
pretendiam medir.

Corrigidos com `activateViewportTab`: **7b, 7d, phase8 e phase8-video**. O 7a é
insensível à aba porque mede biblioteca/assets. O 7c ainda não tem a proteção — se
falhar de forma estranha, a primeira pergunta é qual aba está na frente. O
`phase8-formats` não participa desse problema: é um processo standalone de
FFmpeg/ffprobe e não abre Electron. Uniformizar a ativação num helper compartilhado
continua sendo trabalho pequeno e pendente.

### Entregue nesta sessão e incorporado nos commits locais

- **ADR-016 — POI ancorado no objeto.** O ponto guardava metros absolutos do palco e ficava
  "no limbo" quando o objeto mudava de escala. Agora `studio.poi` tem `ownerId` e o ponto
  vive no **espaço normalizado do modelo**. Critério 7 mede: ancorado andou 19,94 m e ainda
  acerta o objeto; controle solto andou 0,00 m e acerta o vazio.
- **ADR-017 — câmera de autoria.** Não existia interação de mouse no palco. Agora arrastar
  orbita, Shift/botão do meio desloca, roda aproxima, e clique continua marcando — separados
  por 4 px de deslocamento. A câmera solta **não toca o documento**; "Gravar enquadramento"
  escreve as seis props, exato por construção.
- **Contrato do `assetId` consertado.** O `<select>` do Inspector gravava o **id** do asset e
  todos os leitores tratam o valor como o **`src`** — escolher um modelo deixava o palco vazio
  com `asset ausente: ast_…`. O validador de documento também comparava contra ids, acusando
  o caso correto. **Não havia teste em nenhuma direção**; agora há.
- **Arrastar e soltar** da biblioteca para o palco, com o modelo nascendo onde foi solto
  (raio do cursor contra o piso) e assumindo 18 m de vão.
- **Horizonte e névoa.** O céu era uma cor lisa e o piso nunca a alcançava (sobrava 8% de cor
  de chão no infinito): era a "linha esquisita" que o dono relatou. Critério 9: maior salto
  entre pixels vizinhos caiu de 12,1 para 6,8.
- **Transições e enquadramento.** A distância da visita ignorava a **lente**; agora sai de
  `orbitDistanceToFit` sobre 35% do raio. Alças de aceleração mais suaves. E o **alvo
  acompanha objeto animado** durante a pausa, com keyframe inserido só onde a reta entre os
  vizinhos já não descreve o caminho — fecha o limite declarado no ADR-016.
- **Anotação: bolinha, eixo e balão animado.** O passe de projeção do palco passou a pôr os
  **POIs** no layout, e aí `label.callout` mira o míssil em vez do avião inteiro, sem uma
  linha nova do lado do rótulo. Botão **Anotar ponto** compila a revelação em três fases.
- **Sombra direcional.** Era projetada de cima, com a luz assumida vertical — mancha, não
  sombra. Agora vem da direção da luz, com props `keyAzimuthDeg`/`keyElevationDeg`. Critério
  12: girar a luz meia volta desloca o centroide da sombra em 93 px.
- **Reflexo planar determinístico (ADR-018).** A câmera espelhada em `y = 0` desenha o
  equipamento num target RGBA16F linear; o quad do piso amostra, filtra e aplica ACES,
  Fresnel e queda por distância. Projeto antigo continua pixel-idêntico com intensidade 0;
  nó novo nasce em 0,3. Reflexo e sombra restauram integralmente o estado do renderer em
  `finally`, e a sombra não guarda mais cache de assinatura incompleta.
- **Orçamento medido, sem travar a GPU.** O critério 13b alterna 40 frames OFF e 40 ON em
  ABBA, com `EXT_disjoint_timer_query_webgl2` assíncrona. Duas rodadas 14/14 mediram p95
  CPU ON de 1,20/1,00 ms e GPU Three ON de 0,35/0,37 ms num canvas físico 1951×1129,
  target 976×565 e zero disjoints. A GPU não inclui Pixi nem o compositor.

## O que fazer, na ordem

1. **Timeline própria do modo palco** (pedido 2 do dono). `TimelinePanel.tsx` e
   `timeline-model.ts` não têm **nenhuma** referência a studio/stage. Decida e documente:
   painel separado, ou o mesmo painel com modelo ciente do modo — o segundo é mais consistente
   com o resto do editor. No palco o que interessa são as props de câmera, os POIs e o roteiro,
   não as camadas do mapa.
2. **Contornos do mapa "meio grosseiros"** (queixa do dono, mensagem cortada). **Pergunte onde
   antes de mexer**: no Viewport, no vídeo exportado, ou num zoom específico. Suspeitos a
   medir: quantização da malha pré-compilada em Int32 (ADR-010), antialias do traço no Pixi,
   largura de linha em tela HiDPI, e o recorte Sutherland–Hodgman (§4.9).
3. **Fase 9 — Scene Script.** É a resposta certa ao pedido "integração com qualquer IA":
   `docs/00-VISION.md` declara como **não-objetivo** o editor chamar modelo nenhum, e
   `docs/05-SCENE-SCRIPT.md` diz "o editor não contém IA, contém um compilador".
   `packages/scripting` é stub de 9 linhas. Critérios de saída já escritos no roteiro.
4. **Resolução acima do tamanho da janela.** Gatilho declarado do ADR-013 para a janela de
   render oculta, e a decisão que deve fechar o `packages/engine` — hoje stub de 9 linhas
   enquanto `apps/editor` importa L2/L3 direto.
5. **Motion blur, checkpoint e retomada.**
6. **Duas decisões pendentes por omissão, não por escolha:** o orçamento de tempo do
   `tools/eslint-rules/rules.test.ts` sob contenção de workers, e a semente do `fc.assert`.
   Esta sessão usou `{ seed: 20260728 }` **num arquivo só** (`studio-anchor.test.ts`), com o
   motivo escrito; o resto da base segue com semente livre.
7. **Operacional:** rodar `pnpm dist:win` de novo para incorporar os exemplos ao instalador.

### Dados de mapa que faltam, e o dono adiou de propósito

O satélite e o mapa detalhado **não estão no disco**, e não é bug de código:

- `data/raster/` não existe. `pnpm satellite:hormuz` monta a cobertura EOxCloudless
  Sentinel-2 2016 sobre `54,24.2,58.8,28.1` até z13.
- `data/basemap/detailed-basemaps.json` **está** no repositório e declara
  `iran-hormuz-20260728-z15.pmtiles` com **1.562.903.814 bytes** e sha256 fixado. O arquivo
  não está no disco, e o seletor esconde a opção quando ele falta. Reproduzi-lo pede
  `go-pmtiles` (**não instalado nesta máquina**) recortando o bbox de `build.protomaps.com`.

O dono disse: _"vamos baixar depois, temos coisas mais importantes agora"_. **Não baixe sem
ele pedir.**

## Regras desta base que não são negociáveis

- **Renderização é função pura de `(documento, frame)`.** Sem `Date.now()`, sem
  `Math.random()`, sem estado acumulado. Sem isso não existe export byte-idêntico.
- **O documento é a única verdade.** Toda mutação passa pelo Command Bus.
- **Dependência forma um DAG**, verificado por `pnpm lint:arch`.
- **Offline é requisito**, não modo degradado.
- **Decisão de arquitetura vira ADR** antes do código, com alternativas honestas e
  consequência negativa declarada. Uma decisão por arquivo.
- **Medir, não achar.** Quando o número contraria a expectativa, o número ganha.
- **Limite conhecido vai para o roteiro**, não some. Afrouxar teste para ficar verde é o erro
  que este projeto não comete.
- **Entrega em blocos.** Parar no fim de cada bloco, relatar, e só então seguir. Nunca
  despejar blocos grandes de código.

## Armadilhas que vão te morder, em ordem de probabilidade

1. **Backtick dentro de template literal fecha a string.** Aconteceu **três vezes** nesta
   sessão: comentário GLSL com `` `THREE.Fog` `` dentro do shader, e comentário com
   `` `marking` `` dentro do `client.evaluate` do verificador. O sintoma é erro de sintaxe a
   cem linhas da causa. Comentário dentro de template literal não leva acento grave. É prima
   da armadilha §4.1.
2. **`props.assetId` guarda o `src`, não o `id`.** O nome mente e o formato de projeto o
   mantém por compatibilidade. Está anotado no tipo de nó, no validador e em 09-CONTINUIDADE.
3. **O undo do verificador restaura o documento, não a interface.** Modo de marcação, aba
   ativa e câmera solta são estado de painel React e **sobrevivem entre rodadas**. Critério
   que depende de estado de UI tem de **afirmá-lo** (`if (aria-pressed !== 'true')`), nunca
   alterná-lo. Foi o que fez o critério 5 falhar na segunda rodada seguida com "0 pontos
   criados" — mensagem idêntica à de um clique que erra a geometria.
4. **Critério que herda estado de critério anterior não mede o que o nome dele diz.** O
   critério 10 passou **por acidente** na primeira versão: com seis paradas acumuladas das
   etapas anteriores, a parada nova era a última (frame 450) e a medição olhava os frames 0,
   30 e 60 — a **primeira** parada, de um objeto parado. Deu 0,00 px e o placar disse verde
   sem ter testado nada.
5. **Quando os dois lados de um A/B dão o mesmo número, você está medindo outra coisa.**
   Duas vezes nesta sessão: o critério do horizonte mediu uma **linha da grade** (nítida de
   propósito) em vez da costura, e o do acompanhamento animou o objeto em **linha reta** — que
   é descrita exatamente pelos extremos, então zero keyframe inserido era a correção
   funcionando, não falhando.
6. **Sinal do painel errado.** O dockview **só monta o painel ativo**. `verify:phase8` ganhou
   `activateViewportTab` nesta sessão e os dois verificadores viraram independentes de ordem —
   antes, rodar phase8 depois do 7e3 derrubava 5 de 7 critérios com `.maplibregl-canvas
ausente`.
7. **Matar o Electron não libera a porta 5273.** O `pnpm dev` seguinte falha com "Port already
   in use". Conserto em §4.2: matar o processo que escuta a porta **e** o electron.
8. **Trocar de aba do dockview por CDP** só é confiável com `PointerEvent` no próprio elemento
   da aba, com `bubbles`, `composed`, `pointerId` e `isPrimary`.
9. **Ângulo é modular dos dois lados** — de quem afirma (§4.17) e de quem escreve o keyframe
   (`unwrapAzimuths`).
10. **Captura de tela não prova sozinha** (§4.5). Meça em pixel, ou leia o estado pelo CDP.
11. **Câmera refletida right-handed inverte X de tela.** Um ponto do piso preserva Y entre
    a câmera real e a espelhada, mas X troca de orientação. Exigir UV completo igual produz
    uma prova matematicamente errada com aparência convincente.
12. **Render offscreen é uma transação completa.** Target inclui face e mip; também restaure
    viewport, scissor/teste, máscaras de escrita, clear, background, override, XR, shadow map
    e visibilidade em `finally`. Cache de sombra com assinatura parcial quebra a pureza de
    `(documento, frame)`; por isso a sombra repinta todo frame.
13. **Debug não pode vazar para produção.** As superfícies do CDP só são montadas em dev ou
    com `VITE_THEATRUM_VERIFY=1`; depois do build normal, procure pelos nomes no bundle e
    exija zero ocorrência.

## Superfícies de diagnóstico do palco (dev ou build explícito de verificação)

`window.__theatrumStudio` é exposta em dev ou com `VITE_THEATRUM_VERIFY=1`; o build de
produção normal foi inspecionado e não contém ela nem as superfícies das fases 2/4:

- `pois()` — os pontos do frame com a **ancoragem já resolvida** em mundo, mais `ownerId` e
  `orphan`. Existe porque `props.pointX` deixou de ser metros de palco quando o ponto tem
  dono: um verificador que lesse o documento e projetasse o triplo cru mediria o lugar errado
  com total confiança.
- `camera()` — a câmera **efetiva** do frame e se ela está solta.
- `pick(x, y)` e `project(point)` já existiam, e o critério 5 agora acha os pixels de sondagem
  por **varredura** com `pick`, em vez de coordenadas fixas — antes ele dependia da silhueta
  do F/A-18 e ficava vermelho em máquina cuja `library-roots.json` serve outro modelo.
- `profile` — coleta CPU e GPU Three ON/OFF de forma assíncrona; GPU não inclui o canvas
  Pixi nem o compositor do Chromium.

Comece confirmando `git status`, a suíte verde e os verificadores `phase7e3` (duas vezes),
`phase8` e `phase8-video`. `phase8-formats` deve parar em `ffmpeg ENOENT` nesta máquina;
não baixe nada. Relate o que encontrou antes de tocar no `settle` ou no caminho de export.
Depois escreva o ADR-019 da Timeline do Palco **antes** do primeiro código.
