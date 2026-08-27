/**
 * Единые обозначения на чертежах и в спецификациях (§14–§17, §19, §33).
 *
 * Один формат на весь проект: если отверстие где-то обозначено «Ø8 × 12», то
 * так же оно выглядит и в таблице присадки, и в CSV. Ничего не пересчитывается
 * заново — значения берутся из Part / MachiningOperation / Material.
 */
import type {
  EdgeSide,
  MachiningOperation,
  Material,
  Part,
  PartFace,
  Project,
  DatumReference,
} from '@/core/model/types';

// ── Точность (§33) ───────────────────────────────────────────────────────────

/**
 * Размер в мм без потери точности: целое печатается как целое (800),
 * дробное — с нужным числом знаков (153.5), хвостовые нули убираются.
 * Никакого «округления до целых по умолчанию».
 */
export function fmtMm(value: number, maxDigits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(maxDigits));
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/\.?0+$/, '');
}

/** Размер с единицей: «800 мм», «153.5 мм». */
export function fmtMmUnit(value: number, maxDigits = 2): string {
  return `${fmtMm(value, maxDigits)} мм`;
}

// ── Обозначение отверстий (§15) ──────────────────────────────────────────────

/**
 * Сквозное:      Ø5 THRU
 * Глухое:        Ø8 × 12
 * Без диаметра:  паз/выборка — по типу операции.
 */
export function holeNotation(op: Pick<MachiningOperation, 'diameter' | 'depth' | 'through' | 'type'>): string {
  const d = op.diameter;
  if (d == null || !(d > 0)) {
    if (op.type === 'slot') return 'Паз';
    if (op.type === 'pocket') return 'Выборка';
    return '—';
  }
  if (op.through) return `Ø${fmtMm(d)} THRU`;
  const depth = op.depth;
  if (depth == null || !(depth > 0)) return `Ø${fmtMm(d)}`;
  return `Ø${fmtMm(d)} × ${fmtMm(depth)}`;
}

// ── Базы (§14) ───────────────────────────────────────────────────────────────

/**
 * Правило выбора базы — фиксированное, не случайное:
 *
 *   A — нижняя грань детали (отсчёт по высоте, координата Y)
 *   B — левая грань детали  (отсчёт по ширине, координата X)
 *   C — передняя грань детали (отсчёт по толщине)
 *
 * Для присадки база выбирается по обрабатываемой поверхности: у пласти
 * (front/back) отсчёт идёт от левого-нижнего угла, поэтому база — B (X) и
 * A (Y); ведущей считаем ту, вдоль которой лежит длинная сторона грани.
 * Для торцов (left/right/top/bottom) ведущей базой становится C.
 */
export function datumForFace(face: PartFace): DatumReference {
  switch (face) {
    case 'front':
    case 'back':
      return 'B'; // отсчёт от левой грани по X, от нижней по Y
    case 'left':
    case 'right':
      return 'C'; // торец: отсчёт по толщине от передней грани
    case 'top':
    case 'bottom':
      return 'C';
  }
}

export const DATUM_LABELS: Record<DatumReference, string> = {
  A: 'A — нижняя грань',
  B: 'B — левая грань',
  C: 'C — передняя грань',
};

/** База операции: явно заданная в модели или выведенная по правилу. */
export function operationDatum(op: Pick<MachiningOperation, 'face' | 'datum'>): DatumReference {
  return op.datum ?? datumForFace(op.face);
}

// ── Кромка (§16) ─────────────────────────────────────────────────────────────

/**
 * Стороны кромки нумеруются единообразно во всём проекте:
 *   L1 — низ, L2 — право, L3 — верх, L4 — лево (обход по часовой от низа).
 */
export const EDGE_CODES: Record<EdgeSide, string> = {
  bottom: 'L1',
  right: 'L2',
  top: 'L3',
  left: 'L4',
};

export const EDGE_SIDE_ORDER: EdgeSide[] = ['bottom', 'right', 'top', 'left'];

export const EDGE_SIDE_LABELS: Record<EdgeSide, string> = {
  bottom: 'Низ',
  right: 'Право',
  top: 'Верх',
  left: 'Лево',
};

/** Толщина кромки на стороне детали (мм) или 0, если кромки нет. */
export function edgeThickness(project: Project, part: Part, side: EdgeSide): number {
  const id = part.edges[side];
  if (!id) return 0;
  return project.edges.find((e) => e.id === id)?.thickness ?? 0;
}

/** Обозначение кромки стороны: «2» / «0.4» / «—» (нет кромки). */
export function edgeValue(project: Project, part: Part, side: EdgeSide): string {
  const t = edgeThickness(project, part, side);
  return t > 0 ? fmtMm(t) : '—';
}

/**
 * Компактная запись кромки детали в порядке L1–L4: «0.4/2/2/0.4».
 * Используется и на чертеже, и в спецификации, и в CSV — формат один.
 */
export function edgeCode(project: Project, part: Part): string {
  return EDGE_SIDE_ORDER.map((s) => edgeValue(project, part, s)).join('/');
}

/** Есть ли у детали хоть одна кромка. */
export function hasAnyEdge(part: Part): boolean {
  return EDGE_SIDE_ORDER.some((s) => part.edges[s] !== null);
}

// ── Материал (§17) ───────────────────────────────────────────────────────────

/** «ЛДСП 16 мм» — название материала с толщиной, для основной надписи. */
export function materialNotation(material: Material | undefined, thickness?: number): string {
  if (!material) return '—';
  const t = thickness ?? material.thickness;
  return t > 0 ? `${material.name} ${fmtMm(t)} мм` : material.name;
}

/** Материал детали в едином формате. */
export function partMaterialNotation(project: Project, part: Part): string {
  const m = project.materials.find((x) => x.id === part.material);
  return materialNotation(m, part.thickness);
}

// ── Текстура (§19) ───────────────────────────────────────────────────────────

/**
 * Направление текстуры детали в мировых осях вида: «GRAIN ↑» вдоль высоты,
 * «GRAIN →» вдоль ширины. grain: 'length' — вдоль длинной стороны заготовки.
 */
export function grainNotation(part: Part): string | null {
  if (part.grain === 'none') return null;
  return grainAlongHeight(part) ? 'GRAIN ↑' : 'GRAIN →';
}

/** Идёт ли текстура вдоль высоты детали (вертикально на главном виде). */
export function grainAlongHeight(part: Part): boolean {
  if (part.grain === 'none') return false;
  const longIsHeight = part.height >= part.width;
  return (part.grain === 'length') === longIsHeight;
}
