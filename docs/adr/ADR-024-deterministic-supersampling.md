# ADR-024 — Suavização por supersampling, no nosso código

**Status:** proposto · **Data:** 2026-07-29 · **Revisar em:** quando o custo por
megapixel passar de 30 ms, ou quando alguém pedir supersampling no preview

> Executa a alternativa D do [ADR-023](ADR-023-no-msaa-on-composed-surfaces.md),
> que aquela página nomeou como "a mitigação honesta quando alguém reclamar". O
> dono reclamou.

## Contexto

Duas frases do dono, no mesmo dia, sobre a mesma coisa:

> "to olhando para um avião agora e ta faltando anti aliasing, ta cheio de
> serrilhado, não to gostando disso"

> "os contornos dos mapas estão muito grosseiros"

Isso dispara o **gatilho de revisão 1 do ADR-023**, que está escrito lá em voz
alta: _"quando o dono apontar borda visivelmente pior em captura específica. Aí a
alternativa D entra com medição de custo em 4K."_

O que **não** serve como resposta, e por quê:

- **Religar o MSAA.** Foi medido em duas máquinas. Na RTX 3060 Ti, repintar o
  mesmo estado acima de ~2 MP deixa de devolver os mesmos bytes; na RTX 4090 o
  defeito não reproduz até 8,29 MP. A leitura correta disso não é "então dá para
  ligar aqui" — é que **a bit-exatidão do resolve depende da placa**, e um projeto
  cuja tese é determinismo não pode entregar arquivo que muda com o hardware de
  quem exporta.
- **Nada.** O serrilhado é real e o dono vai olhar para ele todo dia.

O contexto novo, e é o que torna esta decisão barata agora: a ligação do
[ADR-022](ADR-022-export-resolution-from-composition.md) construiu a máquina de
conduzir as três superfícies a um tamanho escolhido, com `pixelRatio` próprio e
retorno em `finally`. Supersampling é literalmente "renderizar maior e reduzir" —
a metade "maior" já existe e está provada byte-idêntica.

## Medição que sustenta o custo

Do ADR-022, nesta base, canvas 2D reaproveitado:

| Tamanho     | MP   | `getImageData` |
| ----------- | ---- | -------------- |
| 1920 × 1080 | 2,07 | 9,6 ms         |
| 3840 × 2160 | 8,29 | 27,8 ms        |

Cerca de **3,5 ms por megapixel**, contra o orçamento de **250 ms por frame de
export 4K** de [06-RENDER-PIPELINE § 10](../06-RENDER-PIPELINE.md#10-orçamentos-de-performance).
Um 1080p supersamplado 2× lê 8,29 MP e reduz para 2,07: **~29 ms de leitura mais
a redução**, dentro do orçamento com folga larga.

E o teto do MapLibre continua mandando: `maxCanvasSize` é `[4096, 4096]` na
construção, então 1080p×2 (3840×2160) passa e 4K×2 (7680×4320) **não**. O fator
tem de ser recusado quando não couber, pelo mesmo `planExportResolution` que já
recusa escala alta demais — recusar em vez de cortar em silêncio é a regra desta
base.

## Alternativas

### A. Supersampling no fator de escala, reduzido por filtro nosso

Renderizar a `fator ×` a resolução de saída e reduzir com um kernel conhecido
(box para fator inteiro, Lanczos quando o fator não for inteiro).

✅ **Determinístico por construção**: a redução é aritmética nossa, não resolve de
driver. É o que separa esta alternativa do MSAA.
✅ Qualidade melhor que MSAA 4×, e **uniforme entre as três superfícies** — o MSAA
só suavizava arestas de geometria, e não fazia nada pelo traço fino do MapLibre
nem pelo texto do Pixi.
✅ Reaproveita a transação do ADR-022 inteira: já sabemos conduzir e devolver.
✅ Melhora o **arquivo**, que é onde o dono entrega o trabalho.
❌ Custo linear na área: fator 2 são 4× os pixels lidos, ~29 ms por frame em 1080p.
❌ **Não melhora o preview**, e metade da reclamação do dono é sobre o preview.
❌ Teto de 4096 px limita o fator: 1080p aceita 2×, 4K não aceita nenhum sem mexer
na construção do mapa.

### B. Supersampling também no preview

Manter o preview num backing store maior que o painel e deixar o navegador reduzir.

✅ Resolve a metade da reclamação que a alternativa A não toca.
✅ É uma linha: `pixelRatio` do preview passa de `devicePixelRatio` para `× fator`.
❌ Paga o custo **todo frame**, não só no export, e num painel de 2032×800 o fator
2 são 6,5 MP por frame de preview.
❌ A redução passa a ser do compositor do Chromium, e não nossa — no preview isso é
aceitável (ninguém hasheia o preview), mas cria duas suavizações diferentes entre
preview e arquivo, que é exatamente o que
[06-RENDER-PIPELINE § 1](../06-RENDER-PIPELINE.md#1-duas-execuções-um-pipeline)
pede para evitar.

### C. Antialias analítico por primitiva

Traço com borda suavizada no shader, como o MapLibre já faz.

✅ Custo quase zero.
❌ Só alcança o que passa pelos nossos shaders. O modelo 3D do palco — a
reclamação literal do dono — não passa.
❌ É trabalho grande espalhado por várias primitivas.

### D. Voltar ao MSAA e limitar o export a 2 MP

❌ Mata o ADR-022 e o ADR-023 juntos, e já foi recusado nos dois.

## Decisão

**Proposta: alternativa A para o arquivo, e alternativa B atrás de um controle
explícito para o preview.**

O fator de supersampling é do **job**, como a escala — preferência de saída, não
conteúdo — e entra no mesmo `planExportResolution`, que passa a recusar quando
`saída × fator` estoura o teto de 4096.

No preview, o fator é uma **preferência de máquina**, desligada por padrão e ligada
por quem tem GPU sobrando. O dono roda numa RTX 4090 e disse, com todas as letras,
que quer priorizar qualidade gráfica: nesta máquina o custo não é o gargalo. Mas
ele não pode ser padrão, porque a mesma decisão numa máquina modesta transforma o
editor em apresentação de slides.

## Consequências

- **Preview e arquivo deixam de ter a mesma suavização** quando o fator do preview
  difere do fator do job. É o custo que o 06-RENDER-PIPELINE § 1 pede para não
  pagar de graça, e aqui ele é pago de propósito e com controle visível — não é o
  caso do MSAA, que divergia sem ninguém pedir.
- **O teto de 4096 px vira limite de produto, não detalhe.** Exportar 4K com
  supersampling 2× exige subir `maxCanvasSize` na construção do mapa, e o ADR-022
  já declarou que isso pede medição própria no mapa ao vivo em tela HiDPI.
- **O verificador precisa de critério novo**, e ele não é opcional pela mesma razão
  que o `SAMPLES === 0` não era: supersampling que não repete bit a bit é pior que
  serrilhado, porque quebra o critério 2 da Fase 8. O critério tem de exportar com
  fator e afirmar duas execuções idênticas.
- **Custo declarado**: ~3,5 ms por megapixel lido. Fator 2 em 1080p sai de ~10 ms
  para ~29 ms por frame, mais a redução.

## Quando revisar

1. Se o custo por megapixel passar de 30 ms — o mesmo gatilho do ADR-022.
2. Se alguém quiser fator não-inteiro: o kernel box deixa de servir e a escolha do
   filtro de redução vira decisão própria, com medição de qualidade.
3. Se o teto de `maxCanvasSize` subir: aí 4K com fator passa a caber, e o efeito
   disso no mapa ao vivo tem de ser medido antes.
