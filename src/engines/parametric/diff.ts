/**
 * ParametricDiff (§67/§68) — что изменится при применении новых параметров.
 *
 * Показывается ДО регенерации, поэтому пользователь видит последствия крупной
 * правки: какие детали добавятся, исчезнут и изменятся, и какие модули станут
 * DIRTY/OUTDATED (§69).
 */
import type { Part } from '@/core/model/types';
import type { ParametricModel } from '@/core/parametric/types';
import { buildDefinitions } from './rules';
import { generateParts, partSource } from './generator';

export interface ParameterChange {
  field: string;
  label: string;
  before: string;
  after: string;
  /** Влияет ли на геометрию, а значит на раскрой и документы. */
  affectsGeometry: boolean;
}

export interface PartChange {
  key: string;
  name: string;
  before?: string;
  after?: string;
}

export interface ParametricDiff {
  parameters: ParameterChange[];
  addedParts: PartChange[];
  removedParts: PartChange[];
  changedParts: PartChange[];
  /** Соединения пересчитываются, если изменился состав или геометрия деталей. */
  connectionsAffected: boolean;
  cuttingDirty: boolean;
  documentsOutdated: boolean;
  machiningDirty: boolean;
  /** Есть ли вообще изменения. */
  empty: boolean;
}

const fmt = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const size = (p: { width: number; height: number; thickness: number }): string =>
  `${Math.round(p.width)}×${Math.round(p.height)}×${p.thickness}`;

/** Поля модели, попадающие в отчёт, и влияют ли они на геометрию. */
const FIELDS: Array<{ path: string; label: string; geometry: boolean; get: (m: ParametricModel) => unknown }> = [
  { path: 'width', label: 'Ширина', geometry: true, get: (m) => m.width },
  { path: 'height', label: 'Высота', geometry: true, get: (m) => m.height },
  { path: 'depth', label: 'Глубина', geometry: true, get: (m) => m.depth },
  { path: 'thickness', label: 'Толщина материала', geometry: true, get: (m) => m.thickness },
  { path: 'materialId', label: 'Материал', geometry: true, get: (m) => m.materialId },
  { path: 'construction', label: 'Схема корпуса', geometry: true, get: (m) => m.construction },
  { path: 'shelves.count', label: 'Полки', geometry: true, get: (m) => m.shelves.count },
  { path: 'shelves.distribution', label: 'Распределение полок', geometry: true, get: (m) => m.shelves.distribution },
  { path: 'partitions.count', label: 'Перегородки', geometry: true, get: (m) => m.partitions.count },
  { path: 'doors.count', label: 'Фасады', geometry: true, get: (m) => m.doors.count },
  { path: 'doors.gaps.betweenGap', label: 'Зазор между фасадами', geometry: true, get: (m) => m.doors.gaps.betweenGap },
  { path: 'backPanel.type', label: 'Задняя стенка', geometry: true, get: (m) => m.backPanel.type },
  { path: 'backPanel.thickness', label: 'Толщина задней стенки', geometry: true, get: (m) => m.backPanel.thickness },
  { path: 'legs.enabled', label: 'Ножки', geometry: true, get: (m) => m.legs.enabled },
  { path: 'legs.height', label: 'Высота ножек', geometry: true, get: (m) => m.legs.height },
  { path: 'plinth.enabled', label: 'Цоколь', geometry: true, get: (m) => m.plinth.enabled },
  { path: 'jointType', label: 'Тип соединения', geometry: false, get: (m) => m.jointType },
  { path: 'kind', label: 'Тип изделия', geometry: true, get: (m) => m.kind },
];

/**
 * Сравнить текущую и предлагаемую модель. existing — детали проекта, чтобы
 * показать, какие из них добавятся, исчезнут или изменятся.
 */
