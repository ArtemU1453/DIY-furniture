/**
 * Массовая замена материалов и фурнитуры в проекте (§47/§48).
 *
 * Замена меняет ТОЛЬКО ссылку и толщину детали под новый материал; габариты
 * детали не трогаются (§46) — их задаёт конструкция, а не материал. Функции
 * чистые: возвращают план замены, а применяет его store одной командой, чтобы
 * операция попала в undo/redo целиком.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';

export interface MaterialReplacePlan {
  fromMaterialId: string;
  toMaterialId: string;
  /** Детали, которых коснётся замена. */
  partIds: string[];
  /** Читаемые номера — для подтверждения пользователем. */
  partLabels: string[];
  /** Меняется ли толщина: тогда раскрой и присадка станут DIRTY (§29). */
  thicknessChanges: boolean;
  fromThickness: number;
  toThickness: number;
}

/**
 * Спланировать замену материала. scope позволяет заменить не во всём проекте,
 * а только в выбранных деталях (§71).
 */
export function planMaterialReplace(
  project: Project,
  fromMaterialId: string,
  toMaterialId: string,
  scope?: { partIds?: string[] },
): MaterialReplacePlan | null {
  const from = project.materials.find((m) => String(m.id) === fromMaterialId);
  const to = project.materials.find((m) => String(m.id) === toMaterialId);
  if (!from || !to) return null;

  const limit = scope?.partIds ? new Set(scope.partIds) : null;
  const targets = allParts(project).filter((p) =>
    String(p.material) === fromMaterialId && (!limit || limit.has(String(p.id))));

  return {
    fromMaterialId,
    toMaterialId,
    partIds: targets.map((p) => String(p.id)),
    partLabels: targets.map((p) => (p.metadata?.number as string) ?? p.name),
    thicknessChanges: Math.abs(from.thickness - to.thickness) > 0.01,
    fromThickness: from.thickness,
    toThickness: to.thickness,
  };
}

export interface HardwareReplacePlan {
  fromHardwareId: string;
  toHardwareId: string;
  connectionIds: string[];
  connectionLabels: string[];
  /** Меняется ли категория: тогда изменится и присадка. */
  categoryChanges: boolean;
}

/** Спланировать замену фурнитуры во всех соединениях, где она применена. */
export function planHardwareReplace(
  project: Project,
  fromHardwareId: string,
  toHardwareId: string,
  scope?: { connectionIds?: string[] },
): HardwareReplacePlan | null {
  const from = project.hardware.find((h) => String(h.id) === fromHardwareId);
  const to = project.hardware.find((h) => String(h.id) === toHardwareId);
  if (!from || !to) return null;

  const limit = scope?.connectionIds ? new Set(scope.connectionIds) : null;
  const targets = project.hardwareConnections
    .map((c, i) => ({ c, code: `C${String(i + 1).padStart(3, '0')}` }))
    .filter(({ c }) => String(c.hardwareId) === fromHardwareId
      && (!limit || limit.has(String(c.id))));

  return {
    fromHardwareId,
    toHardwareId,
    connectionIds: targets.map(({ c }) => String(c.id)),
    connectionLabels: targets.map(({ code }) => code),
    categoryChanges: from.category !== to.category,
  };
}
