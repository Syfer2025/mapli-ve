# Projetos de exemplo

Abra pelo botão **Abrir** na barra superior do Theatrum.

1. **01 · Hormuz — bloqueio naval**  
   Patrulha em ciclo no Estreito de Hormuz. Selecione **Força naval** e altere a
   ação ao vivo. No seletor do mapa, experimente **Satélite híbrido**.
2. **02 · Hormuz — lançamento de míssil**  
   Trajetória 3D, impacto, fumaça e tremor. Reproduza a partir do marcador
   **Início da ação** e use **Converter em keyframes** para abrir a animação.
3. **03 · Irã — linha de frente**  
   Revelação territorial sem assets externos. Edite o caminho e observe a linha
   acompanhar os vértices.

Os três arquivos são gerados deterministicamente por
`pnpm examples:build` e não precisam de rede.

## Scene Script

`alexandre.scene.json` é o exemplo de autoria declarativa de
`docs/05-SCENE-SCRIPT.md`. Na barra superior, abra **Scene Script…**, escolha
**Abrir JSON…** e então **Compilar e importar**. A cena resultante dura 1m30s e
um único `Ctrl+Z` desfaz toda a importação.

`ukraine-invasion-first-ten-days.scene.json` é o template de narrativa
cartográfica diária: mapa político sem cidades automáticas, contexto territorial
por cor, rótulos sob demanda e eventos encadeados depois do movimento de câmera.
Ele também serve como prova de âncoras geográficas para marcadores, rotas,
impactos e chamadas.