export function diffParametric(
  before: ParametricModel,
  after: ParametricModel,
  existing: Part[] = [],
): ParametricDiff {
  const parameters: ParameterChange[] = [];
  for (const f of FIELDS) {
    const a = fmt(f.get(before));
    const b = fmt(f.get(after));
    if (a === b) continue;
    parameters.push({ field: f.path, label: f.label, before: a, after: b, affectsGeometry: f.geometry });
  }

  // Пользовательские параметры с выражениями.
  const beforeParams = new Map(before.parameters.map((p) => [p.id, p]));
  for (const p of after.parameters) {
    const prev = beforeParams.get(p.id);
    if (!prev) {
      parameters.push({ field: p.id, label: p.name, before: '—', after: fmt(p.value), affectsGeometry: false });
    } else if (fmt(prev.value) !== fmt(p.value) || prev.expression !== p.expression) {
      parameters.push({ field: p.id, label: p.name, before: fmt(prev.value), after: fmt(p.value), affectsGeometry: false });
    }
  }

  // Состав деталей: сравниваем определения обеих моделей.
  const beforeDefs = new Map(buildDefinitions(before).map((d) => [d.id, d]));
  const afterDefs = new Map(buildDefinitions(after).map((d) => [d.id, d]));
  const existingByKey = new Map(
    existing.filter((p) => partSource(p) === 'PARAMETRIC')
      .map((p) => [String(p.metadata?.key ?? ''), p]),
  );

  const addedParts: PartChange[] = [];
  const removedParts: PartChange[] = [];
  const changedParts: PartChange[] = [];

  for (const [key, def] of afterDefs) {
    if (!beforeDefs.has(key)) {
      addedParts.push({ key, name: def.name, after: size(def) });
      continue;
    }
    const prev = beforeDefs.get(key)!;
    if (size(prev) !== size(def)) {
      changedParts.push({ key, name: def.name, before: size(prev), after: size(def) });
    }
  }
  for (const [key, def] of beforeDefs) {
    if (!afterDefs.has(key)) {
      const part = existingByKey.get(key);
      removedParts.push({ key, name: part?.name ?? def.name, before: size(def) });
    }
  }

  const geometryChanged = parameters.some((p) => p.affectsGeometry)
    || addedParts.length > 0 || removedParts.length > 0 || changedParts.length > 0;
  const jointChanged = before.jointType !== after.jointType;

  return {
    parameters,
    addedParts,
    removedParts,
    changedParts,
    connectionsAffected: geometryChanged || jointChanged,
    // Раскрой зависит от размеров и состава деталей (§69).
    cuttingDirty: geometryChanged,
    documentsOutdated: geometryChanged || jointChanged || parameters.length > 0,
    machiningDirty: geometryChanged || jointChanged,
    empty: parameters.length === 0 && addedParts.length === 0
      && removedParts.length === 0 && changedParts.length === 0,
  };
}

/** Краткое описание изменения для истории (§53). */
export function describeDiff(diff: ParametricDiff): string {
  if (diff.empty) return 'Без изменений';
  const parts: string[] = [];
  for (const p of diff.parameters.slice(0, 3)) parts.push(`${p.label}: ${p.before} → ${p.after}`);
  if (diff.parameters.length > 3) parts.push(`и ещё ${diff.parameters.length - 3}`);
  const counts: string[] = [];
  if (diff.addedParts.length) counts.push(`+${diff.addedParts.length} дет.`);
  if (diff.removedParts.length) counts.push(`−${diff.removedParts.length} дет.`);
  if (counts.length) parts.push(counts.join(', '));
  return parts.join('; ');
}

/** Предпросмотр без применения (§67): что даст пересчёт. */
export function previewRegeneration(
  before: ParametricModel,
  after: ParametricModel,
  existing: Part[] = [],
): { diff: ParametricDiff; ok: boolean; issues: string[] } {
  const diff = diffParametric(before, after, existing);
  const result = generateParts(after, existing);
  return {
    diff,
    ok: result.ok,
    issues: result.issues.filter((i) => i.severity === 'error').map((i) => i.message),
  };
}
