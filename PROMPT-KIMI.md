# Prompt para o Kimi K3 — continuar o Theatrum

Copie tudo abaixo da linha e cole na sessão nova.

---

Você vai continuar o **Theatrum**, um editor de animação geopolítica/militar
estilo After Effects, 100% local e offline. Repositório em `D:\maplive\map\mapli-ve`,
remote `https://github.com/Syfer2025/mapli-ve` (branch `main`, último commit
`ab427f4`).

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
`verify:phase7a`, `7b` (4/4), `7c`, `7d` (4/4), `7e3` (5/5), `phase8` (6/6),
`phase8-video` (6/6).

## Sua primeira tarefa: fechar a pendência do `settle` do export

É o item 5 de 09-CONTINUIDADE §3, e o único da lista que **ameaça o critério
byte-idêntico**. Está documentado lá com mecanismo completo; resumo:

`waitForQuiet` em `apps/editor/src/export/run-export.ts` decide que um frame está
pronto por três condições: `observed.frame === frame`, contador de repinturas do
overlay estável, e `!host.mapBusy()`. E `mapBusy` é

```ts
mapBusy: () => options.map.isMoving() || !options.map.areTilesLoaded();
```

em `apps/editor/src/export/export-service.ts` (duas ocorrências: ~109 no caminho
PNG, ~213 no MP4).

Nenhuma das três vê o carregamento do GLB. Em
`apps/editor/src/panels/viewport/scene3d-layer.ts`, `syncModels` resolve o
template de forma assíncrona e só **depois** do `GLTFLoader.parse` a instância
entra na cena e a camada chama `map.triggerRepaint()`. Essa repintura é do
**mapa**, não do overlay Pixi: não mexe em `renderCountRef`, que é o que o `probe`
do `SceneOverlay` devolve ao export. E `areTilesLoaded()` fala de tiles, não de
assets do documento.

**Consequência:** export iniciado antes de o GLB terminar de parsear escreve os
primeiros frames **sem a aeronave**. Na segunda execução o template já está no
cache da camada, resolve na hora, e os mesmos frames saem **com** ela. Dois
arquivos diferentes para o mesmo projeto.

Não apareceu nos verificadores porque
`grep -c "model3d\|route3d\|scene3d" tools/verify-phase8*.mjs` devolve **0 nos
dois**: o determinismo foi provado numa cena sem nenhum conteúdo 3D. A camada 3D
é capturada — `frame-composer.ts` inclui `.maplibregl-canvas` e o ADR-013 diz que
a ordem de composição é contrato — mas **capturar não é esperar**.

O sinal que falta já existe: `window.__theatrumScene3d.status()` expõe `pending`
(nós pedidos menos instâncias carregadas) e `lastError`. Duas ressalvas antes de
usar direto:

- `__theatrumScene3d` só é publicado sob `import.meta.env.DEV`. Em build de
  produção o export perderia a guarda **em silêncio**. O certo é a camada expor
  `pending` por caminho não-DEV, ou o `SceneOverlay` incluir isso no `probe` que
  já passa para o export.
- `pending` não cobre GLB que falhou: com `lastError` preenchido, `pending` fica
  preso em > 0 para sempre e o export trava no timeout. Erro tem de contar como
  "resolvido, sem modelo".

**Teste que prova:** monte o cenário de `tools/demo-f18.mjs`, recarregue o
renderer para esvaziar o cache de templates, dispare o export imediatamente e
compare o SHA-256 dos primeiros frames com uma segunda execução. Hoje a
expectativa é que divirjam. Depois da correção, estenda `verify-phase8.mjs` para
cobrir cena **com** `model3d` e `route3d` — a lacuna existiu porque o verificador
não olhava para lá.

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
