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

## Glyphs

Os três ranges PBF de `Open Sans Semibold` também vêm de
`maplibre/demotiles`. Eles cobrem Latin, Latin Extended e Cyrillic, suficientes
para os nomes usados nesta primeira base.

## Verificação

```powershell
pnpm data:fetch
pnpm data:verify
```

O manifesto fixa URLs por commit, tamanhos e SHA-256 em `tools/fetch-data.ts`.
