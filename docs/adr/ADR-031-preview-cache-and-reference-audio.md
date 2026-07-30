# ADR-031 — Preview e áudio de referência são artefatos derivados determinísticos

**Status:** aceito · **Data:** 2026-07-30 · **Revisar em:** leitura sustentada do
cache abaixo de 60 fps, ou necessidade de editar/mixar áudio

## Contexto

A Fase 11 pede dois recursos que aceleram autoria sem alterar o resultado final:

- cache de frames de preview em RAM e disco, com pré-render de faixas;
- uma trilha de áudio usada somente como referência temporal, com waveform na
  precisão de um frame.

Os dois são dados derivados. Um frame pode ser renderizado novamente a partir do
documento; uma waveform pode ser analisada novamente a partir do PCM importado.
Logo, corrupção ou ausência deve causar descarte e recomputação, nunca corromper o
projeto.

O cache precisa ter limite físico. Sem orçamento por bytes, guardar frames 4K
consome memória e disco até degradar uma sessão longa. A ordem de descarte também
precisa ser reproduzível em testes.

Áudio tem outra fonte comum de deriva: converter frame em amostra acumulando
incrementos arredondados. Em taxas como 29,97 fps e 44,1 kHz, o erro cresce ao
longo da narração. Além disso, serializar bytes nativos de `Float32Array` torna o
checksum dependente de endian e de representações não canônicas.

## Alternativas

### A. Cache sem orçamento e waveform por blocos de tamanho fixo

✅ Implementação mínima.

❌ Uso de RAM/disco cresce sem limite.

❌ Blocos fixos não coincidem com fronteiras de frame; o cursor visual deriva da
narração.

### B. LRU por quantidade de itens e waveform por tempo acumulado

✅ Limita o número de entradas e parece simples.

❌ Um PNG de 4K e uma miniatura contam como uma entrada cada, embora tenham
custos muito diferentes.

❌ Somar `samplesPerFrame` em ponto flutuante acumula erro e pode pular ou repetir
amostras.

### C. LRU por bytes, integridade por CRC32 e análise PCM diretamente nas

fronteiras de cada frame

✅ O orçamento corresponde ao recurso físico consumido.

✅ RAM e disco usam a mesma semântica de chave, cópia defensiva, LRU e checksum.

✅ Corrupção vira miss e remoção; nunca entrega pixels silenciosamente alterados.

✅ Cada fronteira é calculada diretamente por
`round(frameRelativo × sampleRate / fps)`, sem acumular erro.

✅ PCM canônico em float32 little-endian produz o mesmo checksum em qualquer
plataforma suportada.

❌ CRC32 detecta corrupção acidental, mas não é hash criptográfico. O cache é
derivado e local, portanto não existe fronteira de confiança que exija resistência
a ataque.

❌ Uma amostra de waveform por frame não preserva detalhe suficiente para zoom
subframe.

### D. Banco de dados e compressor nativo/WASM desde já

✅ Índices, transações e compressão podem escalar melhor.

❌ Acrescenta formato, migração e dependência antes de haver medição que justifique
isso. O ADR-007 reserva WASM exatamente para o caso em que TypeScript não sustente
60 fps.

## Decisão

**Alternativa C.**

O núcleo expõe:

1. cache RAM síncrono, com cópia defensiva, orçamento em bytes, LRU e CRC32;
2. adaptador de cache em disco assíncrono sobre uma porta estreita de storage. A
   porta persiste bytes e metadados; o adaptador decide checksum, orçamento,
   acesso e evicção;
3. chave de preview canônica contendo composição, revisão/fingerprint, frame,
   resolução e escala;
4. modelo de áudio de referência sem reprodução ou mixagem;
5. análise determinística de PCM intercalado, com min, max, pico e RMS para cada
   frame da composição;
6. conversão frame↔amostras sempre pela fórmula absoluta, nunca por acumulador.

O checksum CRC32 do PCM é calculado sobre float32 little-endian canônico. PCM não
finito ou fora de `[-1, 1]` é rejeitado em vez de ser corrigido silenciosamente.

### Integração no editor

- A composição persiste somente `{ assetSrc, startFrame }`, de forma opcional e
  compatível com projetos antigos. O Command Bus torna a troca desfeita/refeita
  normalmente e a validação recusa referência órfã.
- WAV, MP3, OGG e M4A entram no container pela Biblioteca. O Chromium decodifica
  os bytes incorporados para PCM e o engine público produz a waveform por frame.
  Nenhum nó é conectado a uma saída de áudio.
- Frames RGBA que o compositor já produziu e que o destino do export aceitou
  aquecem um cache RAM de 96 MiB. A Timeline mostra em verde somente esses frames
  reais para o fingerprint atual; evicção remove também o indicador.

O adapter de disco e o `FilePreviewDiskStorage` permanecem deliberadamente sem
ligação com o renderer. Faltam duas portas para uma integração honesta:

1. IPC renderer→shell para `list/read/write/touch/remove`, com cotas e diretório
   de usuário definidos na fronteira privilegiada;
2. uma porta de captura/readback do **preview interativo** que informe pixels
   compostos estáveis e a invalidação da revisão. Hoje essa fronteira existe no
   pump de export, não no viewport durante scrub.

Ligar apenas a escrita em disco criaria arquivos que nenhum caminho de preview
consegue consultar; ligar apenas um indicador ao playhead alegaria cache sem
pixels. Por isso a integração atual é RAM sobre frames comprovadamente
renderizados no export. O cache persistente fica bloqueado exatamente por essas
duas portas, não pelo algoritmo LRU já implementado.

## Consequências

- Cache corrompido ou incompleto se comporta como miss e é removido.
- Alterar o orçamento pode evictar imediatamente as entradas menos recentes.
- Empates de antiguidade são resolvidos pela chave, mantendo testes e limpeza de
  inicialização determinísticos.
- A API de disco pode receber um adapter Node/Electron, IndexedDB ou fixture em
  memória sem levar I/O para o domínio.
- O primeiro acesso ao cache de disco faz inventário e aplica o orçamento,
  inclusive sobre resíduos de sessão anterior.
- A waveform não entra no documento como milhares de números. O projeto guarda a
  referência ao áudio; a análise é cache regenerável.
- Um frame RGBA maior que o orçamento RAM (por exemplo, um frame 8K) não é
  guardado; o export continua normalmente e a Timeline não o marca como cacheado.
- Não há reprodução, scrub sonoro, ganho, fades, mixagem ou áudio no export. Esses
  itens continuam fora do escopo declarado em `00-VISION`.
- Zoom subframe da waveform poderá pedir uma segunda pirâmide de resolução no
  futuro; o nível por frame continua sendo a base canônica.

## Quando revisar

Revisar se o benchmark de uma trilha real não sustentar 60 leituras de frame por
segundo no cache de disco. Nesse caso, medir compressão em TypeScript e depois
WASM conforme o ADR-007. Revisar também se o produto passar a editar, mixar ou
exportar áudio, pois áudio deixará de ser apenas artefato de referência.
