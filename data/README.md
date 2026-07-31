# Dados cartográficos offline

Tudo nesta pasta é consumido localmente. O aplicativo não possui fallback de
rede: um arquivo ausente produz um erro explícito no viewport.

## Natural Earth

Os GeoJSON em `natural-earth/` vêm do repositório oficial
`nvkelso/natural-earth-vector`: países, lagos e rios em 1:110m e o gazetteer de
cidades em 1:10m. Natural Earth declarou seus dados vetoriais e raster em
domínio público.

## Basemap PMTiles

`basemap/natural-earth-world.pmtiles` é o artefato PMTiles oficial publicado em
`maplibre/demotiles`, fixado pelo commit e pelo SHA-256 no manifesto. Não há uma
conversão local intermediária.

O tileset cobre zoom 0–6 e contém as source-layers `countries`, `centroids` e
`geolines`. A licença BSD-3-Clause original está em
`licenses/maplibre-demotiles-LICENSE.txt`.

## Mapa detalhado Irã–Hormuz

`basemap/iran-hormuz-20260728-z15.pmtiles` é um recorte da compilação diária
oficial da Protomaps de 2026-07-28. Cobre a caixa `43,22,65,41` até zoom 15:
Irã, Iraque, Golfo Pérsico, Estreito de Hormuz, Omã e arredores. Inclui limites
administrativos, cidades, ruas, edifícios, água, uso do solo e pontos de
interesse derivados do OpenStreetMap.

O arquivo grande é local e não entra no Git. Sua origem, limites, tamanho e
SHA-256 ficam versionados em `basemap/detailed-basemaps.json`; o editor só
publica a opção quando o PMTiles correspondente está realmente presente.

Extração usada:

```powershell
pmtiles extract https://build.protomaps.com/20260728.pmtiles `
  data/basemap/iran-hormuz-20260728-z15.pmtiles `
  --bbox=43,22,65,41 --maxzoom=15
```

O tileset é um Produced Work de OpenStreetMap sob ODbL e recebe atribuição
visível no mapa. O gerador de estilo `@protomaps/basemaps` é BSD-3-Clause; o
desenho cartográfico é CC0.

## Mapa detalhado da Ucrânia

`basemap/ukraine-20260728-z15.pmtiles` cobre a caixa `21.5,44,41.5,53` até
zoom 15. O recorte inclui a Ucrânia inteira e arredores, com limites
administrativos, cidades, ruas, edifícios, água, uso do solo e pontos de
interesse derivados do OpenStreetMap. O arquivo grande é local e não entra no
Git; origem, limites, tamanho e SHA-256 ficam registrados em
`basemap/detailed-basemaps.json`.

`territories/ukraine-political-control-2026-07-30.geojson` acrescenta a leitura
política desse recorte: Ucrânia em amarelo-claro, Rússia em vermelho-claro,
oblasts invadidos com hachura em dois tons de vermelho. Os polígonos de controle
exibidos pelo Liveuamap às 20:16:54 foram unidos e recortados pelo território
internacionalmente reconhecido da Ucrânia; os limites administrativos vêm do
Natural Earth. O mesmo arquivo guarda os pontos das bandeiras da Ucrânia e da
Rússia.

Somente Luhansk, Donetsk, Zaporíjia, Kherson, Crimeia e Sebastopol recebem a
codificação territorial. Kharkiv, Sumy, Dnipropetrovsk e Mykolaiv permanecem
com o amarelo-base da Ucrânia. Dentro dos seis estados, a base fica
vermelho-claro e o território atrás da linha de frente recebe a hachura em dois
tons de vermelho. A hachura também continua sobre qualquer trecho atrás da
linha, no sentido da Rússia, que atravesse um estado mantido com a base amarela.

`territories/ukraine-war-timeline-2022-2026.geojson` guarda a progressão
territorial animada em 301 polígonos, um a cada dois quadros da composição de
600 quadros. Os marcos históricos vêm das camadas temporais públicas do
Institute for the Study of War: há amostragem diária entre 24/02 e 31/03/2022,
marcos frequentes no restante de 2022 e amostragem mensal de 2023 a maio de
2026. O quadro
final não é inferido: ele reutiliza exatamente o polígono Liveuamap aprovado de
30/07/2026.

Os quadros intermediários são uma interpolação espacial por distância assinada,
recortada pelo território internacionalmente reconhecido da Ucrânia. A
temporização reserva os primeiros quatro segundos ao avanço inicial e comprime
progressivamente os anos seguintes, preservando também os recuos e as
contraofensivas. `tools/build-ukraine-war-timeline.py` documenta e reproduz a
coleta, o recorte e a geração desses quadros.

Os ícones das bandeiras e a hachura ficam no atlas local
`sprites/theatrum-ukraine`, uma extensão do sprite Protomaps usada apenas por
esse mapa. Os sprites Protomaps originais permanecem intactos e verificáveis
pelo manifesto.

## Glyphs

Os três ranges PBF de `Open Sans Semibold` também vêm de
`maplibre/demotiles`. Eles cobrem Latin, Latin Extended e Cyrillic, suficientes
para os nomes usados nesta primeira base.

O mapa detalhado acrescenta os ranges necessários de Noto Sans Regular, Medium,
Italic e Devanagari, além dos sprites Protomaps v4. Esses arquivos pequenos são
fixados por tamanho e SHA-256 em `tools/fetch-data.ts`.

## Satélite offline de Hormuz

`pnpm satellite:hormuz` baixa um recorte `54,24.2,58.8,28.1` do mosaico
EOxCloudless Sentinel-2 de 2016 até zoom 13. A pirâmide fica em `data/raster/`,
é ignorada pelo Git e gera seu próprio `basemap.json`. O seletor oferece duas
versões: satélite puro e híbrido com as ruas e os rótulos detalhados.

Foi escolhido o mosaico de 2016 porque ele é CC BY 4.0, inclusive para uso
comercial. As edições de 2018–2025 são CC BY-NC-SA e não podem ser embutidas
silenciosamente num editor de finalidade aberta.

## Verificação

```powershell
pnpm data:fetch
pnpm data:verify
```

O manifesto fixa URLs por commit, tamanhos e SHA-256 em `tools/fetch-data.ts`.
O pacote regional satelital, por ser grande e opcional, é verificado à parte:

```powershell
pnpm satellite:hormuz:verify
```

## Linha de frente da Ucrânia

`frontlines/ukraine-liveuamap-2026-07-30-z9.geojson` é um recorte cartográfico
aproximado da camada de controle exibida pelo Liveuamap em 30/07/2026
(atualização indicada pela página: 20:16:54). A geometria foi capturada em
zoom 9, e os trechos contíguos foram unidos em uma linha principal, mais os
setores separados de Sumy e Kharkiv. Fronteiras internacionais e litoral foram
removidos para deixar apenas os setores de frente. O arquivo é datado de
propósito: uma atualização futura deve gerar um novo recorte, sem sobrescrever
silenciosamente este snapshot.
