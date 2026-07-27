import type { DockviewTheme } from "dockview-react";

/**
 * Tema do dockview.
 *
 * No dockview 7 o tema é um **objeto** passado no prop `theme`, e `className`
 * aponta para a classe CSS que carrega as variáveis. Passar a classe via
 * `className` no componente não tem efeito: ele usa o tema padrão (abyss) e o
 * CSS customizado fica inerte — foi exatamente o que aconteceu na primeira
 * tentativa, e só apareceu ao inspecionar o DOM renderizado.
 */
export const THEATRUM_DOCKVIEW_THEME: DockviewTheme = {
  name: "theatrum",
  className: "dockview-theme-theatrum",
  colorScheme: "dark",

  // Sem gap entre grupos: densidade importa mais que respiro numa ferramenta
  // que mostra mapa, timeline e inspector ao mesmo tempo.
  gap: 0,

  // Barra contínua sob o grupo de abas, em vez do sublinhado que curva em
  // volta da aba ativa. Mais sóbrio e não depende de JS para posicionar.
  tabGroupIndicator: "none",

  // Overlay de arraste sobre o conteúdo, ancorado na raiz: com `relative` o
  // indicador fica clipado por painéis estreitos.
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "content",
  dndTabIndicator: "line",
  dndOverlayBorder: "1px solid var(--accent)",
};
