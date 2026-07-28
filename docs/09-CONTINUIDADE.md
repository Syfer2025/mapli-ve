# 09 — Continuidade

Documento de passagem de bastão. Escrito para uma IA que vai continuar este
projeto sem ter acompanhado a sessão anterior.

O que **não** está aqui: arquitetura (está em [02](02-MODULES.md)), decisões
(estão nos [ADRs](adr/README.md)), estado das fases (está em
[08-ROADMAP](08-ROADMAP.md)). O que **está** aqui: onde a agulha parou, o que
morde, e como não repetir erro já cometido.

---

## 1. Onde parou

Último commit: `6f7b895`. Cadeia do `pnpm check` verde — 972 testes em 97
arquivos, 315 módulos, 827 dependências, sem violação de camada; build
electron-vite ok.

Fases 0–6 concluídas. **O bloco 7 inteiro está fechado** (única exceção declarada:
7E.4, VFX, que o dono mandou adiar) e o **núcleo da Fase 8 está provado** — o
critério byte-idêntico, o mais importante do projeto. Cada bloco tem verificador
próprio dirigindo o Electron real por CDP:

| Bloco                    | Verificador       | Resultado |
| ------------------------ | ----------------- | --------- |
| 7A · biblioteca e assets | `verify:phase7a`  | verde     |
| 7B · camadas geográficas | `verify:phase7b`  | 4/4       |
| 7C · rotas e setas       | `verify:phase7c`  | verde     |
| 7D · textos no mapa      | `verify:phase7d`  | 4/4       |
| 7E.3 · modo estúdio      | `verify:phase7e3` | 5/5       |
| 8 · export byte-idêntico | `verify:phase8`   | 6/6       |

Entregue nesta sessão, em cinco commits:

| Commit    | O quê                                                         |
| --------- | ------------------------------------------------------------- |
| `0b4c9ca` | 7E.3 — palco 3D em canvas próprio, câmera orbital (ADR-012)   |
| `fb470f2` | 7C — rotas, tracejado, ponta e seta de avanço com revelação   |
| `ad290d3` | 7D — halo, quebra de linha e rótulo por duplo clique no mapa  |
| `b12765d` | Fase 8 — export de sequência PNG byte-idêntico (ADR-013)      |
| `6f7b895` | Painel de fila de render, com progresso e relatório de settle |

Entregue no 7B, em cinco commits:

| Commit    | O quê                                                                    |
| --------- | ------------------------------------------------------------------------ |
| `7df6492` | Malha geográfica compilada: origem fixada por hash, ADR-009 e ADR-010    |
| `d124dd4` | Leitor da malha e catálogo de busca de território, em `packages/gis`     |
| `5da16aa` | Primitiva `geo-shape`, tipos de nó `geo.region` e `geo.rivers`           |
| `7d34a8e` | Passe que projeta a geometria por frame; dois defeitos de antimeridiano  |
| `5ad9923` | Recorte contra a vista; caixa real do nó para clique e gizmo             |
| `1bb84b2` | Biblioteca 3D local por raiz nomeada; seletor de território no Inspector |
| `4d8959c` | Seção da biblioteca no painel, com import por clique                     |

E nesta sessão, o 7B.1 (`geo.roads`), em quatro commits:

| Commit    | O quê                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| `fc986f5` | ADR-011: junção espacial por ponto médio; a premissa do `sov_a3` morreu na medição |
| `1b90af1` | Origem `ne_10m_roads` fixada; junção no compilador; `spatial-join` no gis          |
| `dac3c39` | Passe geo sem o deslocamento de 32 px do pivot — achado da prova ao vivo           |
| `d57c9d8` | Nó `geo.roads` de ponta a ponta, com prova ao vivo verde                           |

E o fechamento do 7B, em dois commits:

| Commit    | O quê                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| `535c0ac` | Interpolação de cor hex em OkLab no avaliador de keyframes (`core-math/color.ts`)  |
| `6415855` | `tools/verify-phase7b.mjs` — os quatro critérios provados, com guarda de documento |

## 2. Bloco 7E — os quatro pedidos do dono

