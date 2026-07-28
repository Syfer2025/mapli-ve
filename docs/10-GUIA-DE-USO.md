# Guia rápido de uso

Este guia é para operar o Theatrum. A documentação 00–09 explica arquitetura e
decisões internas.

## 1. Instalar e começar

1. Execute `Theatrum-Setup-0.1.0-x64.exe`.
2. Escolha a pasta de instalação.
3. Abra **Theatrum** pelo atalho da área de trabalho.
4. Na barra superior, abra **Exemplos…** e escolha um dos três projetos.

O pacote é offline: mapas, cobertura detalhada Irã–Hormuz, satélite e encoder de
vídeo já estão incluídos. A compilação interna ainda não tem certificado de
assinatura; o Windows pode mostrar o SmartScreen na primeira abertura.

## 2. Navegar no mapa

- Arraste para mover.
- Use a roda para aproximar e afastar.
- No seletor do viewport, escolha:
  - **Relevo escuro**, **Pergaminho** ou **Político** para o mapa mundial;
  - **Detalhado Irã–Hormuz** para províncias, cidades, ruas, edifícios e POIs;
  - **Satélite** para imagem;
  - **Satélite híbrido** para imagem com ruas e rótulos.
- A caixa de busca aceita nomes de lugares.

Tudo isso funciona sem internet depois da instalação.

## 3. Animar

1. Selecione um objeto no mapa ou no painel **Projeto**.
2. Arraste o indicador de tempo na timeline.
3. Edite as propriedades no **Inspector**.
4. Use o painel **Ações** para movimentos e eventos prontos.

As ações podem ficar **ao vivo**, fáceis de parametrizar, ou ser convertidas em
keyframes para ajuste individual. `Ctrl+Z` desfaz a conversão inteira.

Atalhos principais:

| Ação                | Atalho                    |
| ------------------- | ------------------------- |
| Salvar              | `Ctrl+S`                  |
| Abrir               | `Ctrl+O`                  |
| Desfazer / refazer  | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Reproduzir / pausar | `Espaço`                  |
| Duplicar seleção    | `Ctrl+D`                  |
| Excluir seleção     | `Delete`                  |

## 4. Exportar

Abra **Fila de render**, escolha o formato e clique em **Exportar**.

| Formato              | Quando usar                                     |
| -------------------- | ----------------------------------------------- |
| MP4 · H.264          | Reprodução, envio e publicação                  |
| GIF animado          | Preview curto e incorporação em páginas         |
| ProRes 4444 · alfa   | Composição profissional em Premiere/Resolve/NLE |
| Sequência PNG        | Máxima qualidade, um arquivo por frame          |
| Sequência PNG · alfa | Composição por frame com mapa removido          |

O modo alfa exclui o mapa base e mantém palco/overlay. O painel mostra progresso,
tempo estimado, falhas de estabilização e SHA-256 dos arquivos FFmpeg.

## 5. Salvar e recuperar

- Projetos usam a extensão `.theatrum`.
- Um exemplo nunca é sobrescrito: ao salvar, o aplicativo pede um novo nome.
- Se o processo fechar de forma inesperada, a próxima abertura oferece a sessão
  recuperável.
- O asterisco ao lado do nome indica alterações ainda não salvas.

## Limites conhecidos desta versão

- A resolução de export ainda acompanha o tamanho do viewport; 4K/8K dedicado
  virá com a janela de render isolada.
- Interromper funciona, mas retomada automática por checkpoint ainda não.
- Motion blur temporal ainda não entrou.
- O instalador não é assinado por certificado público e pode acionar SmartScreen.
