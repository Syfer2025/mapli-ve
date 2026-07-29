# Prompt de continuação — Theatrum

Copie tudo abaixo da linha e cole na sessão nova.

---

Você vai continuar o **Theatrum**, editor de animação geopolítica/militar, 100%
local e offline. Repositório em `https://github.com/Syfer2025/mapli-ve`, branch
`main`, **último commit** — o mesmo que traz este arquivo. Os três commits da
sessão anterior são `337486f` (a ligação do ADR-022), `6ac9edf` (ADR-024 e
ADR-025) e este.

## LEIA ANTES DE ESCREVER CÓDIGO, nesta ordem

1. `docs/09-CONTINUIDADE.md` — comece pela seção **"⚠ REGRESSÃO ABERTA"**, que é o
   seu primeiro trabalho. Depois §3.1 (inventário da resolução do export), §4 (as
   armadilhas já pagas), §5 (como verificar de verdade) e §8 (o estilo de
   trabalho combinado com o dono).
2. `docs/adr/ADR-022-export-resolution-from-composition.md` — a decisão que foi
   executada, e a **nota de implementação** no fim, que registra os desvios.
3. `docs/adr/ADR-023-no-msaa-on-composed-surfaces.md` — por que o MSAA está
   desligado, e a **segunda medição**, que mostra que o limiar é da placa de
   vídeo. Não religue sem ler.
4. `docs/adr/ADR-024-deterministic-supersampling.md` e
   `docs/adr/ADR-025-motion-blur-accumulation.md` — os dois trabalhos seguintes,
   já decididos e **não implementados**.
5. `tools/probes/README.md` — as sondas de bancada e as três lições delas.
6. `docs/11-VISAO-FUTURA.md` — planos ESTACIONADOS. Não implemente nada dali.

## BOOTSTRAP (as mensagens de erro não dizem que ele falta)

```bash
pnpm install && pnpm data:fetch && pnpm geo:build && pnpm check
```

Se `pnpm` não estiver no PATH, use os binários direto:
`export PATH="$PWD/node_modules/.bin:$PATH"`, e então `tsc -b`, `eslint .`,
`prettier --check .`, `vitest run`, `electron-vite dev`.

`data/library-roots.json` não vem no Git (é config de máquina, e os modelos não
vão para o GitHub por instrução do dono). Sem ela o palco 3D abre vazio. Formato
em 09-CONTINUIDADE §6; depois de criar, rode `pnpm models:index`.

## ESTADO ESPERADO

- `pnpm check`: **1226 testes em 121 arquivos**, typecheck ×4, eslint, prettier,
  depcruise 375 módulos sem violação, build.
- `verify:phase8`: **9/9** — mas o critério 5 oscila, e é a regressão aberta.
- `verify:phase8-video`: **6/6**, e o arquivo sai em **1920×1080**.
- `verify:phase7e3`: **14/14**.
- `verify:phase8-formats` precisa de FFmpeg no PATH; sem ele para em `ENOENT`, e
  os 5/5 são prova histórica, não sua.

Os verificadores dirigem o **Electron real** por CDP na porta 9222; exigem
`pnpm dev` rodando. O processo de dev não reinicia sozinho, e mudança no processo
principal não entra por HMR:

```powershell
Get-NetTCPConnection -LocalPort 5273 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-Process electron | Stop-Process -Force
```

---

# SEU TRABALHO — três itens, nesta ordem

## 1. FECHAR A REGRESSÃO DE FILTRO + REDIMENSIONAMENTO

**É o primeiro item porque ele bloqueia os outros dois.** Supersampling e motion
blur são construídos em cima do caminho de redimensionamento; construir sobre um
caminho que não repete bit a bit é construir sobre o defeito.

### O sintoma, medido

Com **filtro do Pixi na cena** (`outline` + `glow` sobre um nó geo), duas
execuções do mesmo export divergem nos **primeiros** frames. Sempre índices 0 e 1,
nunca os últimos. `settleFailed=0` em todos os casos — o pump acredita que
assentou.

| Cena                     | Escala | Rodadas | Divergiram |
| ------------------------ | ------ | ------- | ---------- |
| geo + rótulo             | 1      | 8       | **0**      |
| geo + rótulo             | 2      | 6       | **0**      |
| geo + estradas + filtros | 2      | 5       | **3**      |
| geo + estradas + filtros | 2      | 6       | **3**      |

Quem acusa é o **critério 5 do `verify:phase8`**. Antes da ligação do ADR-022 ele
era estável — 7/7 em três rodadas, medido com `git stash`.

### Três hipóteses já testadas e DERRUBADAS por medição

Não repita nenhuma delas. Todas foram revertidas.

1. **Viewport do Three desatualizado.** `WebGLRenderer` guarda o próprio
   `_viewport`, fixado no tamanho de quando nasceu. Foi corrigido e o conserto
   **fica** (`scene3d-layer.ts`, `setViewport` a cada frame), porque é certo por
   si — mas não era a causa: a divergência acontece igual **sem nó 3D nenhum**.
