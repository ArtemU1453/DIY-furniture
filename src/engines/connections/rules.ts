/**
 * ConnectionRule и ConnectionRuleEngine (§27–§39).
 *
 * Правило описывается декларативно:
 *
 *   WHEN  PartA.role = SIDE и PartB.role = TOP
 *   THEN  создать соединение выбранным корпусным крепежом
 *
 * Правила живут здесь, а не в React (§29): UI только показывает результат.
 * Правило возвращает ПЛАН соединения (ключи деталей + категория крепежа),
 * а сопоставление с конкретной фурнитурой делает движок — так одна и та же
 * конструкция работает с любым крепежом из библиотеки.
 */
import type { HardwareCategory, Part, PartRole } from '@/core/model/types';
import { connectionStableId, partKey } from './identity';

/** Контекст, в котором применяются правила. */
export interface ConnectionRuleContext {
  parts: Part[];
  /** Категория корпусного крепежа: confirmat / dowel / minifix / connector. */
  jointCategory: HardwareCategory;
  /** Схема корпуса (§30–§32). */
  construction: 'BETWEEN_SIDES' | 'ON_SIDES';
  /** Ставить ли ручки на фасады. */
  handles: boolean;
  /** Пороги числа петель — из производственного профиля (§37). */
  hingeThresholds?: HingeThreshold[];
}

/** План одного соединения: что с чем и чем крепим. */
export interface ConnectionPlanItem {
  /** Стабильный id соединения (§5). */
  stableId: string;
  category: HardwareCategory;
  aKey: string;
  bKey: string;
  aPartId: string;
  bPartId: string;
  quantity: number;
  /** Различает несколько узлов между одной парой деталей (§44). */
  position?: string;
  /** Какое правило породило — для отчётов и отладки. */
  ruleId: string;
}

/** Правило создания соединений (§28). */
export interface ConnectionRule {
  id: string;
  name: string;
  /** Применимо ли правило к этой конструкции. */
  applies?(ctx: ConnectionRuleContext): boolean;
  build(ctx: ConnectionRuleContext): ConnectionPlanItem[];
}

const roleOf = (p: Part): PartRole => p.role;
const typeOf = (p: Part): string | undefined => p.metadata?.partType as string | undefined;

/** Детали по роли; для боковин важна ещё и сторона. */
function byRole(parts: Part[], role: PartRole): Part[] {
  return parts.filter((p) => roleOf(p) === role && p.metadata?.hidden !== true);
}

/** Фронт ящика — тоже фасад по роли, но петли на него не ставятся (§37/§47). */
function isDrawerPart(part: Part): boolean {
  const type = typeOf(part);
  return type === 'drawer_front' || type === 'drawer_side'
    || type === 'drawer_back' || type === 'drawer_bottom';
}

function sides(parts: Part[]): { left?: Part; right?: Part; all: Part[] } {
  const all = byRole(parts, 'side');
  return {
    left: all.find((p) => typeOf(p) === 'side_left' || partKey(p).includes('SIDE.LEFT')),
    right: all.find((p) => typeOf(p) === 'side_right' || partKey(p).includes('SIDE.RIGHT')),
    all,
  };
}

function plan(
  ruleId: string,
  category: HardwareCategory,
  a: Part,
  b: Part,
  quantity: number,
  position?: string,
): ConnectionPlanItem {
  return {
    stableId: connectionStableId(partKey(a), partKey(b), position),
    category,
    aKey: partKey(a),
    bKey: partKey(b),
    aPartId: String(a.id),
    bPartId: String(b.id),
    quantity,
    position,
    ruleId,
  };
}

// ── Число крепежа в узле ─────────────────────────────────────────────────────

/**
 * Сколько единиц крепежа ставить на стык заданной длины. Пороги вынесены сюда,
 * а не разбросаны по правилам, чтобы их можно было менять централизованно.
 */
export function fastenersForSpan(span: number): number {
  if (span <= 300) return 2;
  if (span <= 800) return 3;
  if (span <= 1500) return 4;
  return 5;
}

// ── Петли (§36/§37) ──────────────────────────────────────────────────────────

/** Порог: до какой высоты фасада ставится столько петель. */
export interface HingeThreshold {
  maxHeight: number;
  count: number;
}

/**
 * Пороги по умолчанию. Значения не случайные и не зашиты в UI: их можно
 * переопределить через производственный профиль (§37).
 */
export const DEFAULT_HINGE_THRESHOLDS: HingeThreshold[] = [
  { maxHeight: 900, count: 2 },
  { maxHeight: 1500, count: 3 },
  { maxHeight: 2000, count: 4 },
  { maxHeight: Infinity, count: 5 },
];

/** Количество петель по высоте фасада (§37). */
export function hingeCountForHeight(
  height: number,
  thresholds: HingeThreshold[] = DEFAULT_HINGE_THRESHOLDS,
): number {
  const sorted = [...thresholds].sort((a, b) => a.maxHeight - b.maxHeight);
  for (const t of sorted) {
    if (height <= t.maxHeight) return t.count;
  }
  return sorted[sorted.length - 1]?.count ?? 2;
}

