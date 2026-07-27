# 09 — Continuidade

Documento de passagem de bastão. Escrito para uma IA que vai continuar este
projeto sem ter acompanhado a sessão anterior.

O que **não** está aqui: arquitetura (está em [02](02-MODULES.md)), decisões
(estão nos [ADRs](adr/README.md)), estado das fases (está em
[08-ROADMAP](08-ROADMAP.md)). O que **está** aqui: onde a agulha parou, o que
morde, e como não repetir erro já cometido.

---

## 1. Onde parou

Último commit: `4d8959c`. `pnpm check` verde — 833 testes em 86 arquivos, 285
módulos, 747 dependências, sem violação de camada.

Fases 0–6 concluídas. Blocos 7A e 7A+ concluídos. **Bloco 7B em curso.**

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

## 2. O que falta no 7B, na ordem que eu faria

### 2.1 `geo.roads` — com medição própria

O [ADR-009](adr/ADR-009-geo-layers-overlay.md) registra explicitamente que
estradas **não herdam** a conclusão de países: o arquivo de origem é quatro vezes
maior e a densidade por área é outra. Medir antes de construir.

O que já existe e serve: o compilador (`tools/build-geo.ts`) aceita uma camada
nova com uma entrada na tabela `LAYERS`; o leitor, o recorte e o passe de projeção
funcionam para qualquer camada.

O que provavelmente vai morder: `ne_10m_roads.geojson` tem 48 MB e a malha é de
linhas abertas, não anéis — o caminho de recorte é `clipPolyline`, já implementado
e testado, mas nunca exercitado com dado real de estrada.

### 2.2 `area.transfer` — transição de cor de território em OkLab

Interpolar `fill` de um `geo.region` em OkLab, não em sRGB. Está no escopo do
bloco e é o uso real de território animado: mostrar avanço de frente.

Ponto de atenção: a interpolação tem de ser **determinística e reversível** —
critério 2 do bloco exige hash de frame idêntico no scrub para trás.

### 2.3 Verificador `tools/verify-phase7b.mjs`

