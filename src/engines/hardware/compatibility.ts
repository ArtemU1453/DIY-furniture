/**
 * HardwareCompatibilityRule (§39–§41).
 *
 * Несовместимость — ПРЕДУПРЕЖДЕНИЕ, а не запрет: крепёж часто ставят «на
 * грани» диапазона, и решать это должен человек, а не программа. Ошибкой
 * считается только то, что физически не собирается.
 */
import type { Hardware, HardwareConnection, Part, Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { findHardware } from './status';
import type { HardwareIssue } from './status';

export interface HardwareCompatibilityRule {
  id: string;
  name: string;
  /** Проверить крепёж на конкретной детали. */
  check(hardware: Hardware, part: Part, project: Project): HardwareIssue[];
}

/** Диапазон толщины детали, на который рассчитан крепёж (§41). */
export const thicknessRule: HardwareCompatibilityRule = {
  id: 'THICKNESS',
  name: 'Толщина детали в диапазоне крепежа',
  check(hardware, part) {
    const range = hardware.thicknessRange;
    if (!range) return [];
    const at = { hardwareId: String(hardware.id) };
    if (range.min != null && part.thickness < range.min) {
      return [{
        severity: 'warning',
        code: 'hardware.thicknessBelow',
        message: `«${hardware.name}» рассчитан на толщину от ${range.min} мм, деталь ${part.thickness} мм.`,
        ...at,
      }];
    }
    if (range.max != null && part.thickness > range.max) {
      return [{
        severity: 'warning',
        code: 'hardware.thicknessAbove',
        message: `«${hardware.name}» рассчитан на толщину до ${range.max} мм, деталь ${part.thickness} мм.`,
        ...at,
      }];
    }
    return [];
  },
};

/** Список совместимых материалов плиты (§2/§39). */
export const materialRule: HardwareCompatibilityRule = {
  id: 'MATERIAL',
  name: 'Материал детали в списке совместимых',
  check(hardware, part, project) {
    const allowed = hardware.compatibleMaterials;
    // Пустой список означает «совместим с любыми» — так позиции прошлых
    // этапов продолжают работать без правки.
    if (!allowed || allowed.length === 0 || !part.material) return [];
    if (allowed.some((m) => String(m) === String(part.material))) return [];
    const name = project.materials.find((m) => m.id === part.material)?.name ?? 'материалом детали';
    return [{
      severity: 'warning',
      code: 'hardware.materialMismatch',
      message: `«${hardware.name}» не заявлен как совместимый с «${name}».`,
      hardwareId: String(hardware.id),
    }];
  },
};

/**
 * Глубина чашки петли не должна превышать толщину фасада — это уже не
 * «на грани», а сквозное отверстие, поэтому ошибка.
 */
export const cupDepthRule: HardwareCompatibilityRule = {
  id: 'CUP_DEPTH',
  name: 'Чашка петли не глубже фасада',
  check(hardware, part) {
    if (hardware.category !== 'hinge') return [];
    const depth = Number(hardware.parameters?.cupDepth ?? 0);
    if (depth > 0 && depth >= part.thickness) {
      return [{
        severity: 'error',
        code: 'hardware.cupTooDeep',
        message: `Чашка петли ${depth} мм не помещается в фасад толщиной ${part.thickness} мм.`,
        hardwareId: String(hardware.id),
      }];
    }
    return [];
  },
};

const REGISTRY: HardwareCompatibilityRule[] = [thicknessRule, materialRule, cupDepthRule];

export function compatibilityRules(): HardwareCompatibilityRule[] {
  return [...REGISTRY];
}

export function registerCompatibilityRule(rule: HardwareCompatibilityRule): void {
  const at = REGISTRY.findIndex((r) => r.id === rule.id);
  if (at >= 0) REGISTRY[at] = rule;
  else REGISTRY.push(rule);
}

/** Проверить одно соединение по всем правилам. */
export function checkConnectionCompatibility(
  project: Project,
  connection: HardwareConnection,
): HardwareIssue[] {
  const hardware = findHardware(project, connection.hardwareId);
  if (!hardware) return [];
  const issues: HardwareIssue[] = [];
  for (const partId of [connection.partAId, connection.partBId]) {
    const part = findPart(project, partId);
    if (!part) continue;
    for (const rule of REGISTRY) {
      for (const issue of rule.check(hardware, part, project)) {
        issues.push({ ...issue, connectionId: String(connection.id) });
      }
    }
  }
  // Одна и та же проблема на обеих деталях узла — одно сообщение.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Совместимость всей фурнитуры проекта. */
export function validateHardwareCompatibility(project: Project): HardwareIssue[] {
  return project.hardwareConnections.flatMap((c) => checkConnectionCompatibility(project, c));
}
