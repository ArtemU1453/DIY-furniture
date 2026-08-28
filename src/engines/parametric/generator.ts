/**
 * ParametricGenerator (§37–§45).
 *
 *   ParametricModel → PartDefinition[] → Part[]
 *
 * Ключевые свойства:
 *
 * СТАБИЛЬНЫЕ ID (§38/§39). Деталь узнаётся по ключу CABINET.SIDE.LEFT из
 * metadata.key. При пересчёте совпавшая по ключу деталь СОХРАНЯЕТ свой Part ID,
 * номер Pxxx, кромку и ручные операции присадки — поэтому чертежи, раскрой и
 * присадка не теряют ссылок, а бесконечных дублей не возникает.
 *
 * РУЧНЫЕ ДЕТАЛИ (§41/§42). Деталь без ключа генератора помечена
 * source: MANUAL и переживает любую регенерацию.
 *
 * OVERRIDE (§43/§44). Если пользователь правил поле параметрической детали,
 * оно записывается в metadata.overrides и переживает пересчёт, пока его не
 * сбросят. Остальные поля считает правило.
 */
import type { MachiningOperation, Part } from '@/core/model/types';
import { newPartId } from '@/core/model/ids';
import type {
  ParametricModel,
  PartDefinition,
  PartSource,
} from '@/core/parametric/types';
import { ROLE_TO_PART_ROLE } from '@/core/parametric/types';
import { buildDefinitions } from './rules';
import { validateParametricModel, type ParametricIssue } from './validator';

/** Поля детали, которые пользователь может переопределить вручную (§43). */
export type PartOverride = Partial<
  Pick<Part, 'name' | 'width' | 'height' | 'thickness' | 'material' | 'position' | 'quantity'>
>;

export interface GenerateResult {
  parts: Part[];
  /** Ключи деталей, добавленных этим пересчётом. */
  added: string[];
  /** Ключи деталей, удалённых из активной конфигурации (§40). */
  removed: string[];
  /** Ключи деталей, у которых изменилась геометрия. */
  changed: string[];
  /** Сохранённые ручные детали. */
  manual: string[];
  issues: ParametricIssue[];
  ok: boolean;
}

const keyOf = (p: Part): string | undefined => p.metadata?.key as string | undefined;

