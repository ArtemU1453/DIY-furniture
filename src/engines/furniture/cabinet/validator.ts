/**
 * FurnitureValidator — проверка конструкции корпуса на уровне бизнес-логики
 * (а не только HTML-валидации): некорректные параметры, слишком малые размеры,
 * невозможные конструкции, выход деталей за габарит и пересечения деталей.
 */
import type { Part } from '@/core/model/types';
import { partWorldAABB, type AABB } from '@/core/geometry/partGeometry';
import type { CabinetParameters } from './parameters';

export type Severity = 'error' | 'warning' | 'info';

export interface FurnitureIssue {
  severity: Severity;
  code: string;
  message: string;
  parts?: string[]; // номера/имена задействованных деталей
}

const MIN_DIMENSION = 50; // мм — минимальный разумный габарит корпуса

/** Проверка параметров изделия (до генерации). */
export function validateCabinetParameters(p: CabinetParameters): FurnitureIssue[] {
  const issues: FurnitureIssue[] = [];
  const dims: Array<[number, string]> = [
    [p.width, 'Ширина'],
    [p.height, 'Высота'],
    [p.depth, 'Глубина'],
    [p.thickness, 'Толщина'],
  ];
  for (const [v, label] of dims) {
    if (!Number.isFinite(v) || v <= 0) {
      issues.push({ severity: 'error', code: 'param.nonPositive', message: `${label} должна быть больше 0.` });
    }
  }
  if (p.thickness > 0 && p.width <= 2 * p.thickness) {
    issues.push({
      severity: 'error',
      code: 'param.widthTooSmall',
      message: 'Ширина слишком мала для выбранной толщины (нет внутреннего пространства).',
    });
  }
  if (p.thickness > 0 && p.height <= 2 * p.thickness) {
    issues.push({
      severity: 'error',
      code: 'param.heightTooSmall',
      message: 'Высота слишком мала для выбранной толщины.',
    });
  }
  if (p.width > 0 && p.width < MIN_DIMENSION) {
    issues.push({ severity: 'warning', code: 'param.width.small', message: 'Слишком малая ширина корпуса.' });
  }
  // Проверка помещаемости перегородок.
  const innerWidth = p.width - 2 * p.thickness;
  const sectionWidth = (innerWidth - p.dividers * p.thickness) / (p.dividers + 1);
  if (p.dividers > 0 && sectionWidth <= 0) {
    issues.push({
      severity: 'error',
      code: 'param.tooManyDividers',
      message: 'Слишком много перегородок для такой ширины.',
    });
  } else if (p.dividers > 0 && sectionWidth < 100) {
    issues.push({
      severity: 'warning',
      code: 'param.narrowSections',
      message: `Секции очень узкие (~${Math.round(sectionWidth)} мм).`,
    });
  }
  return issues;
}

function overlapVolume(a: AABB, b: AABB): number {
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return ox * oy * oz;
}

const partLabel = (p: Part): string => (p.metadata?.number as string) ?? p.name;

/**
 * Геометрическая проверка деталей: пересечения (объёмное перекрытие сверх
 * допуска) и выход за габарит корпуса.
 */
export function validateCabinetGeometry(parts: Part[], p: CabinetParameters): FurnitureIssue[] {
  const issues: FurnitureIssue[] = [];
  const tol = 1; // мм — касание не считается пересечением

  const boxes = parts.map((part) => ({ part, box: partWorldAABB(part) }));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
      const oy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
      const oz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
      if (ox > tol && oy > tol && oz > tol && overlapVolume(a.box, b.box) > tol ** 3) {
        issues.push({
          severity: 'warning',
          code: 'geometry.intersection',
          message: `«${a.part.name}» пересекается с «${b.part.name}».`,
          parts: [partLabel(a.part), partLabel(b.part)],
        });
      }
    }
  }

  // Выход за габарит (кроме накладной задней стенки, которая выступает по Z).
  const halfW = p.width / 2;
  const halfD = p.depth / 2;
  for (const { part, box } of boxes) {
    const isOverlayBack = part.metadata?.partType === 'back' && p.back === 'overlay';
    const outX = box.min.x < -halfW - tol || box.max.x > halfW + tol;
    const outY = box.min.y < -tol || box.max.y > p.height + tol;
    const outZ = !isOverlayBack && (box.min.z < -halfD - tol || box.max.z > halfD + tol);
    if (outX || outY || outZ) {
      issues.push({
        severity: 'warning',
        code: 'geometry.outOfBounds',
        message: `«${part.name}» выходит за габарит корпуса.`,
        parts: [partLabel(part)],
      });
    }
  }

  return issues;
}

/** Полная проверка шкафа. */
export function validateCabinet(parts: Part[], p: CabinetParameters): FurnitureIssue[] {
  return [...validateCabinetParameters(p), ...validateCabinetGeometry(parts, p)];
}
