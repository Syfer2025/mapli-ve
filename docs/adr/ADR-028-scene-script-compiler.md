# ADR-028 — Scene Script v1 compila por uma fronteira pura e transacional

- **Estado:** aceito
- **Data:** 2026-07-30
- **Escopo:** `packages/scripting`, importação no editor e documentação de autoria

## Contexto

`project.json` é o formato completo do editor, mas não é uma boa superfície de
autoria para uma LLM. O formato público `theatrum-scene` v1 já está definido em
`docs/05-SCENE-SCRIPT.md` e em `@theatrum/schema`; faltava a fronteira que o
transforma em um documento editável sem adivinhar lugares, tempos ou referências.

Há três riscos que a implementação precisa tornar impossíveis:

1. aceitar um campo desconhecido silenciosamente;
2. resolver uma cidade ambígua escolhendo “a mais provável”;
3. aplicar metade de uma cena quando a outra metade contém erro.

## Decisão

`compileScene()` é assíncrono apenas pela porta de gazetteer. Todo o restante é
puro e determinístico. A função recebe JSON ou um valor já decodificado e devolve
todos os diagnósticos encontrados, cada um com:

- severidade e código estável;
- JSON Pointer RFC 6901;
- mensagem e dica voltadas tanto a pessoas quanto a modelos;
- `didYouMean` quando existe uma correção plausível.

O compilador executa quatro passos sem efeitos colaterais:

1. validação estrutural e do registry de verbos;
2. resolução de lugares e rejeição explícita de ambiguidade;
3. resolução do grafo de tempos relativos;
4. validação semântica e emissão de um `ProjectDocument`.

O registry é a fonte de verdade da referência de verbos. O gerador
`tools/gen-scene-script-authoring.ts` produz `LLM_AUTHORING.md` a partir dele;
alterar o registry e esquecer a documentação passa a ser detectável em teste.

Uma compilação com qualquer erro não devolve documento. Warnings não impedem a
emissão. A ordem dos dados de entrada não altera IDs nem frames: a semente vem do
conteúdo canônico do script.

No editor, o documento compilado entra pelo comando
`project.replace-document`. A substituição completa é uma única entrada no
histórico e um único `Ctrl+Z` restaura exatamente o documento anterior. O painel
de importação só despacha esse comando quando a compilação não contém erros.

## Contrato do gazetteer

O compilador depende de `GazetteerPort`, não de arquivos ou rede. Uma string que
coincide com uma chave em `places` usa aquela declaração. Outras strings passam
pela porta:

- um resultado: resolvido;
- nenhum resultado: erro `place-not-found`;
- mais de um melhor resultado: erro `place-ambiguous` com candidatos.

Coordenadas explícitas nunca consultam o gazetteer.

## Consequências

- A importação é atômica e desfazível.
- Um host pode fornecer Natural Earth completo, um gazetteer de teste ou outra
  base offline sem alterar o compilador.
- O documento emitido mantém uma representação de cada entrada da timeline em
  nós/ações editáveis; verbos ainda sem renderer especializado continuam
  preservados, mas recebem warning explícito.
- A exportação inversa é parcial por definição: ela recupera metadados, mapa,
  paths, unidades e entradas que carregam metadados Scene Script; conteúdo
  arbitrário criado manualmente continua no documento e é relatado como omitido.
