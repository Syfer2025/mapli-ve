# Sondas de bancada

Medições que sustentam um ADR e que **precisam poder ser repetidas** por quem
continuar — em outra máquina, com outra GPU, ou depois de o Chromium mudar de
versão.

A convenção antiga era deixar sonda em `scratchpad/`, que é `gitignored`. Isso
funciona enquanto a sonda é descartável, e falha quando o ADR **cita** o número
dela: o [ADR-011](../../docs/adr/ADR-011-roads-spatial-join.md) referencia um
`scratchpad/measure-roads.ts` que não existe em clone nenhum, e o número dele não
dá para reproduzir. As sondas que viraram prova de decisão moram aqui.

Todas exigem o Electron de desenvolvimento rodando, com CDP na porta 9222 — o
mesmo requisito dos `verify-phase*.mjs`, e pelo mesmo motivo: defeito de render,
de shader e de composição não aparece em teste unitário.

| Sonda                            | Pergunta que ela responde                                                          | ADR                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `probe-export-resolution-6a.mjs` | Em que tamanho a repintura do MapLibre deixa de ser bit-exata?                     | [023](../../docs/adr/ADR-023-no-msaa-on-composed-surfaces.md)       |
| `probe-studio-msaa.mjs`          | O palco 3D e o overlay Pixi sofrem do mesmo?                                       | [023](../../docs/adr/ADR-023-no-msaa-on-composed-surfaces.md)       |
| `probe-msaa-cost.mjs`            | Quanto custa, em pixel, desligar o MSAA?                                           | [023](../../docs/adr/ADR-023-no-msaa-on-composed-surfaces.md)       |
| `probe-export-real-pump.mjs`     | O export **de verdade** dá arquivo byte-idêntico no tamanho da composição e em 4K? | [022](../../docs/adr/ADR-022-export-resolution-from-composition.md) |

`cdp.mjs` é o cliente compartilhado, extraído dos verificadores.

## Como rodar

```bash
node tools/probes/probe-export-real-pump.mjs
```

O `probe-msaa-cost.mjs` recebe um rótulo e compara duas configurações — rode uma
vez com `antialias: true` no `MapViewport.tsx`, recarregue o renderer, e outra com
`false`:

```bash
node tools/probes/probe-msaa-cost.mjs com-msaa
```

## Três coisas que estas sondas ensinaram, e valem para a próxima

- **Não crie vários contextos WebGL2 de 4K numa sonda.** Derruba o renderer do
  Electron: o teto de dezesseis contextos do
  [ADR-012](../../docs/adr/ADR-012-studio-own-canvas.md) conta os da bancada junto
  com os do aplicativo. Leia `MAX_TEXTURE_SIZE` de um contexto que já existe.
- **Espera fixa mede o frame velho.** A primeira leitura de "4K diverge" veio de
  `wait(400)`, que é a armadilha do critério 13 do `verify:phase7e3` outra vez.
  Espere quietude do contador de repinturas, como o pump do export faz.
- **Captura chapada é medição inválida, não resultado.** Logo depois de recarregar,
  o `probe-msaa-cost` relatou "energia de borda 0, uma cor no recorte" — o mapa
  ainda não tinha pintado. Toda sonda que lê pixel precisa de guarda de conteúdo.
