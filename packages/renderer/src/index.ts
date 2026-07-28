/**
 * @theatrum/renderer — L3 · motores
 *
 * Converte `ScreenScene` em pixels sem ler documento, câmera ou estado da UI.
 * Pixi fica isolado no adaptador; o backend headless prova lifecycle e
 * determinismo em Node puro.
 */

export {
  SLOT_IDS,
  PREVIEW_SLOT_ORDER,
  EXPORT_SLOT_ORDER,
  type SlotId,
  type RendererBackendKind,
  type CaptureEncoding,
  type RenderSurface,
  type SurfaceSet,
  type CapturedFrame,
  type NodeLayout,
  type ScreenFilter,
  type NodeMatte,
  type ScreenNode,
  type ScreenScene,
  type NonePrimitive,
  type TextPrimitive,
  type ImagePrimitive,
  type LinePrimitive,
  type PolygonPrimitive,
  type GeoShapePrimitive,
  type CalloutPrimitive,
  type CirclePrimitive,
  type SymbolPrimitive,
  type VisualPrimitive,
  type RenderContext,
  type Renderable,
  type RenderableFactory,
  type VisualEvaluator,
  type RenderTarget,
  type Compositor,
  type RenderBackend,
  type Renderer,
} from "./contracts.js";

export { RendererError, type RendererErrorCode } from "./errors.js";
export { RenderableRegistry, type RenderableRegistration } from "./registry.js";
export { createDataRenderableFactory } from "./data-renderable.js";
export { createCompositor, assertUniqueSlots } from "./compositor.js";
export {
  BUILTIN_RENDERABLE_TYPES,
  registerBuiltinRenderables,
  createBuiltinRenderableRegistry,
  evaluateBuiltinVisual,
  circleVisual,
} from "./builtins.js";
export {
  createHeadlessRenderBackend,
  type HeadlessRenderBackend,
  type HeadlessBackendEvent,
  type HeadlessNodeSnapshot,
  type HeadlessBackendSnapshot,
} from "./headless-backend.js";
export { createPixiRenderBackend, type PixiRenderBackendOptions } from "./pixi-backend.js";
export { warmImageTexture, evictImageTexture, inspectImageTexture } from "./texture-cache.js";
export {
  createScreenScene,
  type EvaluatedRenderableNodeLike,
  type EvaluatedRenderableSceneLike,
  type NodeLayoutLike,
  type LayoutSceneLike,
  type CreateScreenSceneOptions,
} from "./screen-scene.js";
export { visualPlacement, type VisualPlacement } from "./placement.js";
export {
  colorGradeMatrix,
  composeColorMatrices,
  isIdentityColorMatrix,
  IDENTITY_COLOR_MATRIX,
  type ColorGradeParams,
  type ColorMatrix,
} from "./color-grade.js";
export { hexToRgbTriple } from "./filter-shaders.js";
export { SUPPORTED_FILTER_TYPES, type FilterChain } from "./pixi-filter-chain.js";
export { createRenderer, type CreateRendererOptions } from "./renderer.js";
