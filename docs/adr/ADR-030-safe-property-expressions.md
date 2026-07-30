# ADR-030 — Expressões de propriedade usam uma linguagem interpretada e fechada

**Status:** aceito — implementado · **Data:** 2026-07-30 · **Revisar em:** quando
uma expressão precisar ler outra propriedade, ou quando o runtime JavaScript
suportado mudar

## Contexto

O formato de projeto reserva `expression: string | null` em toda propriedade
animável desde o começo, mas até a Fase 11 o avaliador ignorava o texto. A
expressão precisa ser útil para movimentos procedurais e, ao mesmo tempo,
preservar três invariantes do motor:

1. `evaluate(document, composition, frame)` continua puro e independente da
   ordem em que os frames são pedidos;
2. abrir um projeto não executa JavaScript fornecido pelo projeto;
3. uma expressão defeituosa não derruba preview nem export e não altera o texto
   persistido.

O documento é uma fronteira não confiável. Mesmo num produto local, um arquivo
recebido de outra pessoa não pode acessar DOM, Electron, rede, disco, protótipos
ou globais do processo. Também não pode criar trabalho ilimitado por laços,
recursão ou alocações sem teto.

## Alternativas

### A. JavaScript com `eval`/`new Function` dentro do renderer

✅ Sintaxe conhecida e ecossistema grande.
✅ Funções matemáticas e vetores exigiriam pouco código próprio.
❌ Dá ao projeto acesso ao ambiente do renderer, inclusive APIs que não fazem
parte do contrato de animação.
❌ Bloquear nomes por texto não bloqueia protótipos, construtores ou novas APIs.
❌ Laços e alocações podem travar o frame; CSP e empacotamento também passam a
ter exceções permanentes.

### B. JavaScript em Worker ou processo isolado

✅ Reduz o impacto de uma expressão que trava e separa parte do ambiente.
✅ Permite terminar o executor por prazo.
❌ Continua executando uma linguagem muito maior que o necessário; isolamento
correto vira uma fronteira de segurança própria.
❌ IPC por propriedade e por frame contraria o orçamento do avaliador.
❌ Ordem de respostas, timeout e reinício introduzem estado temporal onde hoje
existe uma função pura.

### C. Linguagem pequena com lexer, parser e interpretador próprios

✅ A AST só consegue representar operações autorizadas; acesso ao host não
existe para ser contornado.
✅ Sem laços, atribuições, propriedades de objeto ou chamadas dinâmicas, o custo
tem teto proporcional ao tamanho da expressão.
✅ `frame` e `value` tornam a avaliação explícita e reproduzível.
❌ É uma sintaxe nova e deliberadamente menor que JavaScript.
❌ Cada função adicionada passa a ser parte durável do formato de projeto.

### D. Manter o campo reservado e exigir keyframes/behaviors

✅ Zero superfície nova de linguagem e segurança.
❌ Movimentos procedurais simples exigem centenas de keyframes ou um novo
behavior específico.
❌ Não entrega o escopo já prometido pela Fase 11.

## Decisão

Escolhemos a alternativa C: **uma linguagem de expressão interpretada, fechada e
sem execução de JavaScript**.

A expressão é aplicada depois do valor estático/keyframed. O contexto contém
somente:

- `value`: resultado normal da propriedade no frame;
- `frame`: frame local, inclusive fracionário no motion blur;
- `pi` e `e`: constantes matemáticas.

A gramática aceita números finitos, booleanos, strings, vetores, índice de vetor,
parênteses, condicionais `?:`, operadores aritméticos/comparativos/lógicos e uma
lista fechada de funções:

```text
abs acos asin atan atan2 ceil clamp cos deg exp floor length
lerp log max min pow rad round sign sin smoothstep sqrt tan vec
```

Operações numéricas fazem broadcast de escalar sobre vetor. O resultado só é
aceito se mantiver recursivamente o tipo e o formato do valor base; uma
propriedade `Vec2`, por exemplo, não pode virar número nem vetor de três
componentes.

Não existem acesso por ponto, objetos, atribuição, laço, recursão, função
anônima, função dinâmica, relógio, aleatoriedade, I/O ou referência a outra
propriedade. A implementação impõe limites de caracteres, tokens, nós da AST,
passos e tamanho do resultado. Programas compilados são imutáveis e ficam num
cache FIFO limitado; o cache não participa do resultado.

Falha de sintaxe, tipo, domínio matemático, índice ou limite segue política
**fail-soft**: o avaliador usa o valor estático/keyframed e anexa um diagnóstico
estruturado, com código, intervalo do texto e caminho da propriedade. O
`EvaluatedScene` reúne esses diagnósticos para preview/export. `expression: null`
contorna parser, cache e envelope de diagnóstico e preserva o caminho anterior.

As funções transcendentais usam `Math` do V8 empacotado pelo Electron suportado.
O determinismo garantido é para esse runtime fixado, igual ao restante do
renderer; trocar de engine é gatilho explícito de revisão.

## Consequências

- Arquivos de projeto não conseguem executar JavaScript nem alcançar o host por
  meio de uma expressão.
- Scrub, export, subframes e avaliação fora de ordem produzem o mesmo valor para
  o mesmo documento/frame no runtime suportado.
- Expressões podem modular propriedades escalares e vetoriais sem duplicar
  keyframes.
- Erros ficam visíveis e localizáveis sem apagar a expressão nem invalidar o
  frame.
- O subconjunto não cobre referências entre propriedades, ruído ou aleatoriedade
  semeada. Esses recursos precisam de decisões próprias sobre dependências,
  ciclos e identidade da propriedade.
- O fail-soft pode esconder visualmente um erro se a interface ignorar
  `scene.diagnostics`; consumidores que apresentam preview devem exibir esse
  canal.
- A linguagem passa a ser compatibilidade de formato. Remover ou mudar semântica
  de operador/função exige migração de schema, não apenas refatoração.

## Quando revisar

1. Quando uma expressão precisar ler outra propriedade. Antes de adicionar a
   referência, definir grafo de dependências, detecção de ciclo e ordem estável.
2. Quando ruído/aleatoriedade forem necessários. A revisão deve definir seed e
   identidade estável; nunca expor fonte aleatória implícita.
3. Se o Electron/V8 suportado mudar ou se a mesma saída precisar ser
   bit-idêntica entre engines JavaScript diferentes. Nesse caso, medir as funções
   transcendentais e, se necessário, substituí-las por aproximações nossas.
4. Se a soma de compilação e avaliação ultrapassar 1 ms para 1.000 propriedades
   no benchmark de Fase 11. O primeiro passo é medir cache e AST, não ampliar a
   linguagem nem mover execução para IPC.

## Nota de implementação

- Parser e interpretador: `packages/animation/src/expression.ts`.
- Aplicação pós-keyframe e validação de formato:
  `packages/animation/src/property.ts`.
- Coleta por caminho em câmera, transforms, props e efeitos:
  `packages/animation/src/evaluate.ts`.
- Casos de segurança, determinismo, vetores, recuperação e integração:
  `expression.test.ts`, `property.test.ts` e `evaluate.test.ts`.