2. **Aquecimento de primeira pintura.** Pintar outro frame e voltar antes de o
   pump começar. Três de seis rodadas continuaram divergindo.
3. **`TexturePool.clear(true)` no `resize` do backend Pixi.** Destruiu texturas em
   uso: o export **congelou** — `distintos=1` entre quatro frames,
   `settleFailed=3` — e ainda assim o relatório dizia "IDÊNTICAS". Guarde isto: a
   comparação "duas execuções iguais" sem a guarda de "frames distintos entre si"
   é falsa aprovação.

### Por onde começar

- **Meça o tamanho da diferença, não só o hash.** A sonda atual só compara
  SHA-256. `scratchpad/probe-divergencia.mjs` já monta a cena e aceita rodadas,
  escala e a palavra `filtros` como argumentos:
  `node scratchpad/probe-divergencia.mjs 6 2 filtros`. Falta fazê-la relatar
  **contagem de pixels diferentes e delta máximo**, como
  `scratchpad/probe-limiar-com-guarda.mjs` faz. Poucos pixels com delta pequeno
  aponta para borda de filtro; região inteira aponta para estado errado.
- **Onde olhar no código:** `packages/renderer/src/pixi-filter-chain.ts`. O
  `filterArea` e o `padding` do passe dependem do retângulo do nó em pixels de
  tela, e esse retângulo muda com a resolução. O passe de blur do `glow` amostra
  **fora** do retângulo, onde mora o conteúdo que o pool do Pixi recicla.
- **A causa pode ser anterior ao filtro:** o passe geo (`geo-nodes.ts`) usa
  `geoViewportOf(map)`, que depende de `map.getBounds()`, e os bounds mudam com o
  tamanho do viewport. Se o overlay renderizar com bounds de antes do `resize`, a
  geometria de entrada do filtro já é outra.

### Decisão que é do dono, não sua

Se não fechar, pergunte a ele: aceitar o limite declarado enquanto se investiga,
ou segurar a ligação do ADR-022. **Não afrouxe o critério 5 para ficar verde.**

## 2. SUPERSAMPLING — ADR-024, escrito e não implementado

O dono reclamou, no mesmo dia, de duas coisas que são a mesma:

> "to olhando para um avião agora e ta faltando anti aliasing, ta cheio de
> serrilhado, não to gostando disso"

> "os contornos dos mapas estão muito grosseiros"

Ele roda numa **RTX 4090** e disse explicitamente que quer priorizar qualidade
gráfica. Isso **não** libera religar o MSAA — leia a segunda medição do ADR-023
para entender por quê: o defeito não reproduz nesta placa, e é justamente isso que
o condena, porque a bit-exatidão passaria a depender do hardware de quem exporta.

A decisão está no `ADR-024`. O que falta implementar:

- **Fator de supersampling no job**, entrando no mesmo `planExportResolution`, que
  passa a recusar quando `saída × fator` estoura o teto de 4096 px do MapLibre.
- **Redução por kernel conhecido** (box para fator inteiro), no nosso código — é o
  que dá determinismo por construção.
- **Fator no preview atrás de controle explícito**, desligado por padrão. Numa
  máquina modesta o padrão ligado transforma o editor em apresentação de slides.
- **Critério novo no verificador**: exportar com fator e afirmar duas execuções
  idênticas. Supersampling que não repete bit a bit é pior que serrilhado.

A máquina de conduzir superfícies com `pixelRatio` próprio **já existe** e está
provada: `apps/editor/src/export/surface-override.ts`. Supersampling é literalmente
"renderizar maior e reduzir", e a metade "maior" está pronta.

Uma pergunta ao dono que ainda não foi respondida e muda o diagnóstico dos
contornos: o mapa está grosseiro **no preview, no arquivo exportado, ou nos dois**?
O MapLibre já suaviza preenchimento e traço no shader dele, então se for só no
preview o suspeito é largura de traço e quantização da malha, não antialias.

## 3. MOTION BLUR — ADR-025, escrito e não implementado

Acumulação de subframes no compositor. A fundação já existe: `evaluate` aceita
frame fracionário de propósito (ADR-004), `subframe()` em `core-time` não
arredonda, e `exactFrames` já tem um teste que se declara "base do motion blur".

Os três limites já decididos, e não os afrouxe:

1. **Só em export**, nunca no preview.
2. **Acumulador `Float32Array` reaproveitado entre frames** — 132 MB em 4K, e um
   alvo novo por frame é como se esgota o orçamento de contextos.
3. **`settle` por subframe é obrigatório.** Um subframe capturado cedo entra na
   média e contamina o frame inteiro.

O critério de verificação tem **duas metades**, e a segunda não é opcional: duas
execuções idênticas **e** o frame com blur diferente do frame sem blur. A primeira
passa sozinha quando o blur não faz nada.

