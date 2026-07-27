# ADR-010 — Malha geográfica pré-compilada em Int32

**Status:** aceito · **Data:** 2026-07-27 · **Revisar em:** improvável

## Contexto

Decidido em [ADR-009](ADR-009-geo-layers-overlay.md) que contorno de país é
desenhado no overlay, projetado por frame, resta escolher **em que forma** essa
geometria chega ao runtime.

O GeoJSON do Natural Earth é formato de troca, não de execução. Cada feição
carrega noventa e tantos campos de propriedade — `FCLASS_TLC`, `WOE_NOTE`,
`FIPS_10` — e cada coordenada é texto decimal. Abrir o arquivo de países 10m
custa 82 ms de `JSON.parse`, e o resultado são milhares de arrays pequenos
espalhados no heap.

Restrições que valem: o app é offline e nunca baixa nada em runtime; a geometria
é lida a cada frame; e nada pode introduzir imprecisão visível na posição de uma
fronteira.

## Medição

Arquivo de países 10m, 258 feições, 548.471 coordenadas:

|       | GeoJSON              | binário + índice           |
| ----- | -------------------- | -------------------------- |
| Disco | 12,7 MB              | **4,3 MB** (−66 %)         |
| Abrir | 82 ms (`JSON.parse`) | **2 ms** (39× mais rápido) |

Erro máximo de posição nas 548.471 coordenadas, por tipo numérico de 4 bytes:

| Tipo        | Erro máximo              |
| ----------- | ------------------------ |
| Float32     | 7,6 × 10⁻⁶ ° ≈ **85 cm** |
| Int32 × 1e7 | 0 ° — **exato**          |

O Int32 é exato porque a fonte tem no máximo sete casas decimais, e 180 × 10⁷ =
1,80 × 10⁹ cabe folgado no teto de 2,147 × 10⁹.

## Alternativas

### A. GeoJSON cru, lido em runtime

✅ Zero passos de build; o arquivo baixado é o arquivo usado.
✅ Inspecionável com qualquer editor de texto.
❌ 82 ms de parse na abertura do projeto, contra um orçamento de 800 ms para
abrir 50 MB — 10 % do orçamento gasto num arquivo de dados estáticos.
❌ Três vezes o disco necessário.
❌ Coordenadas como `number` em arrays aninhados: pressão de GC e nenhuma
localidade de cache na projeção por frame.

### B. Binário Float32

✅ Mesmo tamanho do Int32 e conversão zero — o valor já sai pronto para a
aritmética de mercator.
❌ Erra 85 cm, o que dá ~1,4 pixel em z18. Fronteira que treme com o zoom é
defeito visível, e o critério 1 do bloco fala em contorno correto **em qualquer
zoom**.

### C. Binário Int32 escalado por 1e7

✅ Exato para esta fonte: erro medido de 0 cm.
✅ Mesmos 4 bytes por componente do Float32.
✅ Um único `ArrayBuffer` com todos os anéis concatenados; cada feição é fatia
contígua.
❌ Uma multiplicação por 1e-7 por coordenada no runtime.
❌ Não é legível a olho; precisa do índice para fazer sentido.

## Decisão

**Binário Int32 escalado por 1e7**, com índice JSON separado.

O custo da multiplicação é irrelevante ao lado da matemática de mercator que vem
logo em seguida na mesma iteração. A precisão exata, não.

O formato é um índice JSON pequeno mais **um** `ArrayBuffer` com todos os anéis
concatenados. O índice guarda deslocamento e comprimento de cada anel, então uma
feição é uma fatia contígua — nada de milhares de arrays pequenos para o coletor
de lixo perseguir a cada frame. Só os campos que a ferramenta usa sobrevivem à
compilação; o resto do Natural Earth é descartado.

## Consequências

- Entra um passo de bootstrap: `tools/build-geo.ts`. O `tools/fetch-data.ts`
  segue responsável por baixar e **fixar por hash** a origem; a compilação é
  determinística a partir dela.
- O binário é **derivado**. Não entra no repositório nem no `.theatrum` de
  projeto, e é regenerável a partir da origem fixada. O `.gitignore` o exclui
  junto com o resto de `data/`.
- A simplificação por zoom que o [ADR-009](ADR-009-geo-layers-overlay.md) exige
  cabe aqui: o binário guarda níveis prontos e o runtime só escolhe. Isso mantém
  o custo por frame em projeção pura, sem alocação nem Douglas–Peucker ao vivo.
- Trocar a versão do Natural Earth exige recompilar. O índice carrega `versao`
  para que um binário velho ao lado de um índice novo falhe alto em vez de
  desenhar geometria errada.
- Perde-se a inspeção a olho do arquivo de dados. Mitigação: o índice JSON fica
  legível e nomeia cada feição, e o `--verify` do `fetch-data` continua provando
  a integridade da origem.

## Quando revisar

Se uma fonte futura precisar de mais de sete casas decimais — o que exigiria
precisão sub-centimétrica em coordenada geográfica, coisa que mapa geopolítico
não usa. Ou se o índice JSON passar de alguns megabytes, ponto em que ele
próprio viraria candidato a binário.
