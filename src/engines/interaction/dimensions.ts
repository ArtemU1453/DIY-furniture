/**
 * Размеры прямо в рабочей области (§44–§53).
 *
 * Размер ПРИВЯЗАН к геометрическим точкам детали (§52), а не хранит число:
 * значение всегда считается из модели, поэтому после любого пересчёта размеры
 * обновляются сами (§53). Редактирование размера — это изменение параметра
 * или Override детали, а не правка подписи.
 */
import type { Part, Vec3 } from '@/core/model/types';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { checkSize, DEFAULT_SIZE_LIMITS, type SizeField, type SizeLimits } from './resize';

/** Тип размера (§51). */
export type DimensionKind = 'linear' | 'horizontal' | 'vertical' | 'depth' | 'angle';

/** Якорь размера: две точки модели, между которыми он меряется (§52). */
export interface DimensionAnchor {
  from: Vec3;
  to: Vec3;
}

export interface LiveDimension {
  id: string;
  kind: DimensionKind;
  /** Деталь, к которой относится размер. */
  partId: string;
  /** Поле модели, которое правится при редактировании; пусто — справочный. */
  field?: SizeField;
  anchor: DimensionAnchor;
  /** Текущее значение, мм (или градусы для angle). */
  value: number;
  label: string;
  /** Значение вычисляется правилом (§101). */
  computed: boolean;
  /** Значение переопределено вручную (§137). */
  overridden: boolean;
}

const mid = (a: number, b: number): number => (a + b) / 2;

/** Три габаритных размера детали плюс угол поворота (§51/§56). */
export function dimensionsOfPart(part: Part, options: { computed?: boolean; overridden?: string[] } = {}): LiveDimension[] {
  const box = partWorldAABB(part);
  const id = String(part.id);
  const overridden = new Set(options.overridden ?? []);
  const computed = options.computed ?? true;

  const make = (
    kind: DimensionKind,
    field: SizeField | undefined,
    value: number,
    from: Vec3,
    to: Vec3,
    label: string,
  ): LiveDimension => ({
    id: `${id}:${kind}`,
    kind,
    partId: id,
    field,
    anchor: { from, to },
    value,
    label,
    computed,
    overridden: field ? overridden.has(field) : false,
  });

  return [
    make('horizontal', 'width', part.width,
      { x: box.min.x, y: box.min.y, z: mid(box.min.z, box.max.z) },
      { x: box.max.x, y: box.min.y, z: mid(box.min.z, box.max.z) },
      'Ширина'),
    make('vertical', 'height', part.height,
      { x: box.min.x, y: box.min.y, z: mid(box.min.z, box.max.z) },
      { x: box.min.x, y: box.max.y, z: mid(box.min.z, box.max.z) },
      'Высота'),
    make('depth', 'thickness', part.thickness,
      { x: mid(box.min.x, box.max.x), y: box.min.y, z: box.min.z },
      { x: mid(box.min.x, box.max.x), y: box.min.y, z: box.max.z },
      'Толщина'),
    make('angle', undefined, part.rotation.y,
      { x: box.min.x, y: box.min.y, z: box.min.z },
      { x: box.max.x, y: box.min.y, z: box.min.z },
      'Поворот Y'),
  ];
}

/** Длина размера по его якорю — она и есть отображаемое значение (§52/§53). */
export function anchorLength(anchor: DimensionAnchor): number {
  const dx = anchor.to.x - anchor.from.x;
  const dy = anchor.to.y - anchor.from.y;
  const dz = anchor.to.z - anchor.from.z;
  return Math.hypot(dx, dy, dz);
}

// ── Редактирование размера (§45–§50) ─────────────────────────────────────────

export interface DimensionEdit {
  dimensionId: string;
  partId: string;
  field?: SizeField;
  /** Значение на момент открытия — к нему возвращает Esc (§50). */
  original: number;
  /** Что набирает пользователь. */
  draft: string;
}

/** Клик по размеру открывает редактирование (§45). */
export function beginDimensionEdit(dimension: LiveDimension): DimensionEdit {
  return {
    dimensionId: dimension.id,
    partId: dimension.partId,
    field: dimension.field,
    original: dimension.value,
    draft: String(Math.round(dimension.value * 100) / 100),
  };
}

export interface DimensionValidation {
  ok: boolean;
  value: number;
  message?: string;
}

/**
 * Проверка вводимого значения (§47). Ноль, отрицательное и выход за пределы
 * не принимаются: в модель такое значение не попадёт.
 */
export function validateDimensionInput(
  edit: DimensionEdit,
  raw: string,
  limits: SizeLimits = DEFAULT_SIZE_LIMITS,
): DimensionValidation {
  const value = Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(value)) {
    return { ok: false, value: edit.original, message: 'Введите число.' };
  }
  if (!edit.field) {
    // Справочный размер (угол): только конечное число.
    return { ok: true, value };
  }
  const refusal = checkSize(edit.field, value, limits);
  return refusal
    ? { ok: false, value: edit.original, message: refusal.message }
    : { ok: true, value };
}

/** Предпросмотр до подтверждения (§48): что станет с деталью. */
export interface DimensionPreview {
  ok: boolean;
  before: number;
  after: number;
  delta: number;
  message?: string;
}

export function previewDimension(
  edit: DimensionEdit,
  raw: string,
  limits: SizeLimits = DEFAULT_SIZE_LIMITS,
): DimensionPreview {
  const validation = validateDimensionInput(edit, raw, limits);
  return {
    ok: validation.ok,
    before: edit.original,
    after: validation.value,
    delta: validation.value - edit.original,
    message: validation.message,
  };
}

/** Esc — вернуть исходное значение (§50). */
export function cancelDimensionEdit(edit: DimensionEdit): number {
  return edit.original;
}
