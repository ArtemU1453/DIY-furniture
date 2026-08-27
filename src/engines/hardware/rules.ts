/**
 * Правила количества фурнитуры (§33–§38).
 *
 * Правила петель и фасадов уже есть в движке соединений (этап 19) и здесь НЕ
 * дублируются (§27/§28) — эти правила добавляют то, чего там не было:
 * полкодержатели, крепёж задней стенки и заготовку направляющих.
 *
 * Все количества — параметры правила, а не константы в коде (§35): у разных
 * мастерских разные нормы, и менять их правкой исходников недопустимо.
 */
import type { Part, Project } from '@/core/model/types';

/** Настройки норм расхода. Значения по умолчанию — общепринятая практика. */
export interface HardwareRuleSettings {
  /** Полкодержателей на одну полку (§35). */
  shelfSupportsPerShelf: number;
  /** Шаг крепежа задней стенки по периметру, мм (§36). */
  backFixingSpacing: number;
  /** Минимум крепежа на заднюю стенку. */
  backFixingMin: number;
  /** Направляющих на один ящик (§37) — пара на ящик. */
  slidesPerDrawer: number;
}

export const DEFAULT_HARDWARE_RULES: HardwareRuleSettings = {
  shelfSupportsPerShelf: 4,
  backFixingSpacing: 150,
  backFixingMin: 4,
  slidesPerDrawer: 2,
};

export function ruleSettings(project: Project): HardwareRuleSettings {
  const stored = project.hardwareRules as Partial<HardwareRuleSettings> | undefined;
  return { ...DEFAULT_HARDWARE_RULES, ...(stored ?? {}) };
}

/**
 * ShelfSupportRule (§34/§35): полка опирается на полкодержатели.
 * Количество — параметр; по умолчанию 4 (по два на каждую вертикаль).
 */
export function shelfSupportCount(part: Part, settings: HardwareRuleSettings): number {
  if (part.role !== 'shelf') return 0;
  return Math.max(0, Math.round(settings.shelfSupportsPerShelf));
}

/** Полкодержатели по всему изделию. */
export function shelfSupportsTotal(parts: Part[], settings: HardwareRuleSettings): number {
  return parts.reduce((n, p) => n + shelfSupportCount(p, settings) * p.quantity, 0);
}

/**
 * BackPanelFixingRule (§36): крепёж по периметру задней стенки с заданным
 * шагом, но не меньше минимума — иначе тонкая стенка «играет».
 */
export function backFixingCount(part: Part, settings: HardwareRuleSettings): number {
  if (part.role !== 'back') return 0;
  const perimeter = 2 * (part.width + part.height);
  const spacing = settings.backFixingSpacing > 0 ? settings.backFixingSpacing : DEFAULT_HARDWARE_RULES.backFixingSpacing;
  return Math.max(settings.backFixingMin, Math.ceil(perimeter / spacing));
}

/**
 * DrawerSlideRule (§37/§38) — заготовка. Полноценный редактор ящиков будет
 * позже, поэтому правило пока считает по числу ящиков и не порождает узлов:
 * возвращать выдуманные направляющие для несуществующих ящиков нельзя.
 */
export interface DrawerSlideSpec {
  /** Длина направляющей = глубина ящика, округлённая вниз до типоразмера. */
  length: number;
  /** Количество на один ящик. */
  perDrawer: number;
  type: 'ROLLER' | 'BALL' | 'HIDDEN';
}

/** Стандартные длины направляющих, мм. */
export const SLIDE_LENGTHS = [250, 300, 350, 400, 450, 500, 550, 600];

/** Подобрать типоразмер направляющей под глубину (не длиннее корпуса). */
export function slideLengthFor(depth: number): number {
  const fitting = SLIDE_LENGTHS.filter((l) => l <= depth);
  return fitting.length > 0 ? fitting[fitting.length - 1] : SLIDE_LENGTHS[0];
}

export function drawerSlideSpec(depth: number, settings: HardwareRuleSettings): DrawerSlideSpec {
  return {
    length: slideLengthFor(depth),
    perDrawer: Math.max(1, Math.round(settings.slidesPerDrawer)),
    type: 'ROLLER',
  };
}

/** Направляющих на изделие с заданным числом ящиков. */
export function slidesTotal(drawerCount: number, settings: HardwareRuleSettings): number {
  return Math.max(0, drawerCount) * Math.max(1, Math.round(settings.slidesPerDrawer));
}
