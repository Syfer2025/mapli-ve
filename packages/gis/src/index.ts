/**
 * @theatrum/gis — L2 · domínio
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/gis/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export {
  type LngLat,
  type ScreenPoint,
  type MercatorPoint,
  type ProjectorSnapshot,
  type ProjectorPort,
  type TileSourcePort,
  type GeoBounds,
  type MercatorFit,
  type MercatorFitOptions,
  type PlaceKind,
  type GazetteerPlace,
  type GazetteerHit,
  type GazetteerPort,
  type GazetteerResolution,
} from "./types.js";

export {
  WEB_MERCATOR_RADIUS,
  WEB_MERCATOR_CIRCUMFERENCE,
  MAX_MERCATOR_LATITUDE,
  DEFAULT_TILE_SIZE,
  wrapLongitude,
  shortestLongitudeDelta,
  clampMercatorLatitude,
  webMercatorProject,
  webMercatorUnproject,
  mercatorWorldSize,
  lngLatToWorldPixel,
  worldPixelToLngLat,
  mercatorMetersPerPixel,
  mercatorInterpolate,
} from "./mercator.js";

export {
  EARTH_MEAN_RADIUS_METERS,
  geodesicDistance,
  initialBearing,
  destinationPoint,
  greatCircleInterpolate,
} from "./geodesy.js";

export {
  geoBoundsLongitudeSpan,
  geoBoundsFromPoints,
  geoBoundsContains,
  geoBoundsCenter,
  fitMercatorBounds,
} from "./bounds.js";

export {
  type FlatMercatorProjectorOptions,
  FlatMercatorProjector,
  createFlatMercatorProjector,
  projectorFromSnapshot,
} from "./projector.js";

export {
  GEO_MESH_FORMAT_VERSION,
  GeoMeshError,
  createGeoMesh,
  type GeoFeature,
  type GeoFeatureEntry,
  type GeoFeatureKind,
  type GeoMesh,
  type GeoMeshIndex,
  type GeoRingEntry,
  type GeoViewBounds,
} from "./geo-mesh.js";

export { clipBufferSize, clipPolyline, clipRing, type ClipBounds } from "./clip.js";

export {
  containingPolygon,
  pointInPolygon,
  prepareJoinPolygons,
  type JoinPolygon,
  type JoinRing,
} from "./spatial-join.js";

export { createRegionCatalog, type RegionCatalog, type RegionHit } from "./region-catalog.js";

export { BUILTIN_GAZETTEER_PLACES } from "./gazetteer-data.js";

export {
  normalizePlaceQuery,
  OfflineGazetteer,
  classifyGazetteerHits,
  resolvePlace,
} from "./gazetteer.js";
