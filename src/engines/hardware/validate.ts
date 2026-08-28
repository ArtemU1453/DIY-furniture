/**
 * Проверка фурнитуры и её размещения (§109–§116).
 *
 * Правил совместимости здесь не дублируется: толщину и материал проверяет
 * существующий `compatibility.ts`. Этот модуль отвечает за то, что относится
 * к САМОЙ ПОЗИЦИИ и её положению — корректность параметров, выход за границы
 * детали и выход присадки за пределы плиты.
 *
 * Сообщения пишутся для человека (§115) и никогда не содержат внутренних
 * подробностей исполнения (§116).
 */
import { allParts } from '@/core/model/selectors';
import type { Hardware, HardwareInstance, Part, Project } from '@/core/model/types';
import { CANONICAL_OF_CATEGORY } from './templates';
import { resolvePlacement, withinPart } from './placement';

export type HardwareIssueSeverity = 'error' | 'warning';

export interface HardwareValidationIssue {
  severity: HardwareIssueSeverity;
  code: string;
  message: string;
  hardwareId?: string;
  partId?: string;
  instanceId?: string;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Параметры позиции (§109). Размеры обязаны быть положительными: ноль или
 * отрицательный диаметр — это не «мелкое отклонение», а неработающая присадка.
 */
export function validateHardwareItem(hardware: Hardware): HardwareValidationIssue[] {
  const issues: HardwareValidationIssue[] = [];
  const p = hardware.parameters ?? {};

  const positive = ['diameter', 'length', 'depth', 'cupDiameter', 'cupDepth', 'camDiameter', 'camDepth', 'screwDiameter', 'holeSpacing'];
  for (const key of positive) {
    if (!(key in p)) continue;
    const value = num(p[key]);
    if (value === null || value <= 0) {
      issues.push({
        severity: 'error',
        code: 'hardware.badParameter',
        message: `У позиции «${hardware.name}» параметр «${key}» должен быть положительным числом.`,
        hardwareId: String(hardware.id),
      });
    }
  }

  const range = hardware.thicknessRange;
  if (range && range.min != null && range.max != null && range.min > range.max) {
    issues.push({
      severity: 'error',
      code: 'hardware.badThicknessRange',
      message: `У позиции «${hardware.name}» минимальная толщина больше максимальной.`,
      hardwareId: String(hardware.id),
    });
  }

  // §41/§42: у петли чашка не может быть глубже плиты, на которую ставится.
  const cupDepth = num(p.cupDepth);
  const minThickness = range?.min;
  if (cupDepth != null && minThickness != null && cupDepth >= minThickness) {
    issues.push({
      severity: 'warning',
      code: 'hardware.cupDepth',
      message: `Чашка петли «${hardware.name}» глубиной ${cupDepth} мм почти равна минимальной толщине детали ${minThickness} мм.`,
      hardwareId: String(hardware.id),
    });
  }

  return issues;
}

/**
 * Совместимость позиции с деталью (§112/§113). Возвращает объяснение на
 * человеческом языке, а не код ошибки: «Петля Ø35 не может быть установлена
 * на детали толщиной 10 мм».
 */
export function checkHardwareOnPart(hardware: Hardware, part: Part): HardwareValidationIssue | null {
  const range = hardware.thicknessRange;
  if (range?.min != null && part.thickness < range.min) {
    const cup = num(hardware.parameters?.cupDiameter);
    const what = cup ? `${hardware.name} Ø${cup}` : hardware.name;
    return {
      severity: 'error',
      code: 'hardware.thickness',
      message: `«${what}» не может быть установлена на детали «${part.name}» толщиной ${part.thickness} мм: требуется не менее ${range.min} мм.`,
      hardwareId: String(hardware.id),
      partId: String(part.id),
    };
  }
  if (range?.max != null && part.thickness > range.max) {
    return {
      severity: 'warning',
      code: 'hardware.thicknessMax',
      message: `«${hardware.name}» рассчитана на толщину до ${range.max} мм, деталь «${part.name}» — ${part.thickness} мм.`,
      hardwareId: String(hardware.id),
      partId: String(part.id),
    };
  }

  // §113: правило может ограничивать материал.
  const compatible = hardware.compatibleMaterials;
  if (compatible && compatible.length > 0 && part.material) {
    if (!compatible.some((m) => String(m) === String(part.material))) {
      return {
        severity: 'error',
        code: 'hardware.material',
        message: `«${hardware.name}» не предназначена для материала детали «${part.name}».`,
        hardwareId: String(hardware.id),
        partId: String(part.id),
      };
    }
  }

  return null;
}

/** Положение единицы на детали (§110). */
export function checkInstancePlacement(
  hardware: Hardware,
  part: Part,
  instance: HardwareInstance,
): HardwareValidationIssue | null {
  const placed = resolvePlacement(part, hardware.placement);
  if (placed.error) {
    return {
      severity: 'error',
      code: 'hardware.placementExpression',
      message: `Не удалось вычислить положение «${hardware.name}» на детали «${part.name}»: ${placed.error}`,
      hardwareId: String(hardware.id),
      partId: String(part.id),
      instanceId: instance.id,
    };
  }
  if (!withinPart(part, placed)) {
    return {
      severity: 'error',
      code: 'hardware.outOfBounds',
      message: `«${hardware.name}» выходит за границы детали «${part.name}» (${Math.round(placed.x)}×${Math.round(placed.y)} мм при габарите ${Math.round(part.width)}×${Math.round(part.height)} мм).`,
      hardwareId: String(hardware.id),
      partId: String(part.id),
      instanceId: instance.id,
    };
  }
  return null;
}

/**
 * Присадка внутри детали (§111). Проверяются координаты и глубина: отверстие
 * не должно ни выходить за контур, ни пробивать плиту насквозь без нужды.
 */
export function checkMachiningBounds(part: Part): HardwareValidationIssue[] {
  const issues: HardwareValidationIssue[] = [];
  for (const op of part.machining) {
    const radius = (op.diameter ?? 0) / 2;
    const outside =
      op.x - radius < -0.5 || op.y - radius < -0.5 ||
      op.x + radius > part.width + 0.5 || op.y + radius > part.height + 0.5;
    if (outside) {
      issues.push({
        severity: 'error',
        code: 'machining.outOfBounds',
        message: `Отверстие Ø${op.diameter ?? 0} в позиции ${Math.round(op.x)}×${Math.round(op.y)} выходит за пределы детали «${part.name}».`,
        partId: String(part.id),
      });
    }
    if ((op.depth ?? 0) > part.thickness + 0.5 && op.through !== true) {
      issues.push({
        severity: 'error',
        code: 'machining.tooDeep',
        message: `Глубина ${op.depth} мм больше толщины детали «${part.name}» (${part.thickness} мм).`,
        partId: String(part.id),
      });
    }
  }
  return issues;
}

/** Полная проверка фурнитуры проекта (§114). */
export function validateHardwarePlacement(project: Project): HardwareValidationIssue[] {
  const issues: HardwareValidationIssue[] = [];
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));

  for (const hardware of project.hardware) {
    if (hardware.archived) continue;
    issues.push(...validateHardwareItem(hardware));
  }

  const hardwareById = new Map(project.hardware.map((h) => [String(h.id), h]));
  for (const conn of project.hardwareConnections) {
    const hardware = hardwareById.get(String(conn.hardwareId));
    const part = parts.get(String(conn.partAId));
    if (!hardware || !part) continue;
    const compat = checkHardwareOnPart(hardware, part);
    if (compat) issues.push(compat);
  }

  for (const part of parts.values()) issues.push(...checkMachiningBounds(part));

  return issues;
}

/** Категория позиции в канонической номенклатуре §5 — для отчётов и таблиц. */
export function canonicalCategory(hardware: Hardware): string {
  return CANONICAL_OF_CATEGORY[hardware.category] ?? 'OTHER';
}
