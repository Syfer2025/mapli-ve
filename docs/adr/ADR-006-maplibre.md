# ADR-006 — MapLibre GL JS + PMTiles

**Status:** aceito · **Data:** 2026-07-26 · **Revisar:** improvável

## Contexto

O mapa é o elemento central. Requisitos:

- Países, estados, cidades, rodovias, ferrovias, rios, lagos, oceanos, relevo,
  fronteiras, aeroportos, portos
- Zoom profundo, pan suave, rotação (bearing), inclinação (pitch)
- Troca de estilo em runtime
- **Offline, sem servidor**
- Sem licença, sem chave de API, sem limite de requisição
- Projeção geo→tela acessível programaticamente (o overlay depende dela)

## Decisão

**MapLibre GL JS v5** para renderização.
**PMTiles** como formato de tiles offline.
**Natural Earth + OpenMapTiles** como dados.

## Alternativas de renderizador

### Mapbox GL JS

- ✅ Tecnicamente excelente, ligeiramente à frente em recursos
- ❌ Licença proprietária desde a v2, exige token e conta
- ❌ Termos de uso incompatíveis com render em lote offline
- ❌ Contradiz o requisito de zero dependência de serviço

### Leaflet / OpenLayers

- ❌ Raster-first. Sem pitch, sem bearing, sem 3D.
- ❌ Sem acesso a GPU para o overlay

### Google Maps / Earth Studio

- ❌ Termos proibem o uso pretendido; requer rede; sem controle de dados

### deck.gl sobre MapLibre

- ✅ Excelente para visualização de dados em volume
- ❌ Resolve um problema que não temos (milhões de pontos) e não resolve o que
  temos (sprites animados, texto, efeitos). Pixi é mais adequado.
- ❌ Poderia entrar depois como camada adicional, se surgir necessidade de
  visualização massiva de dados.

## Alternativas de tiles offline

### Servidor local de MBTiles (tileserver-gl)

- ❌ Um processo extra para gerenciar, portas, ciclo de vida, falha silenciosa

### Tiles em pasta (`z/x/y.pbf`)

- ❌ Milhões de arquivos pequenos. Windows fica lento; backup fica impraticável.

### **PMTiles** (escolhido)

- ✅ Arquivo único, com índice interno, acesso por range request
- ✅ `pmtiles://` funciona no MapLibre com um protocol handler
- ✅ Zero processo, zero porta, zero configuração
- ✅ Cópia e backup triviais
- ✅ Mantido e adotado (Protomaps)

O protocolo é dividido na fronteira correta:

```ts
// renderer: interpreta o índice PMTiles e pede somente os ranges necessários
maplibregl.addProtocol("pmtiles", new Protocol().tile);

// main: serve somente arquivos permitidos sob data/, com Range e sem expor fs
protocol.handle("theatrum-data", handleVerifiedLocalData);
```

Uma source usa
`pmtiles://theatrum-data://local/basemap/natural-earth-world.pmtiles`. Assim o
pacote `pmtiles` continua responsável pelo formato do arquivo, enquanto o main
do Electron concentra filesystem, traversal/junction checks, MIME, `206` e
`416`. O renderer sandboxed nunca recebe caminho de disco ou API de Node.

## Dados

| Fonte                         | Conteúdo                                                           | Licença         |
| ----------------------------- | ------------------------------------------------------------------ | --------------- |
| Natural Earth                 | fronteiras, costas, rios, lagos, batimetria — escalas 10m/50m/110m | domínio público |
| OpenMapTiles (extrato OSM)    | rodovias, ferrovias, cidades, POI, aeroportos, portos              | ODbL            |
| Terrarium / AWS Terrain Tiles | DEM para relevo 3D                                                 | domínio público |

Natural Earth é ideal para o domínio histórico: generalizado nas escalas certas,
sem excesso de detalhe moderno, e em domínio público — inclusive para fronteiras
históricas, que virão de GeoJSON próprio.

`tools/fetch-data.ts` baixa e verifica hash. É o único momento do projeto que
toca a rede, e é explícito e único.

## Consequências

Positivas:

- Offline real, sem processo auxiliar.
- Pitch, bearing e terreno 3D nativos.
- `map.project()` / `map.unproject()` disponíveis → base do `ProjectorPort`.
- Estilos são JSON — editáveis, versionáveis, geráveis.
- Projeção globo disponível na v5, para planos gerais.

Negativas e mitigações:

| Custo                                                                   | Mitigação                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Renderização assíncrona → export precisa de settle                      | [06 § 4](../06-RENDER-PIPELINE.md#4-determinismo-e-settle-do-mapa)                      |
| `fadeDuration` de rótulo depende de tempo real                          | forçar 0 no render (regra D5)                                                           |
| Colocação de rótulo depende do viewport → render em tiles pode duplicar | usar `pixelRatio` em vez de tiles ([06 § 6](../06-RENDER-PIPELINE.md#6-alta-resolução)) |
| Contexto GL separado do overlay                                         | [ADR-002](ADR-002-compositor.md)                                                        |
| Dados detalhados podem ocupar centenas de GB                            | bootstrap mundial pequeno + extratos regionais baixados por script                      |

## Fronteiras históricas

Nenhuma fonte pronta cobre bem fronteiras históricas. Serão GeoJSON próprio,
carregado como `geoData` do projeto, com um campo de intervalo de anos. A
biblioteca inicial (Fase 10) trará conjuntos para 1914, 1939, 1941, 1945 e 1991.

Isso é conteúdo, não arquitetura — e é exatamente por isso que `geoData` é
genérico no modelo de dados: qualquer GeoJSON entra sem código novo.
