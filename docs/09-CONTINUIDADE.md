# 09 — Continuidade

Documento de passagem de bastão. Escrito para uma IA que vai continuar este
projeto sem ter acompanhado a sessão anterior.

O que **não** está aqui: arquitetura (está em [02](02-MODULES.md)), decisões
(estão nos [ADRs](adr/README.md)), estado das fases (está em
[08-ROADMAP](08-ROADMAP.md)). O que **está** aqui: onde a agulha parou, o que
morde, e como não repetir erro já cometido.

---

## 1. Onde parou

Cadeia final verde — **1.162 testes funcionais em 115 arquivos**, suíte isolada
de performance com 6/6 testes, 362 módulos e 963 dependências sem violação de
camada; build electron-vite e pacote Windows verificados. Os orçamentos de
performance ficam isolados dos workers funcionais para medir o motor, não a
contenção artificial do runner.

Passe de auditoria em 2026-07-28, sobre o estado que o `77aa7e4` deixou:

| O quê                                                     | Resultado                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Teste de propriedade intermitente em `shortestAngleDelta` | corrigido — era a asserção, não a função                                         |
| README com estado de 7A++ (dizia que o 7B era o próximo)  | atualizado                                                                       |
| `settle` do export cego para o carregamento do GLB        | **fechado e provado** — [§3](#o-settle-3d-foi-fechado-e-provado)                 |
| Bootstrap necessário depois do 7B                         | documentado em [§4.18](#418-bootstrap-pnpm-install-e-geobuild-não-são-opcionais) |

Passe de 2026-07-28, à noite — nove pedidos novos do dono sobre o palco, atacados em
blocos. Os blocos 7F.1 a 7F.6 e o reflexo 7F.8 estão fechados; o próximo é a
timeline própria do modo palco.

| O quê                                                    | Resultado                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POI ficava no espaço, não no objeto ("limbo" com escala) | **ADR-016 entregue e provado** — `verify:phase7e3` de 6/6 para **7/7**                             |
| Aviso de POI órfão (o que o ADR-015 deixou em aberto)    | fechado, e agora com definição objetiva em vez de heurística                                       |
| Critério 5 do 7e3 vermelho **antes** de qualquer mudança | era coordenada de clique fixada à silhueta do F/A-18 — [§3](#o-poi-passou-a-ser-do-objeto-adr-016) |
| `verify:phase8` derrubado por rodar depois do 7e3        | ganhou `activateViewportTab`; os dois viraram independentes de ordem                               |
| Reflexo do piso era inexistente                          | **ADR-018 entregue e provado** — duas rodadas consecutivas do `verify:phase7e3` em **14/14**       |
| Orçamento do segundo passe                               | p95 ON de CPU **1,20/1,00 ms** e GPU Three **0,35/0,37 ms**, zero disjoints                        |

Passe anterior, no mesmo dia — o palco 3D, a pedido do dono:

| O quê                                             | Resultado                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Grade do palco cintilando ao girar a câmera       | filtro de Nyquist no shader; MSAA nunca ia resolver                |
| Linhas piscando sobre o modelo (z-fighting)       | `near`/`far` derivados do conteúdo: razão 68.000:1 → ~10:1         |
| Sombra "flutuando" recusada pelo dono             | refeita como **silhueta projetada**, com a forma real do objeto    |
| Opacidade do palco reacendia o mapa               | **ADR-014**: palco em painel próprio, quatro etapas provadas       |
| Pontos de interesse para a câmera de apresentação | **ADR-015 entregue e provado** — `verify:phase7e3` de 5/5 para 6/6 |

Fases 0–6 concluídas. O roteiro técnico original do bloco 7 está fechado, com a
exceção declarada de 7E.4, VFX, que o dono mandou adiar. A rodada adicional 7F
ainda tem a timeline própria do palco por fazer. A **Fase 8 produz MP4 H.264, GIF,
ProRes 4444 e PNG normal/alfa**. Os encoders repetíveis preservam o critério mais
importante do projeto: saída idêntica entre execuções.
Os verificadores visuais dirigem o Electron real por CDP:

| Bloco                    | Verificador             | Resultado      |
| ------------------------ | ----------------------- | -------------- |
| 7A · biblioteca e assets | `verify:phase7a`        | verde          |
| 7B · camadas geográficas | `verify:phase7b`        | 4/4            |
| 7C · rotas e setas       | `verify:phase7c`        | verde          |
| 7D · textos no mapa      | `verify:phase7d`        | 4/4            |
| 7E.3 · modo estúdio      | `verify:phase7e3`       | 14/14 × 2      |
| 8 · export byte-idêntico | `verify:phase8`         | 7/7            |
| 8 · arquivo MP4 H.264    | `verify:phase8-video`   | 6/6            |
| 8 · GIF + ProRes/alfa    | `verify:phase8-formats` | bloqueado aqui |

O `verify:phase8-formats` é diferente dos demais: roda sem Electron e invoca
FFmpeg e ffprobe diretamente. Nesta retomada parou em `ffmpeg` com `ENOENT`; não
houve download. Os 5/5 continuam sendo a prova histórica da máquina anterior, não
uma execução desta retomada.

O passe noturno foi incorporado nestes commits locais, sem incluir as duas
mudanças reservadas ao dono (`settleFailedFrames` e `tools/demo-missao.mjs`):

| Commit    | O quê                                                                    |
| --------- | ------------------------------------------------------------------------ |
| `2bb9ca3` | ADR-016/017, emenda do ADR-015 e índice de decisões                      |
| `19dc320` | contrato legado `assetId = asset.src`, travado nos dois sentidos         |
| `505ae7d` | fluxo de autoria do palco: POI, câmera, drop, atmosfera, tour e anotação |
| `16e1ffa` | provas ao vivo 7–12 e verificadores independentes da aba persistida      |
| `c79e25f` | comentário do vínculo de POI junto à ação que ele documenta              |
| `80e0311` | ADR-018: escolhe o espelho planar e declara custo e limite               |
| `368bb39` | reflexo determinístico, compatibilidade, profiler e prova 14/14 × 2      |
| `8decdfe` | resultado medido no ADR, roteiro e passagem de bastão                    |

Entregue nesta sessão, em sete commits:

| Commit    | O quê                                                         |
| --------- | ------------------------------------------------------------- |
| `0b4c9ca` | 7E.3 — palco 3D em canvas próprio, câmera orbital (ADR-012)   |
| `fb470f2` | 7C — rotas, tracejado, ponta e seta de avanço com revelação   |
| `ad290d3` | 7D — halo, quebra de linha e rótulo por duplo clique no mapa  |
| `b12765d` | Fase 8 — export de sequência PNG byte-idêntico (ADR-013)      |
| `6f7b895` | Painel de fila de render, com progresso e relatório de settle |
| `6d17cbb` | Fecha a suspeita herdada dos filtros no caminho de export     |
| `77aa7e4` | Arquivo de vídeo: H.264 em MP4, byte-idêntico e decodificável |

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

### Extensão regional Irã–Hormuz (2026-07-28)

O viewport deixou de depender apenas do bootstrap mundial Natural Earth z0–6.
Há agora um pacote Protomaps/OpenStreetMap `43,22,65,41` até z15, descoberto por
`data/basemap/detailed-basemaps.json` e só exibido quando o arquivo de 1,56 GB
está no disco. O estilo detalhado traz províncias, cidades, ruas, edifícios,
água, uso do solo e POIs com glifos/sprites inteiramente locais.

`pnpm satellite:hormuz` monta a cobertura EOxCloudless Sentinel-2 2016
`54,24.2,58.8,28.1` até z13 em `data/raster/`. O ano de 2016 foi escolha
deliberada: CC BY 4.0; 2018–2025 têm cláusula não comercial. O seletor oferece
satélite puro e híbrido com os rótulos detalhados.

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
bootstrap, e isso exige Blender, Houdini ou uma biblioteca OpenVDB. O instalador
registrado anteriormente inclui um sidecar FFmpeg para os formatos da Fase 8,
mas esta máquina não tem FFmpeg nem ffprobe disponíveis para a prova local; mesmo
com eles, FFmpeg não lê VDB. Blender/Houdini/OpenVDB continuam ausentes. A
alternativa de custo zero é usar o vídeo de preview como textura, com qualidade
menor.

## 3. O que vem agora

O reflexo planar do piso, último pedaço pendente do pedido de luz/sombra/reflexo,
está fechado pelo [ADR-018](adr/ADR-018-studio-planar-floor-reflection.md). Os
formatos principais da Fase 8 também estão entregues: MP4 H.264, GIF, ProRes 4444
com alfa e PNG normal/alfa. Nesta retomada, `verify:phase8` deu 7/7 e
`verify:phase8-video`, 6/6; `verify:phase8-formats` ficou bloqueado por
`ffmpeg ENOENT`, sem download. O instalador NSIS já teve os 15.034 arquivos de
dados offline e o FFmpeg fixado provados na máquina anterior, mas o arquivo em
`release/` ainda deve ser regenerado antes da entrega externa.

**Módulos novos estão estacionados de propósito.** Palco de voo, simulador de
combate, editor de personagem modular e animação de asset foram decididos em
conversa e escritos em [11-VISAO-FUTURA](11-VISAO-FUTURA.md) — nenhum deles entra
antes de esta lista zerar. A instrução do dono foi explícita: _"vamos tentar
finalizar o que já temos antes de criar mais e mais módulos"_.

### Limite conhecido: o reflexo planar não repete pixel a pixel

**Isolado em 2026-07-29, não corrigido.** O critério 13 do `verify:phase7e3`
falha de forma intermitente — três rodadas seguidas deram 10/14, 13/14 e 14/14
com o mesmo código. O campo que discrimina está no fim da mensagem dele:

```
ON/OFF repetidos diferem em 0/68 px
```

O critério liga e desliga o reflexo duas vezes e compara os pixels. Repetir o
**mesmo estado** deveria dar imagem idêntica; dá 0 numa direção e **68 px** na
outra.

Duas coisas já foram descartadas: a ordem está certa (o reflexo é atualizado
**antes** do render principal em `studio-scene.ts`, então não é atraso de um
frame), e o passe salva e restaura render target, viewport, máscaras e
visibilidade no `finally`.

**Por que isto é mais sério que um critério vermelho.** Determinismo é a tese
central do projeto. O `verify:phase8` continua 7/7, mas provavelmente porque
**nenhum critério dele liga o reflexo** — vale confirmar isso antes de qualquer
outra coisa. Se não cobrir, uma cena com reflexo ativo pode exportar diferente
entre execuções sem ninguém perceber.

Próximo passo sugerido: instrumentar `studio-reflection.ts` para gravar o
conteúdo do target em dois frames idênticos e comparar; suspeitar de reúso de
render target entre tamanhos e de estado de GL que o `finally` não devolve.

Ordem que vem agora, conforme o prompt de passagem:

1. **Timeline própria do modo palco.** É o próximo bloco real. `TimelinePanel.tsx`
   e `timeline-model.ts` não têm referência a `studio.stage`. Decidir e documentar
   antes do código se será painel separado ou o mesmo painel ciente do modo; a
   segunda direção é mais consistente com o restante do editor. No palco importam
   câmera, POIs e roteiro, não as camadas do mapa.
2. **Contornos do mapa “meio grosseiros”.** Perguntar ao dono _onde_ antes de
   alterar: Viewport, export ou zoom específico. Quantização da malha, AA do Pixi,
   largura HiDPI e recorte são apenas suspeitos a medir.
3. **Fase 9 — Scene Script.** É a integração com qualquer IA por compilador; o
   editor continua sem chamar modelo.
4. **Resolução acima do tamanho da janela.** Hoje o frame sai no tamanho do
   viewport, e o H.264 exige dimensão par — 1227×643 vira 1226×642. É o gatilho
   declarado no [ADR-013](adr/ADR-013-export-frame-composition.md) para voltar à
   janela de render oculta.
5. **Motion blur, checkpoint e retomada.**

### Pontos de interesse do palco (ADR-015): entregue e provado

**Fechado em 2026-07-28.** O último pedido do dono — a câmera vai até o míssil e
ele fala do míssil. Quatro peças: tipo de nó `studio.poi`, botão **Marcar pontos**
com raycast na superfície do modelo, marcadores numerados em superfície própria, e
**Compilar roteiro**, que transforma a sequência de pontos em keyframes das seis
props de câmera do `studio.stage`.

O critério 5 do `verify:phase7e3` prova a cadeia inteira com dois cliques de mouse
de verdade, e as duas afirmações que sobram são em pixel: a **ida e volta** do
raycast (projetar o ponto devolvido cai a **0,60 e 0,30 px** de onde o raio partiu)
e a **visita** (no frame de chegada da segunda parada o ponto dela projeta a
**0,00 px do centro** da tela, porque é para lá que a câmera mira). Ver a nota de
implementação do [ADR-015](adr/ADR-015-studio-points-of-interest.md) para os três
desvios da letra do documento e o motivo de cada um.

Três coisas para lembrar antes de mexer nisto:

- **Marcador não é conteúdo, é chrome de autoria.** Ele mora em
  `.studio-viewport__markers`, que está na `EXCLUDED_SURFACE_SELECTORS` do
  `frame-composer`. Desenhá-lo no overlay Pixi do palco — que o ADR sugeria e que é
  **composto** no export — poria um número verde sobre o míssil no vídeo entregue
  toda vez que alguém esquecesse o modo de marcação ligado.
- **Azimute é grandeza modular, e o keyframe não sabe disso.** Paradas em 350° e
  10° estão a vinte graus uma da outra; a interpolação linear percorre 340 pelo
  lado errado. `unwrapAzimuths` desenrola a sequência antes de gravar. É a família
  de defeito da [§ 4.17](#417-comparar-ângulos-normalizados-com-régua-linear-atravessa-a-costura),
  agora do lado de quem **escreve** o ângulo, não de quem o afirma em teste.
- **POI leva a câmera até a torre; não a gira.** Girar exige `gltf.animations`,
  hoje descartado em `three-assets.ts`, e um modelo com a torre como nó separado —
  que o 2S19 do dono não tem. São problemas diferentes.

### O POI passou a ser do objeto (ADR-016)

**Fechado em 2026-07-28.** O dono relatou: _"quando se coloca keys pontos de interesse
no objeto eles não ficam fixos no objeto, ficam fixos no espaço; se o avião mudar de
escala os objetos ficam travados no limbo."_ Era a consequência que o
[ADR-015](adr/ADR-015-studio-points-of-interest.md) havia aceito de propósito, e o
[ADR-016](adr/ADR-016-poi-anchored-to-object.md) a emenda.

O `studio.poi` ganhou `ownerId`. Vazio, `pointX/Y/Z` são metros de palco — a leitura
de sempre, e o que faz projeto antigo abrir igual sem migração. Preenchido, são o
**espaço normalizado do modelo**, e o ponto atravessa a matriz que
`applyModelTransform` já monta: `T · S · Ry`. As quatro props que movem o objeto
passam a mover o ponto de graça.

Quatro coisas para lembrar antes de mexer nisto:

- **O conserto óbvio não funciona.** Guardar o deslocamento em **metros** a partir da
  origem do modelo segue posição e rumo, e falha exatamente no caso do relato: dobrar
  `scaleMeters` faz o objeto crescer e o ponto ficar onde estava. É a alternativa D do
  ADR-016, rejeitada por medição, não por gosto.
- **`parent` não serve de dono.** Ele já significa organização e herança de
  opacidade/visibilidade, e a transformação que se herda por ele é **2D**
  (`TransformSchema` é `Vec2` + escalar). Arrastar um ponto para uma pasta o
  desanexaria do caça — falha silenciosa causada por arrumação.
- **Uma fonte de verdade.** O POI guarda só o ponto local; nada de cópia em mundo ao
  lado. Quem precisa de mundo pergunta: `collectStudioPois` recebe um resolvedor, e o
  compilador do roteiro recebe outro, que resolve **no frame de chegada** de cada
  parada — porque um ponto num objeto animado se move, e resolver tudo no frame zero
  faria a câmera mirar onde o míssil **estava**.
- **`props.pointX` não é mais "metros" para o Inspector.** As três props perderam o
  `unit` de propósito: com dono elas são fração do vão do modelo. O valor em metros
  aparece na barra de estado do painel. Rótulo de unidade errado é como se marca um
  ponto no lugar errado com total confiança.

**Dois defeitos de verificador que este bloco achou, e nenhum dos dois era do código
sob teste.**

O **critério 5 do 7e3 já estava vermelho nesta máquina** antes de qualquer mudança:
1 ponto criado em vez de 2, ida e volta de 35,04 px. Ele clicava em duas coordenadas
de mundo fixas, `[6,0,0]` e `[6,1.2,0]`, escolhidas para a silhueta do F/A-18 — e a
`library-roots.json` desta máquina serve um SA-3. O primeiro clique caía no vão sob o
veículo, e a ida e volta então comparava o único ponto criado com o pixel do clique
que **errou**: os 35 px eram exatamente a separação entre os dois alvos na tela.
Agora os pixels de sondagem saem de uma varredura que pergunta ao raycast onde há
geometria. Ida e volta: **0,00/0,00 px**. Centragem da visita: **0,00 px**.

E o **`verify:phase8` não ativava aba nenhuma** — presumia o Viewport na frente. Como
o layout é persistido, rodá-lo depois do 7e3 derrubava cinco critérios com
`.maplibregl-canvas ausente`, e reiniciar o app não resolvia. Ganhou
`activateViewportTab` com `PointerEvent` no próprio elemento, do jeito que a seção
seguinte registra. **A lição não é sobre o palco: verificador que depende da ordem em
que outro rodou não é verificador, é armadilha.**

Limite declarado, que foi para o roteiro em vez de sumir: com objeto **animado**, a
câmera escorrega do ponto durante a pausa da narração — o objeto continua andando e o
alvo é um par de keyframes parado. Corrigir exige alvo que acompanha, e é o bloco de
transições.

### `props.assetId` guarda o **src**, e o nome mente

**Fechado em 2026-07-28**, e é a armadilha mais barata de repetir deste arquivo.

O dono relatou "não consigo jogar modelos 3D no palco" e a barra de estado dizia
`falha ao carregar modelo · asset ausente: ast_plpsib174e`. O valor era um **id** de
asset; todos os leitores de `props.assetId` — `collectStudioModels`, a camada 3D do mapa,
as primitivas de imagem e SVG do renderer — tratam o valor como o **`src`**, o caminho por
hash de conteúdo. O criador canônico (`applyAsset`) sempre gravou `src`.

Quem discordava eram dois:

- o **`select` de asset do Inspector** gravava `asset.id`. Escolher um modelo ali deixava
  o palco vazio, e nada na tela ligava causa e efeito;
- o **validador de documento** comparava `assetId` contra a lista de **ids**, ou seja
  acusava de referência órfã justamente o caso correto. Validador que acusa o certo treina
  quem o lê a ignorá-lo, e foi ignorado o suficiente para o defeito irmão sobreviver.

E **não havia teste em nenhuma das duas direções** — a suíte passou de 1.091 para 1.102
sem que nada quebrasse quando o contrato foi consertado, o que é a medida exata de quanto
ele estava coberto. Agora há teste dos dois lados.

O nome da prop continua `assetId` por compatibilidade do formato de projeto. Renomear é
migração, e não vale hoje; o que vale é isto estar escrito no tipo de nó, no validador e
aqui.

### Arrastar da biblioteca e soltar no palco

Modelo da biblioteca — do disco ou já no projeto — vira nó ao ser solto no painel do
palco, **onde** foi solto: o raio do cursor cruza o plano do piso e o ponto sai daí
(`studio-drop.ts`, com o caso âncora "centro da tela cai no alvo da câmera" travado em
teste). Duas decisões que valem lembrar:

- **soltar assume 18 m de vão.** O padrão de `scaleMeters` do `model3d` é 30 000, que são
  metros de **terreno**; no palco o teto de `collectStudioModels` corta em 500 m, e um
  objeto de 500 m com a câmera a 40 põe a câmera dentro dele;
- **tipo MIME próprio**, não `text/plain`: com texto solto, qualquer arraste de qualquer
  lugar chegaria ao palco parecendo pedido legítimo.

### O horizonte do palco dissolve, e a névoa mora no fundo

O dono relatou "metade da tela do palco parece cortada, não dá sensação de espaço" e "essa
linha de transição da base com o fundo está esquisita". Era um defeito só, visto de dois
lados: o céu era **uma cor lisa** — sem gradiente o olho lê a metade de cima como um bloco
chapado — e o piso nunca alcançava essa cor, porque a mistura tinha um piso de `0.08` e
sobrava sempre 8% de cor de chão no infinito. Essa era a aresta.

Agora os dois lados pedem a cor à **mesma** função (`skyTone`), na mesma direção do olhar:
eles se encontram no mesmo valor por construção. Medido no critério 9 do `verify:phase7e3`:
o maior salto entre pixels vizinhos de uma coluna que cruza o horizonte caiu de **12,1
para 6,8**, com amplitude de 66,9 — dissolveu sem achatar.

**A névoa (`horizonHaze`) resolve o "nunca sobrepondo o objeto" por construção**, não por
cuidado: ela vive no passe do piso, que é um quad de tela cheia com `depthTest: false` e
`renderOrder: -1`. Toda geometria desenha depois, em cima. `THREE.Fog` faria o oposto — é
por profundidade e lavaria o modelo junto.

E uma armadilha nova, prima da 4.1: **backtick dentro do shader fecha o template
literal.** Um comentário GLSL com `` `THREE.Fog` `` transformou o resto do shader em
código TypeScript e produziu quatro erros de sintaxe a cem linhas de distância da causa.
Comentário de shader não leva acento grave.

### O alvo acompanha objeto animado, e movimento reto não paga nada

**Fechado em 2026-07-28**, e fecha o limite que o ADR-016 tinha declarado: com o dono
animado, a câmera escorregava do ponto durante a pausa da narração.

O compilador do roteiro passou a amostrar a pausa e inserir keyframe de alvo **só onde a
reta entre os vizinhos já não descreve o caminho** — Douglas–Peucker sobre a série de
pontos, com tolerância de 20 cm. Medido no critério 10: objeto indo e voltando 40 m
durante a pausa, **um único** keyframe de acompanhamento inserido, exatamente no vértice
do movimento (frame 30), e o ponto projetando a **0,00 px do centro** na chegada, no meio
e na partida.

Três coisas para lembrar:

- **Objeto parado não paga nada**, e isso era a condição para o recurso existir: todos os
  desvios dão zero e o roteiro sai keyframe por keyframe igual ao de antes.
- **Movimento em linha reta também não paga nada, e a câmera já acompanha de graça.**
  Interpolar o alvo entre os dois extremos reproduz movimento linear **exatamente**. Só
  caminho que se afasta da reta precisa de keyframe no meio. Isto não é economia
  agressiva: é a redução notando que não há nada a acrescentar.
- **Os keyframes de acompanhamento são lineares nos dois lados.** Bézier passando por
  pontos amostrados de um objeto em movimento ultrapassa entre amostras, e a câmera
  oscilaria em torno do alvo — um tremor sutil que ninguém liga à curva.

E o enquadramento da visita saiu de `raio × 0,9` para `orbitDistanceToFit`, porque a conta
antiga **ignorava a lente**: a mesma distância mostra um quarto do objeto com campo de
visão de 20 e com 60, então o enquadramento "certo" mudava sozinho quando alguém tocava no
`fovDeg`, e o 0,9 não tinha de onde sair.

### A sombra do palco virou direcional

**Fechado em 2026-07-28.** A sombra já era a silhueta real do objeto — o dono tinha matado a
elipse analítica antes, com razão — mas projetada **de cima**, com a luz assumida vertical. O
docstring do módulo dizia isso em voz alta: _"a luz é vertical e paralela"_. O resultado é uma
mancha simétrica embaixo do objeto, e não uma sombra que cai para um lado.

Agora a silhueta é renderizada **da direção da luz**. Três coisas que valem lembrar:

- **O retângulo da textura tem de conter a sombra, não a pegada.** Com luz a 23° a sombra vai
  a 2,3 alturas de distância; ajustar pela pegada — que estava certo para luz vertical —
  cortaria a sombra ao meio. `fitLightFrustum` ajusta aos oito cantos da caixa vistos da luz,
  o que vale para qualquer inclinação sem caso especial.
- **Uma fonte só para onde está a luz.** Antes o rig tinha a direção fixa no código e o
  projetor assumia vertical: duas verdades diferentes sobre a mesma coisa. As props
  `keyAzimuthDeg`/`keyElevationDeg` aimam as duas juntas, na mesma régua da câmera orbital.
- **Luz rente ao horizonte recua para a projeção vertical**, e isso é decisão, não desistência:
  a sombra tenderia ao infinito e a silhueta sairia com um texel de altura.

Não há comparação de profundidade, e não precisa: o receptor é um plano e o emissor está
acima dele, então todo ponto do piso cujo raio de luz atravessa o objeto está na sombra.

### O reflexo do piso é planar e o orçamento foi medido (ADR-018)

**Fechado em 2026-07-28.** O piso continua sendo um quad de fundo com `depthTest`
desligado. O reflexo não o transformou em plano geométrico: uma câmera espelhada em
`y = 0` desenha o modelo num target, e o shader do piso amostra esse target pelo
ponto de mundo que já reconstruía. O recorte oblíquo remove a geometria enterrada e
o grid fica oculto no passe, portanto não há recursão.

Três detalhes evitam um reflexo “quase certo”:

- **Target RGBA16F linear.** RGBA8 cortava highlights antes do tone mapping. O
  shader desfaz a pré-multiplicação pelo alfa depois do blur e aplica a mesma ACES
  Filmic do Three, com exposição 1.
- **Compatibilidade é sem mutação implícita.** Projeto antigo resolve
  `reflectionStrength` ausente como 0; nó novo nasce com 0,3. O Inspector mostra o
  fallback sem escrever no documento, e a primeira edição ou keyframe inicializa a
  prop pelo Command Bus, com undo.
- **Offscreen é transação.** Reflexo e sombra restauram em `finally` target, face e
  mip, viewport, scissor, máscaras de cor/profundidade, clear, background,
  `overrideMaterial`, XR, atualização automática da sombra e visibilidade. A
  sombra não mantém mais assinatura incompleta de cache: repinta em todo frame,
  preservando a pureza quando muda qualquer entrada.

Na prova geométrica, não repetir a afirmação errada de que um ponto do piso cai nas
mesmas coordenadas nas duas câmeras. Para manter a câmera refletida _right-handed_,
a orientação X de tela inverte; a coordenada Y do ponto no piso é preservada.

O critério visual 13 exige geometria abaixo do contato, deslocamento espelhado com
mudança de altura, queda de energia ao apagar as luzes, ausência de tinta com o
modelo oculto antes e depois de semear o target e repetição exata de ON e OFF. O
13b mede 40 frames OFF e 40 ON em ordem ABBA com
`EXT_disjoint_timer_query_webgl2` assíncrona, descartando épocas disjoint.

Duas rodadas consecutivas em build estático isolado deram **14/14**. Canvas WebGL
físico **1951×1129**, target **976×565**, ANGLE/RTX 4090, zero disjoints:

| Rodada | CPU ON p95 | GPU Three ON p95 |
| ------ | ---------- | ---------------- |
| 1      | 1,20 ms    | 0,35 ms          |
| 2      | 1,00 ms    | 0,37 ms          |

**A fronteira da medição importa.** CPU vai de `evaluate` até terminar Three,
marcadores e submissão Pixi. GPU mede só o canvas Three; Pixi usa outro contexto e
o compositor do Chromium fica fora. Isso prova o custo incremental do reflexo
dentro dos 16,6 ms de 1080p, não a GPU completa do frame apresentado. A medição 4K
espera a janela de render do ADR-013; não há extrapolação.

Depois do bloco, `verify:phase8` ficou **7/7** e `verify:phase8-video`, **6/6**.
`verify:phase8-formats` parou em `ffmpeg ENOENT`; ferramenta ausente não foi
baixada.

### O verificador não era idempotente, e o critério 5 pagou

**Vale mais que o caso.** Rodar o `verify:phase7e3` duas vezes seguidas, sem reiniciar o app,
fazia o **critério 5 falhar com "0 pontos criados"** — a mesma mensagem que um clique que erra
a geometria produziria.

A causa: o critério 5 **alternava** o modo de marcação, assumindo que ele começa desligado. Os
critérios 8 e 10, que eu acrescentei depois, ligam a marcação e não desligam — e `marking` é
estado do **painel React**, não do documento, então o undo do fim do verificador não o desfaz.
Segunda rodada: o critério 5 desligava a marcação e clicava no vazio.

O conserto é o critério **garantir** o estado de que precisa em vez de alternar
(`if (aria-pressed !== 'true')`), que é o padrão que os critérios 8 e 10 já usavam. Provado
rodando duas vezes seguidas: **12/12 nas duas**.

A regra: **o undo do verificador restaura o documento, não a interface.** Qualquer estado de
painel — modo ligado, aba ativa, câmera solta — sobrevive entre rodadas, e critério que
depende dele tem de afirmá-lo, não alterná-lo.

### Duas medições erradas no mesmo dia, e o padrão que elas têm

Vale pelo método. Nos dois casos o critério ficou verde ou vermelho **pelo motivo errado**,
e nos dois a pista foi a mesma: um número que não deveria ser idêntico entre dois lados de
um A/B.

**A grade em vez do horizonte.** O critério do horizonte amostrava uma coluna de pixels e
media o maior salto entre vizinhos. Relatou **14,6 com névoa e 14,6 sem** — o maior salto
era uma **linha da grade**, nítida de propósito, e a costura nunca entrou na conta.
Conserto: desligar grade, textura e vinheta durante a medição.

**A reta em vez da curva.** O critério do acompanhamento animava o objeto em **linha
reta**, e relatou desvio 0,00 px com zero keyframe inserido — que parecia defeito e era
correção funcionando: reta é descrita pelos extremos. Conserto: mover o objeto em vai e
volta. O teste de unidade do mesmo recurso já usava uma parábola **e o comentário dele já
explicava por quê** — o erro foi repetido no verificador de todo modo.

**A falsa aprovação, que é a pior das três.** A primeira versão do critério 10 não removia
os pontos das etapas anteriores. Com seis paradas acumuladas, a parada nova era a última
— chegada no frame 450 — e a medição olhava os frames 0, 30 e 60, que são a **primeira**
parada, de um objeto parado. Deu 0,00 px nos três e o placar disse **verde sem ter testado
nada**. Critério que mede "a parada" precisa de exatamente uma.

A regra que sai daí: **quando os dois lados de um A/B dão o mesmo número, a primeira
hipótese é "estou medindo outra coisa", não "o conserto falhou".** E critério que herda
estado de critério anterior não está medindo o que o nome dele diz.

### A câmera do palco ganhou mouse (ADR-017)

**Fechado em 2026-07-28.** O dono pediu _"uma espécie de street view livre para poder
marcar os pontos nos objetos"_, e a medição foi desconfortável: **não existia interação
de câmera nenhuma** no palco. Nem `onPointerDown`, nem roda. O único jeito de girar era
digitar número no Inspector. Isso explicava uma frase estranha no ADR-015, que dizia
gravar _"os ângulos que a câmera tinha no instante da marcação"_ descrevendo um gesto
que o produto não oferecia.

A câmera de autoria é um `OrbitState` **local ao painel** que substitui a do documento
enquanto está ativa. Arrastar orbita, Shift ou botão do meio desloca o alvo, roda
aproxima. Quatro coisas para lembrar:

- **O documento não é tocado ao navegar.** É o que preserva o export byte-idêntico, e o
  critério 8 do 7e3 mede exatamente isso: o arrasto girou o azimute de 35,0° para
  −37,0°, a imagem mudou, e as seis props do palco ficaram **intactas**.
- **A câmera de autoria vive no mesmo espaço de parâmetros do documento**, e isso é a
  decisão, não um detalhe. Uma câmera de voo livre seria mais literal como "street
  view" e tornaria "Gravar enquadramento" uma **aproximação** — _roll_ e olhar fora do
  eixo não têm onde morar em `(target, distância, azimute, elevação)`, então gravar
  mudaria o enquadramento que o dono acabou de compor. Medido no critério 8: gravar é
  exato nas seis props.
- **Substituir num lugar só.** `effectiveStageCamera` entra entre `collectStudioStage` e
  o `runtime.render`, e por isso `pick`, `project`, os marcadores e os rótulos
  acompanham sem código novo. Se cada consumidor escolhesse a câmera, o marcador
  ficaria um frame atrás na primeira divergência.
- **Clique e arrasto no mesmo botão**, separados por 4 px de deslocamento. Era a única
  forma de atender "movimentar o cenário livremente **ao ativar o marcar pontos**" sem
  obrigar a desligar um para usar o outro. O `onClick` saiu: ele dispararia também no
  fim de um arrasto, e o dono ganharia um ponto de interesse a cada vez que girasse a
  cena.

Custo declarado e visível: **enquanto a câmera está solta, o preview não é o
enquadramento do vídeo.** A barra de estado diz isso, e os dois botões da câmera só
existem quando ela está solta — o que é o segundo aviso. `orbitDistanceToFit`, que
estava em L0 sem chamador desde o ADR-012 com o docstring dizendo "serve o botão
enquadrar", finalmente tem o botão.

### Trocar de aba do dockview por CDP: resolvido

A [pendência do ADR-014](#o-palco-virou-painel-próprio-adr-014-e-o-que-isso-ensinou)
dizia que `Input.dispatchMouseEvent` por coordenada trocava de aba **às vezes**, e
não se sabia por quê. O que funciona de forma confiável é despachar
`PointerEvent('pointerdown'/'pointerup')` **no próprio elemento da aba**, com
`bubbles`, `composed`, `pointerId` e `isPrimary` preenchidos — o dockview escuta
pointer no elemento, e o evento sintetizado a partir do mouse do CDP nem sempre
chega lá. Custou uma rodada do `verify:phase8` inteira relatando
`.maplibregl-canvas ausente`, que é o **sinal do painel errado** pela quarta vez.

### O palco virou painel próprio (ADR-014), e o que isso ensinou

**Fechado em 2026-07-28, quatro etapas, todas provadas.** O dono encontrou o preço
do ADR-012 mexendo no Inspector: baixar a opacidade do nó do palco reacendia o mapa
por baixo, porque o avaliador deriva `visible` de `opacity > 0`
(`packages/animation/src/evaluate.ts:151`) e o palco existia como CSS sobre o
Viewport. O veredito dele: _"quero que esse palco seja um ambiente à parte, numa aba
à parte, e não uma sobreposição."_

O [ADR-014](adr/ADR-014-studio-own-panel.md) emenda o ADR-012 e substitui a tabela
de superfícies do ADR-013. Estado: painel `studio` como aba irmã do Viewport, com
palco 3D e overlay Pixi próprios; `verify:phase8` 7/7, `phase8-video` 6/6,
`phase7e3` 5/5.

**O mesmo defeito apareceu três vezes com roupas diferentes, e a lição vale além
dele: sinal do painel errado.** O dockview **só monta o painel ativo** — as
superfícies da aba inativa não existem no DOM, e não é `visibility`, é montagem.
Isso quebrou, em sequência, o `settle` do export (`.maplibregl-canvas ausente` nos
três critérios), o `atFrame` do verificador (esperava um overlay desmontado) e o
critério 4 do 7E.3 (lia o layout do outro painel). Quando algo não aparece, a
primeira pergunta é qual aba está na frente.

Três consequências práticas para quem continuar:

- **O export detecta o modo** pela pilha montada (`detectExportMode` em
  `frame-composer.ts`), em vez de carregar uma lista fixa. Você exporta o que está
  vendo, e falha com mensagem clara em vez de escrever frame vazio.
- **O dockview escuta pointer.** `element.click()` **não** troca de aba; precisa de
  `Input.dispatchMouseEvent` por coordenada — e nem isso funcionou de forma
  confiável em toda tentativa. `activateStudioTab` no `verify-phase7e3.mjs` sai na
  hora se o palco já está montado, justamente por isso. **Pendência conhecida**, não
  resolvida.
- **Painel novo era invisível para quem já tinha layout salvo.** `fromJSON` restaura
  só o que está no arquivo, com sucesso — não é layout inválido, então o `catch` de
  fallback não pega. `adoptMissingPanels` em `useWorkspaceLayout.ts` conserta para
  **qualquer** painel futuro, não só o palco.

E dois defeitos de produto que os verificadores acharam, não a leitura de código:

- **O `near` recortava o chão.** O ajuste que corrigiu o z-fighting derivava `near`
  do raio da cena, e chão é **infinito** e começa embaixo da câmera. Com palco vazio
  o raio é o mínimo de 1 m, `near` ia a 38,4 m com a câmera a 40, e o piso todo
  desaparecia. O verificador relatou "transições por linha 0/0/0" — e a leitura certa
  era "o chão sumiu", não "a grade sumiu". `near` agora é limitado a metade da altura
  da câmera sobre o piso.
- **Critério de fase que se pula não prova nada.** O critério 2 do 7E.3 dependia de
  `data/library-roots.json`, configuração **de máquina**, e o relatório dizia
  "pulado" enquanto o placar contava falha sem explicar a causa. Ganhou recuo para o
  GLB do repositório (`apps/editor/public/models/fa-18f.glb`) e roda em qualquer
  clone.

### O `settle` 3D foi fechado e provado

**Fechado em 2026-07-28.** A lacuna foi reproduzida antes da correção: com o
renderer recarregado e o cache de templates frio, o primeiro export do F/A-18F
divergiu do segundo em **8 de 9 frames**. Um dos hashes mostrou o mecanismo com
precisão: o frame frio 0003 era igual ao quente 0000, porque o GLB terminou de
parsear no meio da primeira sequência.

`waitForQuiet` (`apps/editor/src/export/run-export.ts`) decide que um frame está
pronto por três condições: `observed.frame === frame`, contador de repinturas do
overlay estável por `QUIET_MS`, mapa livre e assets livres. As peças do fechamento:

- `scene3d-layer.ts` expõe `scene3dLayerPending(map)` por caminho **não-DEV**;
  `studio-scene.ts` expõe a mesma contabilidade por `pendingModels()`
- `SceneOverlay` soma mapa + palco em `probe().pendingAssets`; o export não
  depende do global de diagnóstico `window.__theatrumScene3d`
- GLB que falhou no parse ou está ausente conta como **resolvido, sem modelo**;
  esperar uma instância que nunca nascerá faria todo frame estourar o timeout
- o pump separa `mapBusy` de `assetsBusy`: câmera/tiles mantêm o teto de **4 s**,
  enquanto parse inicial de GLB tem teto próprio de **30 s**. Enquanto o asset
  está pendente o relógio curto é renovado; isso não dá 30 s a tile preso
- a transição ocupado → livre inicia a janela de quietude mesmo sem repaint novo;
  antes, manter o mesmo contador podia deixar `quietSince` nulo para sempre

Provas depois da correção:

- `scratchpad/repro-export-settle-3d.mjs`: **9/9 hashes idênticos** a frio e a
  quente, `settleFailed=0`
- `verify:phase8`, critério 6: cria um GLB visualmente idêntico mas com hash único
  a cada rodada (cache realmente frio), monta `model3d` + `route3d`, dispara o
  export imediatamente e prova **9/9 hashes idênticos**, visual 3D presente e
  `settleFailed=0` nas duas execuções
- 8 testes novos travam a contabilidade carregado/pendente/falho e o orçamento
  separado do asset

### O muxer MP4 é código nosso, e o que ele ensinou

`packages/export/src/mp4-muxer.ts`, com 25 testes. Duas coisas para lembrar antes
de tocar nele:

- **Errar a largura de um campo não dá erro.** O `tkhd` saiu doze bytes curto na
  primeira versão — faltavam `duration` e metade do `reserved`. As caixas
  continuavam íntegras, todos os tamanhos batiam, nenhum parser reclamava; só o
  decodificador recusava, sem dizer nada. Há testes que afirmam os **80 bytes** do
  corpo do `tkhd` e os **96** do `mvhd` exatamente por isso.
- **`latencyMode: "quality"` não é preferência, é requisito.** Em `realtime` o
  codificador descarta trabalho conforme o relógio de parede, e dois exports do
  mesmo projeto divergem. Medido: em `quality`, doze frames codificados duas vezes
  dão os mesmos bytes.

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

### 4.17 Comparar ângulos normalizados com régua linear atravessa a costura

Um teste de propriedade em `packages/core-math/src/scalar.test.ts` falhava em uma
volta a cada poucas, e o vermelho parecia infraestrutura porque o arquivo passa
12/12 quando roda sozinho. Era asserção.

A propriedade "aplicar o delta chega no destino" comparava
`normalizeDegrees(from + shortestAngleDelta(from, to))` com `normalizeDegrees(to)`
usando `approximately(..., 1e-9)`. Contraexemplo achado por varredura de fronteira:

```
from = 199.67773465141272
to   = -360.00000000000006        // o double imediatamente abaixo de -360
normalizeDegrees(from + delta) =   0
normalizeDegrees(to)           = 359.99999999999994
```

Os dois são a **mesma direção** a menos de 6e-14. A diferença **linear** é 360.
`normalizeDegrees` e `shortestAngleDelta` estão corretos; a régua estava errada.
A régua certa é modular — `shortestAngleDelta(chegada, destino) ≈ 0`. Corrigido,
mais um teste tabelado com o contraexemplo exato.

Duas lições que valem além deste caso:

- **Qualquer asserção sobre ângulo tem de ser modular.** Vale para banking,
  `geo-bearing`, `orbitCameraPosition` e o que vier.
- **`fc.assert` sem semente fixa deixa a suíte não reprodutível.** Foi o
  fast-check que achou o defeito, então a busca aleatória se pagou — mas num
  projeto cuja tese central é determinismo, vale decidir de propósito entre
  `{ seed: N }` (reprodutível, achado congelado) e semente livre (continua
  procurando, vermelho intermitente). Hoje é semente livre em toda parte, por
  omissão, não por decisão.

### 4.18 Bootstrap: `pnpm install` e `geo:build` não são opcionais

Clonar ou dar `git pull` e rodar `pnpm check` direto falha, e as mensagens não
dizem "falta bootstrap":

- `Cannot find module '@theatrum/export'` (e `@theatrum/gis` em `tools/`) é
  **link de workspace faltando**, não código errado. Um pacote novo no monorepo
  exige `pnpm install` para os symlinks de `node_modules/@theatrum/` aparecerem.
  Sintoma colateral: `depcruise` acusa `sem-modulo-nao-resolvido` e três testes
  falham na importação, o que parece violação de camada e não é.
- `Malha "countries" ausente em data/geo` pede `pnpm geo:build`. E o `geo:build`
  depende de `data/natural-earth/ne_10m_admin_0_countries.geojson`, que entrou na
  lista do `fetch-data` no 7B — quem tem a árvore de dados de antes do 7B precisa
  de `pnpm data:fetch` de novo (13 assets hoje, era 9). É o único comando do
  projeto que usa rede.

A ordem que funciona, do zero: `pnpm install` → `pnpm data:fetch` →
`pnpm geo:build` → `pnpm check`.

## 5. Como verificar de verdade

Cada fase tem um verificador que dirige o **Electron real** por CDP na porta 9222.
Isso não é opcional neste projeto: teste unitário não pega defeito de projeção,
de shader nem de composição.

Superfícies de depuração disponíveis apenas em desenvolvimento ou no build
estático feito com a flag explícita de verificação; o build distribuído não as
leva:

| Superfície                   | O que dá                                              |
| ---------------------------- | ----------------------------------------------------- |
| `__theatrumPhase2.map`       | Instância MapLibre; `.settle(ms)` espera o mapa parar |
| `__theatrumPhase3`           | `getSnapshot()`, `actions`, `commandBus`              |
| `__theatrumPhase4`           | `getSnapshot()` do frame, `captureExport()`           |
| `__theatrumScene3d.status()` | Estado da camada Three.js sobre o mapa                |
| `__theatrumStudio.status()`  | Estado do palco 3D: câmera, modelos, contexto         |
| `__theatrumStudio.profile`   | Profiler CPU/GPU assíncrono do canvas Three           |
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

Ordem atual do roteiro combinado com o dono: o próximo bloco de produto é a
**timeline própria do modo palco**, descrita no começo da §3. Formatos extras e
instalador estão concluídos; o primeiro passe de **polimento, medição de
performance, guia de uso e projetos de exemplo** também foi entregue. Os três
gates de motor/timeline passam em `pnpm test:perf`, e os exemplos são gerados
byte-idênticos por `pnpm examples:build`. Os blocos 7C/7D e a **Fase 7 de Ações**
já foram concluídos. A ação operacional pendente nesse bloco é rodar novamente
`pnpm dist:win` quando a autorização externa estiver disponível, para incorporar
os exemplos ao executável.

Duas pendências arquiteturais herdadas que ainda valem atenção:

1. **Critério 4 da Fase 6** está registrado como "delta mínimo de blend sob
   investigação de tolerância". É a mesma família de problema que o critério 2 da
   Fase 8 — arquivos idênticos byte a byte — vai cobrar a sério.
2. **`packages/engine` continua stub** enquanto `apps/editor` importa L2 e L3
   direto, divergindo de [02-MODULES](02-MODULES.md). A janela de render isolada
   da continuação da Fase 8 deve fechar essa decisão.

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
