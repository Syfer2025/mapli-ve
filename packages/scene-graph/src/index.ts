/**
 * @theatrum/scene-graph — L2 · domínio
 *
 * Registry extensível, invariantes da hierarquia plana e resolução de layout
 * geo/comp/parent. Esta é a única superfície pública do pacote.
 */

export type {
  AnchorSpace,
  SizeMode,
  RotationReference,
  NodeCategory,
  PropertyKind,
  PropertyGroup,
  PropertyUnit,
  PropertyBinding,
  PropertyOption,
  PropertyDescriptor,
  NodeTypeDefinition,
  ResolvedTransform,
  EvaluatedNodeLike,
  EvaluatedSceneLike,
  ProjectorPortLike,
  LayoutContext,
  NodeLayout,
  ScreenScene,
} from "./contracts.js";

export {
  SceneGraphInvariantError,
  NodeTypeRegistrationError,
  type HierarchyIssueCode,
  type HierarchyIssue,
  type RegistryIssueCode,
} from "./errors.js";

export {
  createNodeTypeRegistry,
  type NodeTypeRegistry,
  type NodeTypeResolution,
} from "./registry.js";

export {
  GROUP_NODE_TYPE,
  NULL_NODE_TYPE,
  TEXT_TITLE_NODE_TYPE,
  TEXT_LABEL_NODE_TYPE,
  IMAGE_NODE_TYPE,
  SVG_NODE_TYPE,
  SHAPE_LINE_NODE_TYPE,
  SHAPE_POLYGON_NODE_TYPE,
  SHAPE_CIRCLE_NODE_TYPE,
  SYMBOL_ICON_NODE_TYPE,
  UNIT_ARMOR_NODE_TYPE,
  UNIT_INFANTRY_NODE_TYPE,
  BUILTIN_NODE_TYPE_IDS,
  BUILTIN_NODE_TYPES,
  type BuiltinNodeType,
  createBuiltinNodeTypeRegistry,
} from "./builtin-node-types.js";

export {
  validateHierarchy,
  assertValidHierarchy,
  topologicalOrder,
  orderedChildren,
  ancestorIds,
  descendantIds,
  isAncestor,
} from "./hierarchy.js";

export {
  resolveAnchor,
  resolveSize,
  resolveRotation,
  localMatrix,
  worldMatrix,
  layoutNode,
  layoutScene,
} from "./layout.js";
