# Prompt para o Kimi K3 — continuar o Theatrum

Copie tudo abaixo da linha e cole na sessão nova.

---

Você vai continuar o **Theatrum**, um editor de animação geopolítica/militar
estilo After Effects, 100% local e offline. Repositório em `D:\maplive\map\mapli-ve`,
remote `https://github.com/Syfer2025/mapli-ve` (branch `main`, último commit
`f9a895e`).

## Antes de escrever qualquer código, leia nesta ordem

1. `docs/09-CONTINUIDADE.md` — passagem de bastão. **§1** diz onde parou, **§3** o
   que falta, **§4** as 18 armadilhas já pagas desta base, **§5** como verificar
   de verdade, **§8** o estilo de trabalho combinado com o dono.
2. `docs/08-ROADMAP.md` — estado de cada fase com critérios de saída. Atenção: a
   seção **7A+** tem três afirmações **riscadas** porque foram derrubadas por
   medição no 7A++. Leia o 7A++ antes de tocar na camada 3D.
3. `docs/adr/` — as decisões já tomadas, com alternativa honesta e consequência
   negativa declarada. **ADR-012** (canvas próprio do palco 3D) e **ADR-013**
   (composição do frame de export) são os mais recentes.

## Bootstrap — obrigatório, e as mensagens de erro não dizem que falta bootstrap

```bash
pnpm install && pnpm data:fetch && pnpm geo:build && pnpm check
```

`Cannot find module '@theatrum/export'` é link de workspace faltando, não código
errado. `Malha "countries" ausente` pede `geo:build`. `data:fetch` é o único
comando do projeto que usa rede. Detalhe em 09-CONTINUIDADE §4.18.

Se `pnpm` não estiver no PATH da sua máquina, rode os binários direto:
`export PATH="$PWD/node_modules/.bin:$PATH"` e então `tsc -b`, `eslint .`,
`prettier --check .`, `depcruise packages apps --config .dependency-cruiser.cjs`,
`vitest run`, `electron-vite dev`.

Estado esperado depois do bootstrap: **998 testes em 98 arquivos, verde**, 319
módulos, sem violação de camada, build electron-vite ok.

## Onde o projeto está

Fases 0–6 concluídas. Bloco 7 inteiro fechado (única exceção declarada: 7E.4,
VFX volumétrico, adiado pelo dono e bloqueado por não haver Blender/Houdini/
OpenVDB na máquina). **Fase 8 produz MP4 H.264 byte-idêntico entre execuções** —
o critério que o roteiro chama de mais importante do projeto.

Sete verificadores dirigem o **Electron real** por CDP na porta 9222:
`verify:phase7a`, `7b` (4/4), `7c`, `7d` (4/4), `7e3` (5/5), `phase8` (7/7),
`phase8-video` (6/6). Suíte de unidade: 1028 testes em 104 arquivos.

**Depois disso veio o ADR-014**, que tirou o Palco 3D de dentro do painel Viewport
e o transformou em aba própria, com pilha de superfícies própria. Quatro etapas,
todas fechadas e provadas. Três coisas que ele ensinou e que você vai encontrar:

- O dockview **só monta o painel ativo**. As superfícies da aba inativa não
  existem no DOM — não é `visibility`, é montagem. Foi isso que quebrou o `settle`
  do export, o `atFrame` do verificador e o critério 4 do 7E.3: **sinal do painel
  errado**, três vezes com roupas diferentes. Se algo não aparece, pergunte primeiro
  qual aba está na frente.
- O dockview escuta **pointer**: `element.click()` não troca de aba. Precisa de
  `Input.dispatchMouseEvent` por coordenada — e nem isso funciona sempre (não
  descobri por quê; está registrado como pendência no verificador).
- O export **detecta** o modo pela pilha montada (`detectExportMode`), em vez de
  carregar uma lista fixa de superfícies. Você exporta o que está vendo.

## Sua primeira tarefa: implementar o ADR-015 (pontos de interesse do palco)

Leia `docs/adr/ADR-015-studio-points-of-interest.md` inteiro. Ele tem a forma
decidida e cinco consequências declaradas. Resumo do que manda fazer:

O dono quer apresentar equipamento militar no Palco 3D: a câmera vai até o míssil
e ele fala do míssil; vai até a cabine e fala da cabine, com texto entrando em cada
parada. Os pontos vêm de **clique na superfície do modelo**, não dos nós do glTF.

**Por que não dos nós do glTF, e não tente "melhorar" isso:** foi medido. O
obuseiro 2S19M1 do dono tem 0 animações, 0 skins, e 51 nós irmãos planos chamados
`Object_2` a `Object_50`. Veio de um OBJ e a Sketchfab agrupou por **material** — 20
das 49 malhas ocupam mais de 60% de um eixo do veículo, várias em 100%. Não existe
"o nó da torre". Para conferir por conta própria: leia o chunk JSON do GLB direto
(header de 12 bytes, depois chunks de 8) e compare os `min`/`max` dos accessors de
POSITION, que o glTF obriga a existir.