O dono pediu quatro coisas a partir de capturas do canal AiTelly. **Três
entregues; a quarta ele mesmo mandou adiar.** Detalhe completo em
[08-ROADMAP § 7E](08-ROADMAP.md#7e--apresentação-e-contexto-visual).

| Commit    | O quê                                                             |
| --------- | ----------------------------------------------------------------- |
| `5d2e989` | Fecha o 7B: script do verificador, roteiro e continuidade         |
| `6315d3b` | 7E.1 — camada de satélite por raiz nomeada, sem quebrar o offline |
| `8ea54a9` | 7E.2 — rótulo com caixa e guia que acompanha objeto ou rota       |
| `0b4c9ca` | 7E.3 — palco 3D infinito com câmera orbital animável              |

**7E.3, cenário de estúdio: entregue e provado (5/5 em `verify-phase7e3.mjs`).**
A decisão que travava o começo foi medida e virou o
[ADR-012](adr/ADR-012-studio-own-canvas.md): **2** contextos WebGL vivos hoje,
teto do Chromium em **16**, criar um custa **3,6 ms** uma vez. Com essa folga o
que decide é a direção da dependência, não o custo — canvas próprio, para o palco
não depender de um mapa escondido. Um nó `studio.stage` na composição liga o modo;
a câmera é `orbitCameraPosition` em L0, função pura, porque a Fase 8 vai precisar
reproduzi-la. Ver [08-ROADMAP § 7E.3](08-ROADMAP.md#7e3--cenário-de-estúdio-)
para as peças e os três defeitos silenciosos que só a medição em pixel achou.

**7E.4, VFX volumétrico: bloqueado por ferramenta, não por decisão.** Os 7,6 GB
de VDB da JangaFX que o dono deixou não rodam em WebGL — é formato de volume para
renderizador offline. O caminho certo é converter em flipbook num passo de
bootstrap, e isso exige Blender, Houdini ou uma biblioteca OpenVDB. **Verificado
que nenhum existe nesta máquina**: sem `blender`, `ffmpeg`, `magick` nem Python
real no PATH. Instalar um deles destrava; a alternativa de custo zero é usar o
vídeo de preview como textura, com qualidade menor.

## 3. O que vem agora

O bloco 7 está fechado e o **núcleo da Fase 8 também**: o critério byte-idêntico
está provado (`pnpm verify:phase8`, 6/6). Sobra:

1. **Codecs.** `WebCodecsEncoder`, `FFmpegPipeEncoder` com sidecar, GIF, ProRes
   4444 com alfa. A sequência PNG já sai byte-idêntica, então o caminho até o
   arquivo de vídeo é encanamento sobre uma base provada — não é onde o risco
   está.
2. **Resolução acima do tamanho da janela.** Hoje o frame sai no tamanho do
   viewport. É o gatilho declarado no
   [ADR-013](adr/ADR-013-export-frame-composition.md) para voltar à janela de
   render oculta.
3. **Fase 7 (ações).** Os templates de impacto. Nada dela ameaça o que já está
   provado.
4. **Motion blur, checkpoint e retomada.**

### O que não confiar sem medir de novo

- **A composição do export lê três canvases.** Se alguém trocar a criação do mapa
  ou do Pixi e perder `preserveDrawingBuffer`, o export continua rodando e produz
  frames com a superfície faltando. `verify:phase8` pega isso no critério 1.
- **O `settle` é o que separa determinístico de plausível.** Ele espera quietude
  do overlay **e** `areTilesLoaded()` do mapa. Afrouxar qualquer um dos dois faz o
  export passar mais rápido e gravar frame incompleto em máquina lenta.
- **`packages/engine` continua um esqueleto**, e `apps/editor` importa L2/L3
  direto. O export foi construído sem ele de propósito — introduzir a indireção
  agora seria refatorar o caminho que acabou de ser provado.

### A suspeita herdada dos filtros: resolvida no que importava

Havia uma observação em aberto: numa rodada do verificador com **dois nós geo**
pintando (região + estradas), aplicar outline+glow derrubou a área da captura de
1,25 M para 539 mil pixels — uma vez, sem reproduzir. A dúvida era se o caminho de
captura **com filtros** é instável, o que arruinaria o export.

Montei exatamente essa cena no `verify:phase8` (critério 5) e exportei duas vezes:
**hashes idênticos arquivo por arquivo**, e nove hashes distintos entre os nove
frames. O caminho de captura com filtros é determinístico.

O que isso **não** prova: que a área pintada naquele episódio estava certa. Um
export pode ser reproduzível e ainda estar visualmente errado. Mas a pergunta que
travava a Fase 8 era a do determinismo, e essa está respondida — o critério 5
falha se alguém a quebrar de novo.

## 4. Armadilhas desta base de código

Cada uma custou tempo real. Ler antes de tocar no código.

### 4.1 Backtick e barra invertida em string de shell

`node -e "..."` e heredoc **comem** backtick e barra invertida. Já quebrou código
injetado silenciosamente quatro vezes nesta sessão, incluindo um caminho de
Windows que virou `C:UsersalexmOneDrive...` sem erro nenhum.

Use as ferramentas de escrita e edição de arquivo. Quando precisar de caminho
Windows em JSON, use **barra normal** — `path.isAbsolute("C:/x")` é verdadeiro no
Windows e não há o que escapar.

### 4.2 O servidor de desenvolvimento não reinicia sozinho

`pnpm dev` falha com "Port 5273 is already in use" se já houver instância. Pior:
mudança no **processo principal** (`apps/shell`) não entra por HMR. Sintoma
clássico: você conserta o protocolo, roda a prova, e o defeito continua.

Antes de qualquer prova ao vivo que dependa de código do main:

```powershell
Get-NetTCPConnection -LocalPort 5273 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-Process electron | Stop-Process -Force
```

E o Pixi **cacheia programas GL compilados por código-fonte**: mudança de shader
exige recarregar a página, não só HMR.

### 4.3 Fim de linha

O repositório é LF, imposto por `.gitattributes`. O Git do Windows instala
`core.autocrlf=true` por padrão e, sem o arquivo, `pnpm check` falha em todo
arquivo num clone limpo. Se acontecer, o conserto é `core.autocrlf=false` mais
`rm .git/index && git reset --hard`.

### 4.4 O protocolo local recusa junção — de propósito

`theatrum-data://` resolve `realpath` e barra o que escapa da raiz. Não
enfraqueça. Para servir pasta de fora, declare uma raiz nomeada em
`data/library-roots.json` (formato na seção 6).

### 4.5 Cuidado com afirmação vinda de captura de tela

Duas vezes nesta sessão eu li errado uma captura: uma vez achei que havia
preenchimento vazando (não havia — era o mapa base), outra achei que estava certo
quando faltava um país inteiro. **Meça o pixel.** `__theatrumPhase4.captureExport()`
devolve o overlay isolado; projete a coordenada conhecida com `map.project()` e
leia o alfa. O padrão está em `scratchpad/pixel-geo.mjs` da sessão anterior e
descrito na seção 5.

### 4.6 O antimeridiano estraga caixa envolvente

Rússia, Estados Unidos e Fiji têm caixa de −180 a 180 porque parte do território
cruza o antimeridiano. Consequências que já mordi:

- Centro da caixa cai no oceano errado → âncora fora da tela → nó descartado.
  Resolvido: o compilador guarda o ponto representativo do **maior anel**.
- Descarte por caixa nunca exclui esses países. Resolvido: caixa **por anel**.
- Nem isso basta quando o anel continental contém a vista. Resolvido: recorte.

Qualquer código novo que use `feature.bounds` para decidir visibilidade herda o
problema.

### 4.7 Pixi 8: `fill()` consome os caminhos pendentes

Acumular vários anéis antes de preencher funde ilhas num polígono só — a Crimeia
gruda no continente por uma linha reta. Preencha e trace **por anel**.

### 4.8 Precisão de shader

O Pixi injeta `precision highp float` no vertex e `mediump` no fragment quando o
código não declara. Uniform declarado nos dois estágios não liga o programa, e o
filtro simplesmente não pinta — sem erro visível. Todo fragmento próprio abre com
`precision highp float;` **na primeira linha**, sem newline antes: o
pré-processador testa os nove primeiros caracteres. Coberto por
`packages/renderer/src/filter-shaders.test.ts`.

### 4.9 Sutherland–Hodgman pinta área que não existe

Em anel concavo que sai da vista e volta a entrar, ele devolve um só anel ligando
os pedaços pela borda do recorte. `clipRing` conta entradas e recusa acima de uma,
devolvendo −1; o chamador então projeta o anel inteiro. Conta entrada **por
aresta**, não por vértice — uma aresta longa atravessa a caixa entre dois vértices
ambos externos.

### 4.10 Medir traço fino pede detector de proporção, e a âncora tem pivot

Duas mordidas da prova do `geo.roads`, na mesma sessão:

1. Traço de 1,5 px com alfa < 1 sobre fundo **transparente** volta pré-multiplicado
   na extração: pixel de borda carrega uma fração da cor e reprova qualquer limiar
   absoluto (`r > 190` e afins). Detecte pelo alfa somado à **proporção** r:g:b,
   que a pré-multiplicação preserva. Padrão em `scratchpad/probe-roads.mjs`.
2. A matriz do layout carrega o pivot `anchorPoint × tamanho` — 32 px no tamanho
   padrão de 64 — mas os anéis geo são medidos a partir de `anchorPx`. Resultado:
   todo território pintado deslocado de (−32, −32), fino o bastante para passar
   despercebido em zoom de país. O remendo é `matriz × translate(pivot)`, em
   `geo-nodes.ts`; a prova geométrica com vários vértices é o que pega essa
   classe de defeito — um vértice só pode casar com a estrada vizinha errada.

### 4.11 Canvas WebGL ocioso não é legível — e a flag mudou de lugar

`drawImage` de um canvas WebGL devolve **zero em todos os canais** quando ele não
repintou há alguns frames. É a condição exata do export: o pump avança o frame e
nada repinta. O sintoma engana porque um canvas simples recém-desenhado lê bem —
o problema só aparece quando fica ocioso.

A correção é `preserveDrawingBuffer: true`, e no MapLibre 5 ela **não está mais
onde a documentação antiga diz**: saiu de `MapOptions.preserveDrawingBuffer` para
`canvasContextAttributes`, e a chave antiga é ignorada **em silêncio**. O mapa
sobe normal, o contexto continua sem preservar, e só
`getContextAttributes().preserveDrawingBuffer` conta a verdade. Perdi uma rodada
inteira nisso: editei, recarreguei, sem erro nenhum, e a leitura continuou zero.

Hoje as três superfícies têm a flag: mapa (`MapViewport.tsx`), Pixi
(`pixi-backend.ts`) e palco (`studio-scene.ts`). Tirar de qualquer uma quebra o
export **sem quebrar o preview**.

### 4.12 Closure de efeito com dependências vazias captura o que ainda não existe

A superfície de depuração do overlay é montada num `useEffect(..., [])`, e naquele
instante `map` ainda é `null`. Capturá-lo ali deixou o export respondendo "mapa
indisponível" para sempre — e a mensagem era honesta, o que atrasou o diagnóstico.
Qualquer coisa que um efeito de deps vazias precise ler depois vai por **ref**,
não por closure.

### 4.13 Desvio constante sob mudança de câmera é pivot, não projeção

Ao verificar o 7D, o rótulo aparecia a **122,78 px** do ponto projetado — e o
mesmo valor em três enquadramentos diferentes (plano, inclinado 42°, girado
−70°). Erro de projeção varia com a câmera; um número que não se mexe é
deslocamento local. Era o pivot `anchorPoint × tamanho` deslocando a caixa do nó,
o mesmo da armadilha 4.10.

A regra que sai daí: **compare pixel com pixel**. A translação da matriz do nó
responde "onde está a caixa"; a pergunta do critério é "onde está o glifo", e
quem responde é o centro dos pixels desenhados. Trocado para essa medida, o
desvio caiu para 1,00 / 0,76 / 1,15 px — a folga de antialias do glifo, e nada
mais.

### 4.14 `RawShaderMaterial` não injeta nada

O `ShaderMaterial` normal do three declara `position`, `normal`, `uv`,
`modelViewMatrix` e a precisão por você. O **Raw** não declara nenhum. Um vertex
shader que usa `position` sem a linha `in vec3 position;` não linka, e o three
engole a falha: o objeto simplesmente não aparece, sem erro no console e sem
`gl.getError()` diferente de zero. Se um material próprio não desenha, comece
declarando os atributos à mão.

### 4.15 Cor em raw shader sai escura: falta o encode sRGB

`THREE.Color.set('#141a22')` **converte de sRGB para linear** ao ler o hex — é o
padrão desde o r152. Um `ShaderMaterial` normal recebe a conversão de volta
injetada na saída; um Raw não. O resultado é o valor linear escrito como se fosse
sRGB: `#141a22` (20/26/34) vira 2/3/4 na tela. Quase preto, sem erro nenhum, e
qualquer coisa desenhada por mistura entre duas cores escuras desaparece junto.
Faça o encode no fim do fragmento — a mistura antes, em linear, que é onde ela
está correta. Referência: `linearToSrgb` em
`apps/editor/src/panels/viewport/studio-grid.ts`.

### 4.16 `loseContext()` mata o canvas para sempre

Parece a forma educada de devolver um contexto WebGL, e é uma armadilha quando o
elemento canvas é reaproveitado: `WEBGL_lose_context.loseContext()` é definitivo,
não existe restauração automática, e a próxima montagem do componente recebe o
contexto morto de volta em `getContext`. O three aceita e só quebra adiante, com
`TypeError: Cannot read properties of null (reading 'precision')` no meio da
inicialização — nenhuma palavra sobre contexto perdido. Use só `renderer.dispose()`
e deixe o navegador recolher o contexto junto com o elemento.

## 5. Como verificar de verdade

Cada fase tem um verificador que dirige o **Electron real** por CDP na porta 9222.
Isso não é opcional neste projeto: teste unitário não pega defeito de projeção,
de shader nem de composição.

Superfícies de depuração disponíveis apenas em desenvolvimento:

| Superfície                   | O que dá                                              |
| ---------------------------- | ----------------------------------------------------- |
| `__theatrumPhase2.map`       | Instância MapLibre; `.settle(ms)` espera o mapa parar |
| `__theatrumPhase3`           | `getSnapshot()`, `actions`, `commandBus`              |
| `__theatrumPhase4`           | `getSnapshot()` do frame, `captureExport()`           |
| `__theatrumScene3d.status()` | Estado da camada Three.js sobre o mapa                |
| `__theatrumStudio.status()`  | Estado do palco 3D: câmera, modelos, contexto         |
| `__theatrumPhase4Timeline`   | Métricas de redraw da timeline                        |

Cada nó do `getSnapshot()` traz `screenPx` — a translação da matriz na cena de
**tela**, depois dos passes que reposicionam (rótulo com guia, palco 3D). Mas
leia a armadilha 4.11 antes de comparar esse número com um ponto projetado.

Desfazer usa `commandBus.history.undo()` e `history.canUndo()` — **não** existe
`commandBus.undo()`.

Um nó criado por ação nasce com **âncora padrão**, e ela raramente é onde você
quer: `route` e `text.label` nascem em (0°, 20°), no golfo da Guiné. Se o
verificador não enquadrar o mapa nem mover a âncora, o nó existe, o passe relata
que desenhou, e a captura vem vazia.

Pausar antes de amostrar: `actions.pause()`. Um demo deixa a composição tocando em
loop, e sem pausar cada amostra lê um frame ao acaso. Isso já produziu uma tabela
inteira de números sem sentido.

## 6. Configuração local desta máquina

Não versionada. Recriar se sumir.

**`data/library-roots.json`** — raízes que o protocolo local serve além de `data/`:

```json
{
  "models": "C:/Users/alexm/OneDrive/Área de Trabalho/modelos glb 3D equipamentos militares"
}
```

São 83 modelos GLB, 2,7 GB, de equipamento militar — 43 aviões, 15 blindados,
9 helicópteros, 5 de artilharia, 4 drones, 2 antiaéreos, 2 mísseis, 2 transportes,
1 navio. **Sufixo `(n)` no nome é variação do mesmo equipamento, não duplicata
descartável** — instrução explícita do dono do projeto. Depois de mexer na pasta,
rode `pnpm models:index`.

O dono também pediu, também explicitamente: **os modelos não vão para o GitHub.**
O `.gitignore` cobre `data/library-roots.json` e `data/models-index.json`.

Malha geográfica: `pnpm data:fetch` baixa as origens fixadas por hash e
`pnpm geo:build` compila. As duas verificações entram no `pnpm check`.

## 7. Fases seguintes

Ordem do roteiro: **7C** (rotas e setas 2D) → **7D** (textos no mapa) →
**Fase 7** (ações) → **Fase 8** (exportação) → 9, 10, 11.

Duas pendências herdadas que valem atenção antes da Fase 8:

1. **Critério 4 da Fase 6** está registrado como "delta mínimo de blend sob
   investigação de tolerância". É a mesma família de problema que o critério 2 da
   Fase 8 — arquivos idênticos byte a byte — vai cobrar a sério.
2. **`packages/engine` continua stub** enquanto `apps/editor` importa L2 e L3
   direto, divergindo de [02-MODULES](02-MODULES.md). A Fase 8 força a decisão: o
   export roda o motor numa janela oculta, sem UI.

A Fase 8 é a que decide o projeto. O critério 2 dela — exportar o mesmo projeto
duas vezes e obter arquivos idênticos byte a byte — é descrito no roteiro como o
mais importante de todos, e é a conta que toda a disciplina de determinismo das
fases anteriores existe para pagar.

## 8. Estilo de trabalho combinado com o dono

- **Entrega em blocos.** Parar no fim de cada bloco, relatar, e só então seguir.
  Nunca despejar blocos grandes de código.
- **Documento antes de código.** Decisão de arquitetura vira ADR, com alternativas
  honestas e consequência negativa declarada — é regra escrita em
  [adr/README.md](adr/README.md), e uma decisão por arquivo.
- **Medir, não achar.** O roteiro exige decisão medida em vários pontos. Quando o
  número contraria a expectativa, o número ganha.
- **Limite conhecido vai para o roteiro**, não some. Afrouxar teste para ficar
  verde é o erro que este projeto não comete.
