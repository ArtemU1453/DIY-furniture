/**
 * ParametricValidator (§5/§6/§66/§83/§84).
 *
 * Отсекает невозможные конфигурации ДО генерации, чтобы повреждённая
 * геометрия не попала в ProjectModel: неположительные и нечисловые размеры,
 * выход за лимиты шаблона, корпус без внутреннего пространства, полки и
 * фасады нулевой ширины.
 */
import type { ParametricModel, Parameter } from '@/core/parametric/types';
import { resolveParameters } from './resolve';

export type ParametricSeverity = 'error' | 'warning';

export interface ParametricIssue {
  severity: ParametricSeverity;
  code: string;
  message: string;
  field?: string;
}

/** Минимальный физически осмысленный размер детали. */
export const MIN_PART_SIZE = 1;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Число положительное и конечное: 0, отрицательные, NaN и Infinity — нет. */
export function isValidDimension(value: unknown): value is number {
  return isNum(value) && value > 0;
}

/** Проверка габаритов и лимитов (§5/§6). */
export function validateDimensions(model: ParametricModel): ParametricIssue[] {
  const issues: ParametricIssue[] = [];
  const dims: Array<[number, string, string]> = [
    [model.width, 'width', 'Ширина'],
    [model.height, 'height', 'Высота'],
    [model.depth, 'depth', 'Глубина'],
    [model.thickness, 'thickness', 'Толщина материала'],
  ];
  for (const [value, field, label] of dims) {
    if (!isValidDimension(value)) {
      issues.push({
        severity: 'error', code: 'dim.invalid', field,
        message: `${label}: значение должно быть положительным числом (получено ${String(value)}).`,
      });
    }
  }
  if (issues.length > 0) return issues;

  const L = model.limits;
  const bounds: Array<[number, number, number, string, string]> = [
    [model.width, L.minimumWidth, L.maximumWidth, 'width', 'Ширина'],
    [model.height, L.minimumHeight, L.maximumHeight, 'height', 'Высота'],
    [model.depth, L.minimumDepth, L.maximumDepth, 'depth', 'Глубина'],
  ];
  for (const [value, min, max, field, label] of bounds) {
    if (value < min) {
      issues.push({ severity: 'error', code: 'dim.belowMin', field, message: `${label} ${value} мм меньше минимальной (${min} мм).` });
    } else if (value > max) {
      issues.push({ severity: 'error', code: 'dim.aboveMax', field, message: `${label} ${value} мм больше максимальной (${max} мм).` });
    }
  }
  return issues;
}

/** Проверка внутренней геометрии: детали не должны стать невозможными (§66). */
export function validateGeometry(model: ParametricModel): ParametricIssue[] {
  const issues: ParametricIssue[] = [];
  const t = model.thickness;

  const innerWidth = model.width - 2 * t;
  const innerHeight = model.height - 2 * t;
  if (innerWidth < MIN_PART_SIZE) {
    issues.push({
      severity: 'error', code: 'geom.noInnerWidth', field: 'width',
      message: `Ширина ${model.width} мм при толщине ${t} мм не оставляет внутреннего пространства.`,
    });
  }
  if (innerHeight < MIN_PART_SIZE) {
    issues.push({
      severity: 'error', code: 'geom.noInnerHeight', field: 'height',
      message: `Высота ${model.height} мм при толщине ${t} мм не оставляет внутреннего пространства.`,
    });
  }

  // Перегородки делят проём: каждая секция должна остаться шире нуля.
  const partitions = Math.max(0, Math.trunc(model.partitions.count));
  if (partitions > 0 && innerWidth >= MIN_PART_SIZE) {
    const sectionWidth = (innerWidth - partitions * t) / (partitions + 1);
    if (sectionWidth < MIN_PART_SIZE) {
      issues.push({
        severity: 'error', code: 'geom.sectionTooNarrow', field: 'partitions',
        message: `${partitions} перегородок не помещаются: ширина секции ${sectionWidth.toFixed(1)} мм.`,
      });
    }
  }

  // Полки: должны помещаться по высоте.
  const shelves = Math.max(0, Math.trunc(model.shelves.count));
  if (shelves > 0 && innerHeight >= MIN_PART_SIZE) {
    const free = innerHeight - shelves * t - model.shelves.startOffset - model.shelves.endOffset;
    if (free < 0) {
      issues.push({
        severity: 'error', code: 'geom.shelvesDontFit', field: 'shelves',
        message: `${shelves} полок не помещаются по высоте при толщине ${t} мм.`,
      });
    }
  }
  // Полка мельче корпуса — но не до нуля.
  const shelfDepth = model.depth - model.shelves.depthReduction;
  if (shelves > 0 && shelfDepth < MIN_PART_SIZE) {
    issues.push({
      severity: 'error', code: 'geom.shelfDepth', field: 'depth',
      message: `Глубина полки ${shelfDepth.toFixed(1)} мм — уменьшите отступ по глубине.`,
    });
  }

  // Фасады: ширина каждого после зазоров.
  const doors = Math.max(0, Math.trunc(model.doors.count));
  if (doors > 0) {
    const g = model.doors.gaps;
    const total = model.width - g.leftGap - g.rightGap - g.betweenGap * (doors - 1);
    const each = total / doors;
    if (each < MIN_PART_SIZE) {
      issues.push({
        severity: 'error', code: 'geom.doorTooNarrow', field: 'doors',
        message: `${doors} фасадов не помещаются: ширина фасада ${each.toFixed(1)} мм.`,
      });
    }
    const doorHeight = model.height - g.topGap - g.bottomGap;
    if (doorHeight < MIN_PART_SIZE) {
      issues.push({
        severity: 'error', code: 'geom.doorTooShort', field: 'doors',
        message: `Высота фасада ${doorHeight.toFixed(1)} мм — уменьшите зазоры.`,
      });
    }
  }

  // Задняя стенка.
  if (model.backPanel.type !== 'NONE' && !isValidDimension(model.backPanel.thickness)) {
    issues.push({
      severity: 'error', code: 'geom.backThickness', field: 'backThickness',
      message: 'Толщина задней стенки должна быть положительной.',
    });
  }

  // Ножки и цоколь.
  if (model.legs.enabled && !isValidDimension(model.legs.height)) {
    issues.push({ severity: 'error', code: 'geom.legHeight', field: 'legs', message: 'Высота ножки должна быть положительной.' });
  }
  if (model.plinth.enabled) {
    if (!isValidDimension(model.plinth.height)) {
      issues.push({ severity: 'error', code: 'geom.plinthHeight', field: 'plinth', message: 'Высота цоколя должна быть положительной.' });
    } else if (model.plinth.height >= model.height) {
      issues.push({ severity: 'error', code: 'geom.plinthTooTall', field: 'plinth', message: 'Цоколь не может быть выше изделия.' });
    }
  }
  return issues;
}

