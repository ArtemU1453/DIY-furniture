/**
 * Централизованная валидация модели.
 *
 * Проверки НЕ размазаны по UI-компонентам — они собраны здесь и возвращают
 * понятные сообщения. UI лишь отображает результат.
 */
import type { Part, Project } from '../model/types';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** id связанного объекта (детали/материала/...), если применимо. */
  targetId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const MAX_DIMENSION_MM = 6000; // разумный верхний предел для листовой детали

/** Проверить одну деталь. Возвращает список проблем (пустой = всё хорошо). */
export function validatePart(part: Part): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const dims: Array<[keyof Pick<Part, 'width' | 'height' | 'thickness'>, string]> = [
    ['width', 'Ширина'],
    ['height', 'Высота'],
    ['thickness', 'Толщина'],
  ];

  for (const [key, label] of dims) {
    const value = part[key];
    if (!Number.isFinite(value)) {
      issues.push({
        severity: 'error',
        code: `part.${key}.invalid`,
        message: `${label} детали «${part.name}» должна быть числом.`,
        targetId: part.id,
      });
    } else if (value <= 0) {
      issues.push({
        severity: 'error',
        code: `part.${key}.nonPositive`,
        message: `${label} детали «${part.name}» должна быть больше 0.`,
        targetId: part.id,
      });
    } else if (value > MAX_DIMENSION_MM) {
      issues.push({
        severity: 'warning',
        code: `part.${key}.tooLarge`,
        message: `${label} детали «${part.name}» превышает ${MAX_DIMENSION_MM} мм.`,
        targetId: part.id,
      });
    }
  }

  if (!Number.isInteger(part.quantity) || part.quantity < 1) {
    issues.push({
      severity: 'error',
      code: 'part.quantity.invalid',
      message: `Количество детали «${part.name}» должно быть целым числом ≥ 1.`,
      targetId: part.id,
    });
  }

  return issues;
}

/** Проверить, допустимо ли значение размера (для полей ввода UI). */
export function isValidDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION_MM;
}

/** Полная валидация проекта. */
export function validateProject(project: Project): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      for (const p of a.parts) {
        issues.push(...validatePart(p));
      }
    }
  }

  if (project.settings.kerf < 0) {
    issues.push({
      severity: 'error',
      code: 'settings.kerf.negative',
      message: 'Ширина пропила не может быть отрицательной.',
    });
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}