/** Позиции петель по высоте фасада (§36). */
export interface HingeLayout {
  count: number;
  /** Высоты петель от низа фасада, мм. */
  offsets: number[];
  topOffset: number;
  bottomOffset: number;
  spacing: number;
}

export function hingeLayout(
  height: number,
  thresholds?: HingeThreshold[],
  topOffset = 90,
  bottomOffset = 90,
): HingeLayout {
  const count = hingeCountForHeight(height, thresholds);
  const lo = bottomOffset;
  const hi = height - topOffset;
  if (count <= 1) return { count: 1, offsets: [height / 2], topOffset, bottomOffset, spacing: 0 };
  const spacing = (hi - lo) / (count - 1);
  const offsets = Array.from({ length: count }, (_, i) => lo + spacing * i);
  return { count, offsets, topOffset, bottomOffset, spacing };
}

// ── Правила корпуса (§30–§32) ────────────────────────────────────────────────

/**
 * Верх и низ к боковинам.
 *
 * BETWEEN_SIDES — горизонталь входит МЕЖДУ боковинами: крепёж идёт сквозь
 * боковину в торец горизонтали.
 * ON_SIDES — горизонталь лежит НА боковинах: крепёж идёт сквозь горизонталь в
 * торец боковины. Геометрия узла разная, поэтому правила разделены.
 */
export const carcassRule: ConnectionRule = {
  id: 'CARCASS',
  name: 'Верх и низ к боковинам',
  build(ctx) {
    const { left, right } = sides(ctx.parts);
    const tops = [...byRole(ctx.parts, 'top'), ...byRole(ctx.parts, 'bottom')];
    const out: ConnectionPlanItem[] = [];
    for (const horiz of tops) {
      const span = Math.max(horiz.width, horiz.height);
      const count = Math.min(fastenersForSpan(span), 3);
      // Позиция различает узлы: одна и та же пара деталей стыкуется один раз,
      // но для схемы ON_SIDES полезно знать, кто проходной.
      const position = ctx.construction === 'ON_SIDES' ? 'on-sides' : 'between-sides';
      if (left) out.push(plan(this.id, ctx.jointCategory, horiz, left, count, position));
      if (right) out.push(plan(this.id, ctx.jointCategory, horiz, right, count, position));
    }
    return out;
  },
};

/** Полки к боковинам (§33). */
export const shelfRule: ConnectionRule = {
  id: 'SHELF',
  name: 'Полки к боковинам',
  build(ctx) {
    const { left, right } = sides(ctx.parts);
    const partitions = byRole(ctx.parts, 'divider');
    const out: ConnectionPlanItem[] = [];

    for (const shelf of byRole(ctx.parts, 'shelf')) {
      const span = Math.max(shelf.width, shelf.height);
      const count = Math.min(fastenersForSpan(span), 3);
      // Полка крепится к тем вертикалям, которых она касается: к боковинам и
      // к перегородкам своей секции.
      const neighbours = nearestVerticals(shelf, [left, right, ...partitions].filter(Boolean) as Part[]);
      for (const vertical of neighbours) {
        out.push(plan(this.id, ctx.jointCategory, shelf, vertical, count));
      }
    }
    return out;
  },
};

/**
 * Вертикали, к которым примыкает полка: ближайшая слева и ближайшая справа.
 * Так полка в секции крепится к перегородке, а не к дальней боковине.
 */
function nearestVerticals(shelf: Part, verticals: Part[]): Part[] {
  if (verticals.length === 0) return [];
  const cx = shelf.position.x;
  const halfWidth = Math.max(shelf.width, shelf.height) / 2;
  const withDistance = verticals.map((v) => ({ v, dx: v.position.x - cx }));

  const leftSide = withDistance.filter((x) => x.dx < 0).sort((a, b) => b.dx - a.dx)[0];
  const rightSide = withDistance.filter((x) => x.dx > 0).sort((a, b) => a.dx - b.dx)[0];

  const out: Part[] = [];
  // Берём соседа, только если он действительно рядом с краем полки.
  if (leftSide && Math.abs(leftSide.dx) <= halfWidth + 50) out.push(leftSide.v);
  if (rightSide && Math.abs(rightSide.dx) <= halfWidth + 50) out.push(rightSide.v);
  // Если полка шире всех вертикалей (нет перегородок), берём крайние.
  if (out.length === 0) {
    if (leftSide) out.push(leftSide.v);
    if (rightSide) out.push(rightSide.v);
  }
  return out;
}

/** Перегородки к верху и низу (§34). */
export const partitionRule: ConnectionRule = {
  id: 'PARTITION',
  name: 'Перегородки к корпусу',
  build(ctx) {
    const out: ConnectionPlanItem[] = [];
    const top = byRole(ctx.parts, 'top')[0];
    const bottom = byRole(ctx.parts, 'bottom')[0];

    for (const partition of byRole(ctx.parts, 'divider')) {
      if (top) out.push(plan(this.id, ctx.jointCategory, partition, top, 2, 'top'));
      if (bottom) out.push(plan(this.id, ctx.jointCategory, partition, bottom, 2, 'bottom'));
    }
    return out;
  },
};

