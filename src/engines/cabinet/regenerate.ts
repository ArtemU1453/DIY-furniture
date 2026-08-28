/**
 * Пересчёт корпуса (§60/§61).
 *
 * Изменение параметра проходит один и тот же маршрут:
 *
 *   1. Validate      — проверка модели и лимитов
 *   2. Recalculate   — правила считают определения деталей
 *   3. Update Parts  — детали ProjectModel (стабильные ключи, override, ручные)
 *   4. Update Hardware / 5. Connections — пересборка узлов
 *   6. Update Machining — производная присадка (пересчитывается сама)
 *   7. Update Cutting / 8. 3D / 9. 2D — помечаются как требующие обновления
 *
 * АТОМАРНОСТЬ (§61). Функция ничего не пишет в проект: она возвращает готовый
 * результат. Если на любом шаге найдена ошибка, возвращается applied: false и
 * ПРЕЖНИЕ детали и соединения — частично перестроенной конструкции не бывает.
 */
import type { HardwareConnection, Part, Project } from '@/core/model/types';
import type { FurnitureId } from '@/core/model/ids';
import type { ParametricModel } from '@/core/parametric/types';
import { findFurniture } from '@/core/model/selectors';
import { generateParts, type GenerateResult } from '@/engines/parametric/generator';
import { validateParametricModel } from '@/engines/parametric/validator';
import { reconcileConnections } from '@/engines/connections/reconcile';
import { toCabinetModel } from './model';
import { checkCabinet, type CabinetIssue } from './collision';
import { affectedByFields } from './dependencies';

/** Шаг пересчёта — для отчёта пользователю и для тестов (§60). */
export interface RegenerationStep {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface RegenerationResult {
  /** Пересчёт применён целиком. false — модель осталась прежней (§61). */
  applied: boolean;
  parts: Part[];
  connections: HardwareConnection[];
  issues: CabinetIssue[];
  steps: RegenerationStep[];
  /** Узлы графа зависимостей, затронутые изменением (§59). */
  affected: string[];
  added: number;
  removed: number;
  changed: number;
}

/** Поля модели, значения которых различаются. */
export function changedFields(before: ParametricModel, after: ParametricModel): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const key of keys) {
    const a = (before as unknown as Record<string, unknown>)[key];
    const b = (after as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(key);
  }
  return out;
}

const failure = (
  parts: Part[],
  connections: HardwareConnection[],
  steps: RegenerationStep[],
  issues: CabinetIssue[],
): RegenerationResult => ({
  applied: false, parts, connections, issues, steps,
  affected: [], added: 0, removed: 0, changed: 0,
});

/**
 * Пересчитать изделие под новую модель.
 *
 * Возвращает НОВЫЕ детали и соединения; записывает их вызывающий код одной
 * командой, поэтому пересчёт целиком ложится в undo/redo (§116/§117).
 */
export interface RegenerationOptions {
  /** Прежняя модель — по ней считается список затронутых узлов графа. */
  previous?: ParametricModel;
  /**
   * strict: пересечение деталей отменяет пересчёт целиком (§61/§80).
   * По умолчанию пересечения и зазоры ВОЗВРАЩАЮТСЯ как issues, но пересчёт
   * применяется: иначе редактор застревал бы на промежуточном состоянии,
   * через которое пользователь проходит по пути к нужной конструкции.
   */
  strict?: boolean;
}

export function regenerateCabinet(
  project: Project,
  furnitureId: FurnitureId,
  next: ParametricModel,
  options: RegenerationOptions = {},
): RegenerationResult {
  const { previous, strict = false } = options;
  const furniture = findFurniture(project, furnitureId);
  const existingParts = furniture?.assemblies[0]?.parts ?? [];
  const existingConnections = project.hardwareConnections;
  const steps: RegenerationStep[] = [];

  if (!furniture) {
    return failure(existingParts, existingConnections,
      [{ id: 'validate', label: 'Проверка', ok: false, detail: 'Изделие не найдено.' }],
      [{ severity: 'error', code: 'cabinet.missing', message: 'Изделие не найдено.' }]);
  }

  // 1. Validate.
  const model = toCabinetModel(next);
  const validation = validateParametricModel(model);
  steps.push({ id: 'validate', label: 'Проверка параметров', ok: validation.ok });
  if (!validation.ok) {
    return failure(existingParts, existingConnections, steps,
      validation.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })));
  }

  // 2–3. Recalculate + Update Parts.
  const generated: GenerateResult = generateParts(model, existingParts);
  steps.push({
    id: 'parts', label: 'Детали', ok: generated.ok,
    detail: `+${generated.added.length} / −${generated.removed.length} / ~${generated.changed.length}`,
  });
  if (!generated.ok) {
    return failure(existingParts, existingConnections, steps,
      generated.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })));
  }

  // 4–5. Update Hardware + Connections.
  const reconciled = reconcileConnections(project, generated.parts, {
    jointCategory: model.jointType,
    construction: model.construction,
    handles: model.doors.handleEnabled,
  });
  steps.push({
    id: 'connections', label: 'Фурнитура и соединения', ok: true,
    detail: `+${reconciled.added.length} / −${reconciled.removed.length}`,
  });

  // 6. Machining — производная величина: пересчитывается сама из соединений.
  steps.push({ id: 'machining', label: 'Присадка', ok: true });

  /* Проверка конструкции идёт по НОВЫМ деталям, но по прежнему проекту:
   * пересечения и зазоры должны быть найдены ДО записи (§61/§80). */
  const check = checkCabinet(project, model, generated.parts);
  steps.push({ id: 'collision', label: 'Пересечения и зазоры', ok: check.ok });
  if (!check.ok && strict) {
    return failure(existingParts, existingConnections, steps, check.issues);
  }

  // 7–9. Раскрой, 3D и 2D — производные разделы, помечаются как затронутые.
  const affected = affectedByFields(previous ? changedFields(previous, model) : Object.keys(model));
  for (const id of ['cutting', 'view3d', 'view2d']) {
    steps.push({ id, label: id, ok: true, detail: affected.includes(id) ? 'обновить' : 'без изменений' });
  }

  return {
    applied: true,
    parts: generated.parts,
    connections: reconciled.connections,
    issues: check.issues,
    steps,
    affected,
    added: generated.added.length,
    removed: generated.removed.length,
    changed: generated.changed.length,
  };
}
