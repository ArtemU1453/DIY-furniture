/**
 * Состояние модуля и инвалидация зависимостей (§16/§65–§69).
 *
 * Ключевое свойство — АТОМАРНОСТЬ (§16/§69): новый модуль становится активным
 * только после успешной генерации. Если генерация упала, остаётся прежний
 * корректный модуль — проект не должен оставаться в промежуточном состоянии.
 */
import type { Project } from '@/core/model/types';
import { validateParametricModel, type ParametricIssue } from './validator';
import { generateParts } from './generator';
import { flattenModules, type FurnitureModule, type ModuleStatusKind } from './modules';

/** Разделы, которые устаревают вслед за модулем (§68). */
export const DEPENDENT_SECTIONS = [
  'parts', 'hardware', 'edge', 'machining', 'cutting', 'documents',
] as const;

export type DependentSection = typeof DEPENDENT_SECTIONS[number];

/** Пометить модуль изменённым (§66). */
export function markDirty(module: FurnitureModule): FurnitureModule {
  return { ...module, status: 'DIRTY' };
}

/** Состояние модуля по результатам проверки его параметров. */
export function statusOfModule(module: FurnitureModule): ModuleStatusKind {
  const report = validateParametricModel(module.parameters);
  if (report.errors > 0) return 'ERROR';
  if (report.warnings > 0) return 'WARNING';
  return module.status === 'DIRTY' ? 'DIRTY' : 'VALID';
}

export interface ModuleGenerationOutcome {
  ok: boolean;
  /** Модуль после генерации: новый при успехе, прежний при ошибке (§16). */
  module: FurnitureModule;
  errors: string[];
  warnings: string[];
  partCount: number;
}

/**
 * Атомарная генерация модуля (§15/§16).
 *
 * При ошибке возвращается ПРЕЖНИЙ модуль со статусом ERROR: правка, которая
 * не собирается, не должна разрушать уже работающую конструкцию.
 */
export function generateModule(
  module: FurnitureModule,
  previous?: FurnitureModule,
): ModuleGenerationOutcome {
  const report = validateParametricModel(module.parameters);
  const issues: ParametricIssue[] = report.issues;
  const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = issues.filter((i) => i.severity !== 'error').map((i) => i.message);

  if (errors.length > 0) {
    return {
      ok: false,
      module: previous ? { ...previous, status: 'ERROR' } : { ...module, status: 'ERROR' },
      errors,
      warnings,
      partCount: previous?.parts.length ?? 0,
    };
  }

  const result = generateParts(module.parameters, []);
  if (!result.ok) {
    const generationErrors = result.issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message);
    return {
      ok: false,
      module: previous ? { ...previous, status: 'ERROR' } : { ...module, status: 'ERROR' },
      errors: generationErrors.length > 0 ? generationErrors : ['Не удалось построить детали модуля.'],
      warnings,
      partCount: previous?.parts.length ?? 0,
    };
  }

  // Успех: модуль становится актуальным, ключи деталей обновляются (§67).
  return {
    ok: true,
    module: {
      ...module,
      status: 'VALID',
      parts: result.parts.map((p) => (p.metadata?.key as string) ?? String(p.id)),
    },
    errors: [],
    warnings,
    partCount: result.parts.length,
  };
}

/**
 * Изоляция зависимостей (§113/§155): изменение одного модуля помечает
 * устаревшим только ЕГО поддерево, а не весь проект.
 */
export function invalidateModule(root: FurnitureModule, moduleId: string): FurnitureModule {
  const walk = (m: FurnitureModule): FurnitureModule => {
    if (m.id === moduleId) {
      // Сам модуль и всё, что внутри него, зависят от изменившихся параметров.
      const dirty = (x: FurnitureModule): FurnitureModule => ({
        ...x, status: 'DIRTY', children: x.children.map(dirty),
      });
      return dirty(m);
    }
    return { ...m, children: m.children.map(walk) };
  };
  return walk(root);
}

/** Модули, требующие пересчёта. */
export function dirtyModules(root: FurnitureModule): FurnitureModule[] {
  return flattenModules(root).filter((m) => m.status === 'DIRTY' || m.status === 'OUTDATED');
}

/** Устарели ли производные разделы проекта после правки модуля (§68). */
export function invalidatedSections(module: FurnitureModule): DependentSection[] {
  return module.status === 'DIRTY' || module.status === 'OUTDATED' ? [...DEPENDENT_SECTIONS] : [];
}

/** Пересчитать статусы дерева, не трогая сами параметры. */
export function refreshStatuses(root: FurnitureModule): FurnitureModule {
  const walk = (m: FurnitureModule): FurnitureModule => ({
    ...m,
    status: statusOfModule(m),
    children: m.children.map(walk),
  });
  return walk(root);
}

/** Все модули проекта, вычисленные из его изделий. */
export function projectModuleCount(project: Project): number {
  return project.furnitures.length;
}