/** Проверка одного параметра против его типа и границ (§7/§8). */
export function validateParameter(p: Parameter): ParametricIssue[] {
  const issues: ParametricIssue[] = [];
  if (p.type === 'NUMBER') {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) {
      issues.push({ severity: 'error', code: 'param.notNumber', field: p.id, message: `Параметр «${p.name}»: ожидается число.` });
      return issues;
    }
    if (p.min != null && p.value < p.min) {
      issues.push({ severity: 'error', code: 'param.belowMin', field: p.id, message: `Параметр «${p.name}»: ${p.value} меньше минимума ${p.min}.` });
    }
    if (p.max != null && p.value > p.max) {
      issues.push({ severity: 'error', code: 'param.aboveMax', field: p.id, message: `Параметр «${p.name}»: ${p.value} больше максимума ${p.max}.` });
    }
  } else if (p.type === 'BOOLEAN' && typeof p.value !== 'boolean') {
    issues.push({ severity: 'error', code: 'param.notBoolean', field: p.id, message: `Параметр «${p.name}»: ожидается «да/нет».` });
  } else if (p.type === 'STRING' && typeof p.value !== 'string') {
    issues.push({ severity: 'error', code: 'param.notString', field: p.id, message: `Параметр «${p.name}»: ожидается текст.` });
  } else if (p.type === 'ENUM') {
    const allowed = p.options?.map((o) => o.value) ?? [];
    if (typeof p.value !== 'string' || (allowed.length > 0 && !allowed.includes(p.value))) {
      issues.push({ severity: 'error', code: 'param.notInEnum', field: p.id, message: `Параметр «${p.name}»: недопустимое значение.` });
    }
  }
  return issues;
}

export interface ParametricValidation {
  ok: boolean;
  issues: ParametricIssue[];
  errors: number;
  warnings: number;
}

/** Полная проверка модели: размеры, лимиты, параметры, геометрия. */
export function validateParametricModel(model: ParametricModel): ParametricValidation {
  const issues: ParametricIssue[] = [...validateDimensions(model)];

  // Геометрию проверяем только при корректных габаритах.
  if (issues.every((i) => i.severity !== 'error')) {
    issues.push(...validateGeometry(model));
  }
  for (const p of model.parameters) issues.push(...validateParameter(p));

  // Выражения и циклы.
  const resolved = resolveParameters(model);
  for (const i of resolved.issues) {
    issues.push({ severity: i.severity, code: i.code, message: i.message, field: i.parameterId });
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, issues, errors, warnings: issues.length - errors };
}