Peças a construir, na ordem:

1. **Tipo de nó `studio.poi`**: nome, ponto em metros no espaço do palco, e o
   enquadramento da câmera ao visitá-lo. Segue o padrão de `studio.stage` em
   `packages/scene-graph/src/builtin-node-types.ts` — e como o palco, **não** deve
   herdar `COMMON_PROPERTIES` sem pensar. Ver ADR-014: `transform.opacity` num nó
   que não é desenhável foi armadilha real, porque o avaliador deriva `visible` de
   `opacity > 0` (`packages/animation/src/evaluate.ts:151`).
2. **Botão "Marcar pontos"** no `StudioViewport`. Ligado, clique na superfície faz
   raycast contra a cena do palco e cria o POI ali. O `StudioSceneRuntime` já tem a
   cena e a câmera; falta expor um método de picking.
3. **Marcadores visíveis** dos POI existentes, no overlay Pixi do palco — que já
   existe e já desenha `label.callout`, provado no verificador 5/5.
4. **Roteiro** como sequência de visitas, **compilando para keyframes** nas props de
   câmera que o `studio.stage` já tem. Não faça um player paralelo: compilar mantém
   a câmera função pura de (documento, frame), preserva o export byte-idêntico e dá
   o editor de curvas de graça. Siga o precedente da Fase 7 (ações live →
   keyframes) em vez de inventar outro.

**O que NÃO está no escopo, e não confunda:** POI leva a câmera **até** a torre; não
**gira** a torre. Girar exige `gltf.animations` — hoje descartado em
`three-assets.ts` — e um modelo com a torre como nó separado, que o 2S19 não tem.

**Como verificar:** `node tools/verify-phase7e3.mjs` com a aba "Palco 3D" ativa.
Deve continuar 5/5 depois do seu trabalho, e ganhar critério novo para o POI.

## Depois disso, na ordem do roteiro

1. **Resolução acima do tamanho da janela.** Hoje o frame sai no tamanho do
   viewport e o H.264 exige dimensão par (1227×643 vira 1226×642). É o gatilho
   declarado no ADR-013 para voltar à janela de render oculta.
2. **Fase 7 (ações).** Templates de impacto. Nada dela ameaça o que já está provado.
3. **Formatos que faltam:** GIF, ProRes 4444 com alfa, sequência com canal alfa.
   O muxer MP4 é código nosso (`packages/export/src/mp4-muxer.ts`, 25 testes) e é
   só vídeo — áudio entraria como trilha 2.
4. **Motion blur, checkpoint e retomada.**

## Regras desta base que não são negociáveis

- **Renderização é função pura de `(documento, frame)`.** Sem `Date.now()`, sem
  `Math.random()`, sem estado acumulado. Sem isso não existe export confiável.
- **O documento é a única verdade.** Toda mutação passa pelo Command Bus.
- **Dependência forma um DAG**, verificado por `pnpm lint:arch`, não por disciplina.
- **Offline é requisito**, não modo degradado. Nada de rede no caminho crítico.
- **Decisão de arquitetura vira ADR** antes do código, com alternativas honestas e
  consequência negativa declarada. Uma decisão por arquivo.
- **Medir, não achar.** Quando o número contraria a expectativa, o número ganha.
  Duas afirmações "provadas" deste roteiro já caíram por medição — uma delas
  custou o volume 3D do modelo por uma sessão inteira.
- **Limite conhecido vai para o roteiro**, não some. Afrouxar teste para ficar
  verde é o erro que este projeto não comete.
- **Entrega em blocos.** Parar no fim de cada bloco, relatar, e só então seguir.
  Nunca despejar blocos grandes de código.
- **Captura de tela não prova sozinha** (09-CONTINUIDADE §4.5). Meça em pixel, ou
  leia o estado pelo CDP.

## Uma armadilha específica sua

09-CONTINUIDADE §4.17: **qualquer asserção sobre ângulo tem de ser modular.**
Comparar `normalizeDegrees(a)` com `normalizeDegrees(b)` por diferença linear
atravessa a costura 0/360 — dois ângulos idênticos a menos de 6e-14 medem
diferença de 360. Isso derrubou um teste de propriedade de forma intermitente, e o
vermelho parecia infraestrutura. Vale para banking, `geo-bearing` e
`orbitCameraPosition`. E note que `fc.assert` roda **sem semente fixa** em toda a
base: hoje isso é por omissão, não por decisão — se quiser reprodutibilidade,
essa é uma decisão consciente a tomar.

Comece confirmando o bootstrap e a suíte verde. Depois relate o que encontrou
antes de mexer no `settle`.
