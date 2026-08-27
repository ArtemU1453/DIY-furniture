/**
 * Использование объектов библиотеки в проекте (§49–§51).
 *
 * Показывает, где применён материал, кромка или фурнитура, и даёт usedCount,
 * по которому решается, можно ли удалять запись или её нужно архивировать.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';

export interface UsageInfo {
  /** Сколько объектов ссылается. */
  usedCount: number;
  /** Читаемые номера мест использования: P001, C002 … */
  references: string[];
}

const partLabel = (p: { metadata?: Record<string, unknown>; name: string }): string =>
  (p.metadata?.number as string) ?? p.name;

/** Где используется материал: детали проекта (§49). */
export function materialUsage(project: Project, materialId: string): UsageInfo {
  const references = allParts(project)
    .filter((p) => String(p.material) === materialId)
    .map(partLabel);
  return { usedCount: references.length, references };
}

/** Где используется кромка: стороны деталей. */
export function edgeUsage(project: Project, edgeId: string): UsageInfo {
  const references: string[] = [];
  for (const part of allParts(project)) {
    const sides = (['left', 'right', 'top', 'bottom'] as const)
      .filter((s) => String(part.edges[s]) === edgeId);
    if (sides.length > 0) references.push(`${partLabel(part)} (${sides.length})`);
  }
  return { usedCount: references.length, references };
}

/** Где используется фурнитура: соединения (§50). */
export function hardwareUsage(project: Project, hardwareId: string): UsageInfo {
  const references = project.hardwareConnections
    .map((c, i) => ({ c, code: `C${String(i + 1).padStart(3, '0')}` }))
    .filter(({ c }) => String(c.hardwareId) === hardwareId)
    .map(({ code }) => code);
  return { usedCount: references.length, references };
}

/** Использование профиля: назначен ли он проекту. */
export function profileUsage(project: Project, profileId: string): UsageInfo {
  const used = project.machining.profile?.id === profileId;
  return { usedCount: used ? 1 : 0, references: used ? ['Профиль проекта'] : [] };
}

/** Сводка использования по всем материалам проекта — для библиотеки. */
export function materialUsageMap(project: Project): Map<string, UsageInfo> {
  const map = new Map<string, UsageInfo>();
  for (const m of project.materials) map.set(String(m.id), materialUsage(project, String(m.id)));
  return map;
}

export function hardwareUsageMap(project: Project): Map<string, UsageInfo> {
  const map = new Map<string, UsageInfo>();
  for (const h of project.hardware) map.set(String(h.id), hardwareUsage(project, String(h.id)));
  return map;
}
