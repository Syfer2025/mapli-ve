# ADR-001 — Electron em vez de Tauri

**Status:** aceito · **Data:** 2026-07-26 · **Revisar em:** Fase 8

## Contexto

O app precisa de: WebGL2/WebGPU confiável, pipe de bytes de alto volume para
FFmpeg (33 MB por frame em 4K RGBA), acesso a disco sem cerimônia, uma janela
oculta de render, e funcionamento offline. Uma máquina, Windows 11.

## Decisão

**Electron.**

## Alternativas

### Tauri v2

- ✅ Binário ~10 MB vs ~150 MB
- ✅ Backend Rust, memória menor
- ❌ Usa WebView2 do sistema — versão fora do nosso controle. Uma atualização do
  Edge pode mudar comportamento de WebGL ou de WebCodecs entre um render e outro.
  Para um app cujo requisito central é **reprodutibilidade byte a byte**, isso é
  um problema de fundação, não de conveniência.
- ❌ Frames capturados teriam que atravessar a fronteira JS→Rust via IPC. A 4K/60,
  são 2 GB/s. Exigiria memória compartilhada e trabalho considerável para
  igualar o que no Node é `stream.write(buffer)`.
- ❌ Suporte a WebCodecs no WebView2 é menos previsível que no Chromium fixo.

### Navegador + servidor local

- ❌ Sem acesso a disco, sem sidecar, sem janela oculta. Elimina metade do escopo.

### Nativo (Qt, C++, Rust puro)

- ❌ Perderia MapLibre GL JS, PixiJS e todo o ecossistema web de renderização.
  Reescrever renderização de mapa vetorial não é escopo viável.

## Consequências

Positivas:

- Chromium com versão fixa e conhecida → WebGL/WebGPU/WebCodecs previsíveis.
- `child_process` + `stream.write()` resolve o pipe pra FFmpeg em 5 linhas.
- `BrowserWindow` oculta resolve a janela de render sem invenção.
- Ecossistema `electron-vite` + `electron-builder` maduro.

Negativas aceitas:

- Instalador ~150 MB. Irrelevante para uso interno local.
- ~200 MB de RAM base. Irrelevante numa máquina de edição.
- Atualizações de segurança do Chromium exigem bump de Electron. Aceitável — o
  app não abre conteúdo remoto.

## Mitigação de acoplamento

Todo acesso ao sistema passa por **ports** (`FileSystemPort`, `EncoderPort`,
`TileSourcePort`). Os motores não sabem que Electron existe. Se a decisão for
revista, o trabalho fica contido em `apps/shell` e nas implementações de adapter —
não em 18 pacotes.

## Quando revisar

Na Fase 8, se o pipe para FFmpeg se mostrar gargalo, ou se WebCodecs em Chromium
apresentar limitação de alpha que um encoder nativo em Rust resolveria.
