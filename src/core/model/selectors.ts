/**
 * Чистые селекторы модели: обход и поиск по вложенной структуре
 * Project → Furniture → Assembly → Part.
 *
 * Не мутируют модель. Используются и в UI (через store), и в движках.
 */
import type { FurnitureId, PartId } from './ids';
import type { Assembly, Furniture, Part, Project } from './types';

/** Плоский список всех деталей проекта (с учётом quantity — по одной записи). */
export function allParts(project: Project): Part[] {
  const out: Part[] = [];
  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      out.push(...a.parts);
    }
  }
  return out;
}

/** Суммарное количество деталей (с учётом quantity). */
export function totalPartCount(project: Project): number {
  return allParts(project).reduce((sum, p) => sum + p.quantity, 0);
}

/** Найти деталь по id. */
export function findPart(project: Project, partId: PartId): Part | undefined {
  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      const p = a.parts.find((x) => x.id === partId);
      if (p) return p;
    }
  }
  return undefined;
}

/** Найти сборку, содержащую деталь. */
export function findAssemblyOfPart(
  project: Project,
  partId: PartId,
): Assembly | undefined {
  for (const f of project.furnitures) {
    for (const a of f.assemblies) {
      if (a.parts.some((x) => x.id === partId)) return a;
    }
  }
  return undefined;
}

/** Первая сборка проекта (куда по умолчанию добавляются детали). */
export function firstAssembly(project: Project): Assembly | undefined {
  return project.furnitures[0]?.assemblies[0];
}

/** Первое изделие проекта. */
export function firstFurniture(project: Project): Furniture | undefined {
  return project.furnitures[0];
}

/** Найти изделие по id. */
export function findFurniture(project: Project, id: FurnitureId): Furniture | undefined {
  return project.furnitures.find((f) => f.id === id);
}

/** Найти изделие, содержащее деталь. */
export function findFurnitureOfPart(project: Project, partId: PartId): Furniture | undefined {
  return project.furnitures.find((f) =>
    f.assemblies.some((a) => a.parts.some((p) => p.id === partId)),
  );
}