/** Фасады к боковинам через петли (§35). */
export const doorRule: ConnectionRule = {
  id: 'DOOR',
  name: 'Фасады на петлях',
  build(ctx) {
    const { left, right, all } = sides(ctx.parts);
    // Фронты ящиков навешиваются на направляющие, а не на петли (§47).
    const doors = byRole(ctx.parts, 'facade').filter((p) => !isDrawerPart(p));
    if (doors.length === 0 || all.length === 0) return [];

    const out: ConnectionPlanItem[] = [];
    doors.forEach((door, i) => {
      // Фасад навешивается на ближайшую боковину: левый — на левую, правый — на правую.
      const target = doors.length === 1
        ? (left ?? right ?? all[0])
        : (i < doors.length / 2 ? (left ?? all[0]) : (right ?? all[all.length - 1]));
      if (!target) return;

      const count = hingeCountForHeight(door.height, ctx.hingeThresholds);
      out.push(plan(this.id, 'hinge', door, target, count));
      if (ctx.handles) out.push(plan(this.id, 'handle', door, target, 1, 'handle'));
    });
    return out;
  },
};

/**
 * Ящики (§39 этапа 19, §47/§48 этапа 28).
 *
 * Короб ящика ездит по направляющим, закреплённым на боковинах корпуса, а сам
 * собирается корпусным крепежом: фронт и задняя стенка к боковинам короба.
 * Ручка ставится на фронт, если ручки включены.
 */
export const drawerConnectionRule: ConnectionRule = {
  id: 'DRAWER',
  name: 'Ящики',
  build(ctx) {
    const drawerParts = ctx.parts.filter((p) => isDrawerPart(p) && p.metadata?.hidden !== true);
    if (drawerParts.length === 0) return [];
    const { left, right, all } = sides(ctx.parts);
    const carcassLeft = left ?? all[0];
    const carcassRight = right ?? all[all.length - 1];

    // Детали группируются по номеру ящика: один ящик — один набор узлов.
    const byDrawer = new Map<number, Part[]>();
    for (const part of drawerParts) {
      const index = Number(part.metadata?.drawer ?? 0);
      const list = byDrawer.get(index) ?? [];
      list.push(part);
      byDrawer.set(index, list);
    }

    const out: ConnectionPlanItem[] = [];
    for (const [index, parts] of [...byDrawer.entries()].sort((a, b) => a[0] - b[0])) {
      const front = parts.find((p) => typeOf(p) === 'drawer_front');
      const back = parts.find((p) => typeOf(p) === 'drawer_back');
      const boxSides = parts.filter((p) => typeOf(p) === 'drawer_side');
      const boxLeft = boxSides.find((p) => p.metadata?.side === 'left');
      const boxRight = boxSides.find((p) => p.metadata?.side === 'right');

      // Направляющие: боковина короба ↔ боковина корпуса (§47).
      if (boxLeft && carcassLeft) out.push(plan(this.id, 'slide', boxLeft, carcassLeft, 1, `slide-left-${index}`));
      if (boxRight && carcassRight) out.push(plan(this.id, 'slide', boxRight, carcassRight, 1, `slide-right-${index}`));

      // Сборка короба корпусным крепежом.
      for (const side of boxSides) {
        if (front) out.push(plan(this.id, ctx.jointCategory, front, side, 2, `front-${index}`));
        if (back) out.push(plan(this.id, ctx.jointCategory, back, side, 2, `back-${index}`));
      }

      // Ручка на фронте ящика (§39/§40 этапа 28).
      if (ctx.handles && front && carcassLeft) {
        out.push(plan(this.id, 'handle', front, carcassLeft, 1, `handle-${index}`));
      }
    }
    return out;
  },
};

/** Реестр правил соединений. */
const registry: ConnectionRule[] = [
  carcassRule,
  shelfRule,
  partitionRule,
  doorRule,
  drawerConnectionRule,
];

export function connectionRules(): ConnectionRule[] {
  return [...registry];
}

export function registerConnectionRule(rule: ConnectionRule): void {
  const index = registry.findIndex((r) => r.id === rule.id);
  if (index >= 0) registry[index] = rule;
  else registry.push(rule);
}

/**
 * ConnectionRuleEngine: применить все правила и вернуть план соединений без
 * дубликатов (§42). Порядок правил задаёт порядок соединений.
 */
export function planConnections(ctx: ConnectionRuleContext): ConnectionPlanItem[] {
  const out: ConnectionPlanItem[] = [];
  const seen = new Set<string>();

  for (const rule of registry) {
    if (rule.applies && !rule.applies(ctx)) continue;
    for (const item of rule.build(ctx)) {
      // Самосоединение отсекается сразу (§41).
      if (item.aPartId === item.bPartId) continue;
      const key = [item.category, ...[item.aPartId, item.bPartId].sort(), item.position ?? ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
