/**
 * Plugin ESLint com as regras específicas do Theatrum.
 *
 * Cada uma existe porque a alternativa é descobrir a violação semanas depois,
 * quando ela já está no caminho crítico. Ver docs/07-CONVENTIONS.md § 7.
 */

import noCrossLayerImport from "./no-cross-layer-import.mjs";
import noNondeterminism from "./no-nondeterminism.mjs";
import enforceBarrelImports from "./enforce-barrel-imports.mjs";
import noDirectDocumentMutation from "./no-direct-document-mutation.mjs";

export default {
  meta: { name: "theatrum", version: "0.1.0" },
  rules: {
    "no-cross-layer-import": noCrossLayerImport,
    "no-nondeterminism": noNondeterminism,
    "enforce-barrel-imports": enforceBarrelImports,
    "no-direct-document-mutation": noDirectDocumentMutation,
  },
};