const numberOf = (p: Part): number => {
  const raw = p.metadata?.number as string | undefined;
  const n = raw ? Number(raw.replace(/^P/, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const pad = (n: number): string => `P${String(n).padStart(3, '0')}`;

/** Источник детали: сгенерирована правилом или добавлена вручную (§42). */
export function partSource(part: Part): PartSource {
  const explicit = part.metadata?.source as PartSource | undefined;
  if (explicit) return explicit;
  return keyOf(part) ? 'PARAMETRIC' : 'MANUAL';
}

/** Ручные правки детали, пережившие пересчёт (§43). */
export function partOverrides(part: Part): PartOverride {
  return (part.metadata?.overrides as PartOverride | undefined) ?? {};
}

export function hasOverride(part: Part): boolean {
  return Object.keys(partOverrides(part)).length > 0;
}

/**
 * Конструктивная операция присадки (§25/§48 этапа 28): порождена
 * параметрическим правилом, а не фурнитурой и не пользователем. Такие операции
 * пересчитываются вместе с деталью, поэтому старые снимаются перед записью
 * новых, а ручные остаются нетронутыми.
 */
export function isConstructionOperation(op: MachiningOperation): boolean {
  return String(op.id).startsWith('cab:');
}

/** Привязать конструктивные операции определения к идентификатору детали. */
function constructionOps(def: PartDefinition, partId: Part['id']): MachiningOperation[] {
  return (def.machining ?? []).map((op) => ({ ...op, partId }));
}

/** Определение → деталь ProjectModel. */
function definitionToPart(def: PartDefinition, number: number): Part {
  const id = newPartId();
  return {
    id,
    name: def.name,
    role: ROLE_TO_PART_ROLE[def.role],
    width: def.width,
    height: def.height,
    thickness: def.thickness,
    material: def.materialId,
    grain: 'none',
    quantity: 1,
    edges: { left: null, right: null, top: null, bottom: null },
    position: def.position,
    rotation: def.rotation,
    metadata: {
      ...def.metadata,
      key: def.id,
      source: 'PARAMETRIC' satisfies PartSource,
      number: pad(number),
      parametricRole: def.role,
    },
    machining: constructionOps(def, id),
  };
}

/** Геометрия детали изменилась (для отчёта о пересчёте). */
function geometryChanged(a: Part, b: Part): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return !eq(a.width, b.width) || !eq(a.height, b.height) || !eq(a.thickness, b.thickness)
    || !eq(a.position.x, b.position.x) || !eq(a.position.y, b.position.y) || !eq(a.position.z, b.position.z);
}

/**
 * Пересобрать детали изделия из параметрической модели.
 *
 * Возвращает НОВЫЙ список деталей; вызывающий код (store) записывает его в
 * ProjectModel одной командой, поэтому операция целиком попадает в undo/redo.
 * При ошибке валидации детали не трогаются: повреждённая геометрия в модель
 * не попадает (§66).
 */
export function generateParts(model: ParametricModel, existing: Part[] = []): GenerateResult {
  const validation = validateParametricModel(model);
  if (!validation.ok) {
    return {
      parts: existing, added: [], removed: [], changed: [],
      manual: existing.filter((p) => partSource(p) === 'MANUAL').map((p) => String(p.id)),
      issues: validation.issues, ok: false,
    };
  }

  const definitions = buildDefinitions(model);
  const byKey = new Map<string, Part>();
  for (const p of existing) {
    const k = keyOf(p);
    if (k) byKey.set(k, p);
  }

  let maxNumber = existing.reduce((m, p) => Math.max(m, numberOf(p)), 0);
  const added: string[] = [];
  const changed: string[] = [];

  const parts: Part[] = definitions.map((def) => {
    const prev = byKey.get(def.id);
    if (!prev) {
      maxNumber += 1;
      added.push(def.id);
      return definitionToPart(def, maxNumber);
    }

    // Совпала по ключу: пересчитываем геометрию, но сохраняем идентичность.
    const regenerated: Part = {
      ...definitionToPart(def, numberOf(prev) || ++maxNumber),
      id: prev.id,
      edges: prev.edges,
      /* Ручные операции переживают пересчёт, конструктивные пересчитываются:
       * паз под заднюю стенку обязан поехать вместе с деталью (§25/§60). */
      machining: [
        ...constructionOps(def, prev.id),
        ...prev.machining.filter((op) => !isConstructionOperation(op)),
      ],
      quantity: prev.quantity,
      grain: prev.grain,
      metadata: {
        ...prev.metadata,
        ...def.metadata,
        key: def.id,
        source: 'PARAMETRIC' satisfies PartSource,
        number: prev.metadata?.number ?? pad(numberOf(prev) || maxNumber),
        parametricRole: def.role,
      },
    };

    // Ручные правки поверх расчёта (§43).
    const overrides = partOverrides(prev);
    const withOverrides: Part = Object.keys(overrides).length > 0
      ? { ...regenerated, ...overrides, metadata: { ...regenerated.metadata, overrides } }
      : regenerated;

    if (geometryChanged(prev, withOverrides)) changed.push(def.id);
    return withOverrides;
  });

  // Ручные детали переживают регенерацию (§41).
  const manualParts = existing.filter((p) => partSource(p) === 'MANUAL');
  const activeKeys = new Set(definitions.map((d) => d.id));
  // Параметрические детали, выпавшие из конфигурации, удаляются (§40).
  const removed = [...byKey.keys()].filter((k) => !activeKeys.has(k));

  return {
    parts: [...parts, ...manualParts],
    added,
    removed,
    changed,
    manual: manualParts.map((p) => String(p.id)),
    issues: validation.issues,
    ok: true,
  };
}

// ── Override (§43/§44) ───────────────────────────────────────────────────────

/** Записать ручную правку поля параметрической детали. */
export function applyOverride(part: Part, patch: PartOverride): Part {
  const overrides = { ...partOverrides(part), ...patch };
  return { ...part, ...patch, metadata: { ...part.metadata, overrides } };
}

/**
 * «Вернуть расчётное значение» (§44): убрать правки и отдать деталь под
 * управление правила. Геометрию вернёт следующий пересчёт.
 */
export function resetOverride(part: Part, fields?: Array<keyof PartOverride>): Part {
  const current = partOverrides(part);
  if (!fields || fields.length === 0) {
    const metadata = { ...part.metadata };
    delete metadata.overrides;
    return { ...part, metadata };
  }
  const next: PartOverride = { ...current };
  for (const f of fields) delete next[f];
  const metadata = { ...part.metadata };
  if (Object.keys(next).length === 0) delete metadata.overrides;
  else metadata.overrides = next;
  return { ...part, metadata };
}
