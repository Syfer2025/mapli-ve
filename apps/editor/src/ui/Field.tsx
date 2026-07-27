import type { ReactNode } from "react";
import { useId } from "react";
import "./Field.css";

export interface FieldProps {
  readonly label: string;
  /** Unidade mostrada depois do controle: px, °, %, km. */
  readonly unit?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  /** Sinaliza que a propriedade tem keyframes — o ponto vira acento. */
  readonly animated?: boolean;
  readonly children: (id: string) => ReactNode;
}

/**
 * Linha rótulo/controle do Inspector.
 *
 * Recebe `children` como função do `id` para que o rótulo aponte de verdade
 * para o controle (`htmlFor`) sem que o chamador precise inventar um id.
 */
export function Field({
  label,
  unit,
  hint,
  disabled = false,
  animated = false,
  children,
}: FieldProps): ReactNode {
  const id = useId();

  return (
    <div className="ui-field" data-disabled={disabled || undefined}>
      <span
        className="ui-field__indicator"
        data-animated={animated || undefined}
        aria-hidden="true"
      />

      <label className="ui-field__label" htmlFor={id} title={hint}>
        {label}
      </label>

      <div className="ui-field__control">
        {children(id)}
        {unit !== undefined && <span className="ui-field__unit">{unit}</span>}
      </div>
    </div>
  );
}

export interface FieldGroupProps {
  readonly title: string;
  readonly children: ReactNode;
}

export function FieldGroup({ title, children }: FieldGroupProps): ReactNode {
  return (
    <div className="ui-field-group">
      <h3 className="ui-field-group__title">{title}</h3>
      <div className="ui-field-group__body">{children}</div>
    </div>
  );
}