Os quatro critérios de saída estão em [08-ROADMAP](08-ROADMAP.md#7b--camadas-geográficas-contornos-estados-estradas).
Use `tools/verify-phase7a.mjs` como molde. Provas ao vivo já escritas que valem
reaproveitar estão descritas na seção 4.

## 3. Armadilhas desta base de código

Cada uma custou tempo real. Ler antes de tocar no código.

### 3.1 Backtick e barra invertida em string de shell

`node -e "..."` e heredoc **comem** backtick e barra invertida. Já quebrou código
injetado silenciosamente quatro vezes nesta sessão, incluindo um caminho de
Windows que virou `C:UsersalexmOneDrive...` sem erro nenhum.

Use as ferramentas de escrita e edição de arquivo. Quando precisar de caminho
Windows em JSON, use **barra normal** — `path.isAbsolute("C:/x")` é verdadeiro no
Windows e não há o que escapar.

### 3.2 O servidor de desenvolvimento não reinicia sozinho

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

### 3.3 Fim de linha

O repositório é LF, imposto por `.gitattributes`. O Git do Windows instala
`core.autocrlf=true` por padrão e, sem o arquivo, `pnpm check` falha em todo
arquivo num clone limpo. Se acontecer, o conserto é `core.autocrlf=false` mais
`rm .git/index && git reset --hard`.

### 3.4 O protocolo local recusa junção — de propósito

`theatrum-data://` resolve `realpath` e barra o que escapa da raiz. Não
enfraqueça. Para servir pasta de fora, declare uma raiz nomeada em
`data/library-roots.json` (formato na seção 5).

### 3.5 Cuidado com afirmação vinda de captura de tela

Duas vezes nesta sessão eu li errado uma captura: uma vez achei que havia
preenchimento vazando (não havia — era o mapa base), outra achei que estava certo
quando faltava um país inteiro. **Meça o pixel.** `__theatrumPhase4.captureExport()`
devolve o overlay isolado; projete a coordenada conhecida com `map.project()` e
leia o alfa. O padrão está em `scratchpad/pixel-geo.mjs` da sessão anterior e
descrito na seção 4.

### 3.6 O antimeridiano estraga caixa envolvente

Rússia, Estados Unidos e Fiji têm caixa de −180 a 180 porque parte do território
cruza o antimeridiano. Consequências que já mordi:

- Centro da caixa cai no oceano errado → âncora fora da tela → nó descartado.
  Resolvido: o compilador guarda o ponto representativo do **maior anel**.
- Descarte por caixa nunca exclui esses países. Resolvido: caixa **por anel**.
- Nem isso basta quando o anel continental contém a vista. Resolvido: recorte.

Qualquer código novo que use `feature.bounds` para decidir visibilidade herda o
problema.

### 3.7 Pixi 8: `fill()` consome os caminhos pendentes

Acumular vários anéis antes de preencher funde ilhas num polígono só — a Crimeia
gruda no continente por uma linha reta. Preencha e trace **por anel**.

### 3.8 Precisão de shader

O Pixi injeta `precision highp float` no vertex e `mediump` no fragment quando o
código não declara. Uniform declarado nos dois estágios não liga o programa, e o
filtro simplesmente não pinta — sem erro visível. Todo fragmento próprio abre com
`precision highp float;` **na primeira linha**, sem newline antes: o
pré-processador testa os nove primeiros caracteres. Coberto por
`packages/renderer/src/filter-shaders.test.ts`.

### 3.9 Sutherland–Hodgman pinta área que não existe

Em anel concavo que sai da vista e volta a entrar, ele devolve um só anel ligando
os pedaços pela borda do recorte. `clipRing` conta entradas e recusa acima de uma,
devolvendo −1; o chamador então projeta o anel inteiro. Conta entrada **por
aresta**, não por vértice — uma aresta longa atravessa a caixa entre dois vértices
ambos externos.

## 4. Como verificar de verdade

Cada fase tem um verificador que dirige o **Electron real** por CDP na porta 9222.
Isso não é opcional neste projeto: teste unitário não pega defeito de projeção,
de shader nem de composição.

Superfícies de depuração disponíveis apenas em desenvolvimento:

| Superfície                   | O que dá                                              |
| ---------------------------- | ----------------------------------------------------- |
| `__theatrumPhase2.map`       | Instância MapLibre; `.settle(ms)` espera o mapa parar |
| `__theatrumPhase3`           | `getSnapshot()`, `actions`, `commandBus`              |
| `__theatrumPhase4`           | `getSnapshot()` do frame, `captureExport()`           |
| `__theatrumScene3d.status()` | Estado da camada Three.js                             |
| `__theatrumPhase4Timeline`   | Métricas de redraw da timeline                        |

Desfazer usa `commandBus.history.undo()` e `history.canUndo()` — **não** existe
`commandBus.undo()`.

Pausar antes de amostrar: `actions.pause()`. Um demo deixa a composição tocando em
loop, e sem pausar cada amostra lê um frame ao acaso. Isso já produziu uma tabela
inteira de números sem sentido.

## 5. Configuração local desta máquina

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

## 6. Depois do 7B

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

## 7. Estilo de trabalho combinado com o dono

- **Entrega em blocos.** Parar no fim de cada bloco, relatar, e só então seguir.
  Nunca despejar blocos grandes de código.
- **Documento antes de código.** Decisão de arquitetura vira ADR, com alternativas
  honestas e consequência negativa declarada — é regra escrita em
  [adr/README.md](adr/README.md), e uma decisão por arquivo.
- **Medir, não achar.** O roteiro exige decisão medida em vários pontos. Quando o
  número contraria a expectativa, o número ganha.
- **Limite conhecido vai para o roteiro**, não some. Afrouxar teste para ficar
  verde é o erro que este projeto não comete.
