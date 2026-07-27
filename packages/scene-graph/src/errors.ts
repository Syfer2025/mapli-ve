export type HierarchyIssueCode =
  | "root-missing"
  | "root-parent"
  | "node-key-mismatch"
  | "missing-parent"
  | "missing-child"
  | "duplicate-child"
  | "child-parent-mismatch"
  | "child-not-listed"
  | "cycle"
  | "unreachable";

export interface HierarchyIssue {
  readonly code: HierarchyIssueCode;
  readonly nodeId: string;
  readonly relatedId?: string;
  readonly message: string;
}

export class SceneGraphInvariantError extends Error {
  readonly issues: readonly HierarchyIssue[];

  constructor(message: string, issues: readonly HierarchyIssue[] = []) {
    super(message);
    this.name = "SceneGraphInvariantError";
    this.issues = issues;
  }
}

export type RegistryIssueCode =
  | "invalid-type"
  | "duplicate-type"
  | "duplicate-property"
  | "invalid-property-path"
  | "invalid-animatable-list";

export class NodeTypeRegistrationError extends Error {
  readonly code: RegistryIssueCode;
  readonly type: string;

  constructor(code: RegistryIssueCode, type: string, message: string) {
    super(message);
    this.name = "NodeTypeRegistrationError";
    this.code = code;
    this.type = type;
  }
}