E `shutterAngle: 0` ou `samples: 1` tem de sair **byte-idêntico** ao caminho de
hoje, senão ligar o recurso muda todo export já provado.

O custo declarado é o que precisa aparecer na estimativa do painel de fila
**antes** de o usuário apertar Exportar: com p99 de settle de 100 ms, oito
subframes são ~800 ms por frame só de espera, e um trecho de 300 frames sai de
30 s para 4 minutos.

---

# REGRAS DESTA BASE, NÃO NEGOCIÁVEIS

- Render é função pura de (documento, frame). Sem `Date.now()`, sem
  `Math.random()`, sem estado acumulado.
- O documento é a única verdade; toda mutação passa pelo Command Bus.
- Decisão de arquitetura vira ADR **antes** do código, com alternativas honestas e
  consequência negativa declarada. Uma decisão por arquivo.
- **Medir, não achar.** Quando o número contraria a expectativa, a primeira
  hipótese é "estou medindo outra coisa" — e se o número resistir, o número ganha.
- Limite conhecido vai para o roteiro, não some. Afrouxar teste para ficar verde é
  o erro que este projeto não comete.
- Entrega em blocos: parar no fim de cada um, relatar, e só então seguir.

---

# ARMADILHAS

As seis herdadas continuam valendo: sinal do painel errado (o dockview só monta a
aba ativa), troca de aba só por `PointerEvent` no próprio elemento da aba, o teto é
o `maxCanvasSize` do MapLibre e ele baixa o pixel ratio em silêncio, não crie
vários contextos WebGL2 de 4K numa sonda, espera fixa mede o frame velho, e sem nó
`studio.stage` o palco fica em 300×150.

**Cinco novas, todas pagas na sessão anterior:**

1. **A armadilha 4.11 está incompleta.** `preserveDrawingBuffer: true` é
   necessário e **não é suficiente**: medido, com a flag ligada, `drawImage` do
   canvas do MapLibre ocioso devolveu **soma 0**, e a mesma leitura logo depois de
   `triggerRepaint()` devolveu **96637**. Quem lê pixel do mapa **pede a repintura
   antes**.
2. **`isStyleLoaded()` não serve de porta.** Devolveu `false` com o mapa
   carregado, pintando, nove camadas no estilo e `areTilesLoaded()` verdadeiro.
   Usá-lo como guarda travou o verificador por 20 s num mapa perfeitamente pronto.
3. **Backtick dentro de template literal fecha a string.** Um comentário com
   crase em volta de `isStyleLoaded()`, dentro da expressão que o CDP avalia,
   produziu `SyntaxError` a dezenas de linhas de distância. Vale para shader e
   para expressão de verificador.
4. **Confirmar não é estar.** Quando um estado é conduzido de fora, espere o
   **estado**, nunca o evento que o pediu. Evento diz "recebi"; só predicado diz
   "estou", e só o segundo é verificável.
5. **Superfície de chrome com dois donos vira medição de outra coisa.** A moldura
   da composição morou no canvas de marcadores do palco por um commit, e o
   critério 5 do `verify:phase7e3` reprovou na hora: ele mede a tinta daquele
   canvas e exige que ela suma ao desligar a marcação. A moldura não some. Agora
   ela tem canvas próprio, `.studio-viewport__guide`, também na
   `EXCLUDED_SURFACE_SELECTORS`.

---

# COMO VERIFICAR DE VERDADE

`verify:phase8` é a sua rede de segurança e testa exatamente o que você vai
alterar. Rode-o **depois de cada bloco**, não só no fim — e rode **mais de uma
vez**, porque o defeito que você está caçando é intermitente. Uma rodada verde não
prova nada aqui.

E antes de concluir que quebrou alguma coisa, tire o baseline: guarde as suas
mudanças com `git stash push -u`, rode o verificador, e devolva com `git stash
pop`. Foi assim que a regressão da sessão anterior foi atribuída corretamente — e
foi assim que se descobriu que o verificador dava 6/7 **no código sem nenhuma
mudança** quando rodado logo depois de recarregar o renderer.

Sondas úteis que ficaram em `scratchpad/` (não versionado, recrie se sumir):

| Sonda                         | Pergunta que ela responde                                |
| ----------------------------- | -------------------------------------------------------- |
| `reload-renderer.mjs`         | recarrega o renderer e espera as superfícies voltarem    |
| `probe-gpu-info.mjs`          | qual GPU, driver, `SAMPLES`, atributos de contexto       |
| `probe-limiar-com-guarda.mjs` | limiar de repintura **com guarda de conteúdo**           |
| `probe-divergencia.mjs`       | quais frames divergem, em N rodadas, com escala e filtro |
| `probe-moldura.mjs`           | a moldura da composição desenha no lugar certo?          |
| `probe-export-4k.mjs`         | o export em escala 2 sai, e com que mensagem de erro     |
