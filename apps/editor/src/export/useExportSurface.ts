/**
 * O lado React da transação de tamanho do export.
 *
 * Separado do store (`surface-override.ts`) de propósito: aquele é lógica pura,
 * afirmável em teste sem DOM e sem GPU, e é onde mora a parte que pode errar em
 * silêncio. Aqui só há encanamento de ciclo de vida.
 *
 * **O `apply` vai num efeito de layout, não num efeito comum.** O efeito de layout
 * roda antes de o navegador pintar, então o redimensionamento entra no mesmo
 * quadro. Quem decide se a superfície **chegou** lá é o predicado `conforms`, não
 * o momento em que `apply` retornou.
 */

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  getSurfaceOverrideSnapshot,
  registerExportSurface,
  subscribeSurfaceOverride,
  type SurfaceConformance,
  type SurfaceOverride,
} from "./surface-override.js";

/**
 * Registra uma superfície, aplica o override e responde se já chegou ao tamanho.
 *
 * `apply` recebe `null` na volta ao normal — e tem de tratar isso devolvendo o
 * tamanho medido, não repetindo o último override. É a metade `finally` da
 * transação, e é a que ninguém testa até deixar o painel do usuário em 4K.
 *
 * `conforms` é lido por **função**, não por valor, e sempre pela ref: ele é
 * chamado de fora do ciclo do React, por um laço que não re-renderiza nada, e
 * precisa ler o canvas de agora — não o do render em que foi criado. É a armadilha
 * 4.12 aplicada a um predicado.
 */
export function useExportSurface(
  id: string,
  apply: (override: SurfaceOverride | null) => void,
  conforms: SurfaceConformance,
): SurfaceOverride | null {
  const state = useSyncExternalStore(subscribeSurfaceOverride, getSurfaceOverrideSnapshot);
  // Por ref para o efeito não depender da identidade da closure: um `apply`
  // recriado a cada render reaplicaria o tamanho em todo frame do preview.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const conformsRef = useRef(conforms);
  conformsRef.current = conforms;

  useLayoutEffect(
    () => registerExportSurface(id, (override) => conformsRef.current(override)),
    [id],
  );

  useLayoutEffect(() => {
    applyRef.current(state.override);
  }, [state]);

  return state.override;
}

/**
 * Põe um elemento no tamanho do override, ou devolve o tamanho medido.
 *
 * String vazia, e não `auto` ou o valor antigo: é assim que a propriedade inline
 * some e o elemento volta a obedecer à folha de estilo e ao dockview. Guardar o
 * valor anterior para restaurar seria uma segunda verdade sobre o mesmo tamanho.
 */
export function applyOverrideToElement(
  element: HTMLElement | null,
  override: SurfaceOverride | null,
): void {
  if (element === null) return;
  element.style.width = override === null ? "" : `${String(override.width)}px`;
  element.style.height = override === null ? "" : `${String(override.height)}px`;
}
