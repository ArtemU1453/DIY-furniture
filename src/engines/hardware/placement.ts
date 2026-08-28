/**
 * Параметрическое размещение фурнитуры (§16/§17, §79–§81, §88–§91).
 *
 * Координата задаётся выражением, которое считает УЖЕ СУЩЕСТВУЮЩИЙ безопасный
 * вычислитель (`engines/templates/formula`). Произвольный JavaScript не
 * выполняется (§108): «width / 2» — это формула над параметрами детали, а не
 * код. Второго вычислителя выражений не заводится.
 *
 *   Part (ширина/высота/толщина) → scope → evaluateFormula → координата на детали
 */
import { FormulaError, evaluateFormula } from '@/engines/templates/formula';
import type { Mm, Part, PlacementRule } from '@/core/model/types';

/** Величины, доступные в выражениях размещения (§79). */
export function placementScope(part: Part, extra: Record<string, number> = {}): Record<string, number> {
  return {
    width: part.width,
    height: part.height,
    thickness: part.thickness,
    // Половины и края — самые частые опоры, поэтому даются готовыми.
    centerX: part.width / 2,
    centerY: part.height / 2,
    left: 0,
    right: part.width,
    bottom: 0,
    top: part.height,
    ...extra,
  };
}

export interface PlacementResult {
  x: Mm;
  y: Mm;
  /** Ошибка выражения, если она была: значение при этом не применяется. */
  error?: string;
}

/** Вычислить одну координату: число берётся как есть, строка — как формула. */
function resolveValue(
  value: string | number | undefined,
  scope: Record<string, number>,
  fallback: number,
): { value: number; error?: string } {
  if (value == null) return { value: fallback };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value } : { value: fallback, error: 'Значение не является числом.' };
  }
  try {
    const result = evaluateFormula(value, scope);
    if (!Number.isFinite(result)) return { value: fallback, error: `Выражение «${value}» не дало числа.` };
    return { value: result };
  } catch (e) {
    return { value: fallback, error: e instanceof FormulaError ? e.message : `Ошибка в выражении «${value}».` };
  }
}

/**
 * Положение единицы фурнитуры на детали (§17/§79).
 *
 * Опора переводится в координаты детали: EDGE отсчитывает от указанной
 * стороны, CENTER — от середины, CORNER — от угла по обеим осям, DISTANCE —
 * абсолютные миллиметры, PARAMETER — выражение над параметрами.
 */
export function resolvePlacement(
  part: Part,
  rule: PlacementRule | undefined,
  extra: Record<string, number> = {},
): PlacementResult {
  const scope = placementScope(part, extra);
  // Без правила крепёж ставится в центр детали — предсказуемое умолчание.
  if (!rule) return { x: scope.centerX, y: scope.centerY };

  const offset = rule.offset ?? 0;
  const rx = resolveValue(rule.x, scope, scope.centerX);
  const ry = resolveValue(rule.y, scope, scope.centerY);
  const error = rx.error ?? ry.error;

  let x = rx.value;
  let y = ry.value;

  switch (rule.reference) {
    case 'EDGE': {
      // Отсчёт от указанной стороны; смещение всегда внутрь детали.
      const from = rule.from ?? 'left';
      if (from === 'left') x = rx.value + offset;
      else if (from === 'right') x = part.width - rx.value - offset;
      else if (from === 'bottom') y = ry.value + offset;
      else y = part.height - ry.value - offset;
      break;
    }
    case 'CORNER': {
      const from = rule.from ?? 'left';
      const horizontal = from === 'right' ? part.width - rx.value - offset : rx.value + offset;
      const vertical = from === 'top' ? part.height - ry.value - offset : ry.value + offset;
      x = horizontal;
      y = vertical;
      break;
    }
    case 'CENTER': {
      x = scope.centerX + rx.value + (rule.from === 'right' ? offset : rule.from === 'left' ? -offset : 0);
      y = scope.centerY + ry.value + (rule.from === 'top' ? offset : rule.from === 'bottom' ? -offset : 0);
      break;
    }
    case 'DISTANCE':
      x = rx.value + offset;
      y = ry.value + offset;
      break;
    case 'PARAMETER':
    default:
      x = rx.value;
      y = ry.value;
      break;
  }

  return error ? { x: scope.centerX, y: scope.centerY, error } : { x, y };
}

/** Внутри ли точка детали (§110). Допуск — половина миллиметра. */
export function withinPart(part: Part, point: { x: number; y: number }, tolerance = 0.5): boolean {
  return (
    point.x >= -tolerance &&
    point.y >= -tolerance &&
    point.x <= part.width + tolerance &&
    point.y <= part.height + tolerance
  );
}

/**
 * Зеркальное отражение положения (§92). Отражается координата ВДОЛЬ детали:
 * ручка, стоявшая в 100 мм от левого края, оказывается в 100 мм от правого.
 */
export function mirrorPlacement(part: Part, point: { x: number; y: number }): { x: number; y: number } {
  return { x: part.width - point.x, y: point.y };
}

/** Отражение правила размещения: меняется только сторона отсчёта. */
export function mirrorPlacementRule(rule: PlacementRule): PlacementRule {
  const flip: Record<string, PlacementRule['from']> = { left: 'right', right: 'left' };
  return rule.from && flip[rule.from] ? { ...rule, from: flip[rule.from] } : { ...rule };
}

/** Готовые правила размещения для типовых задач (§80/§81). */
export const PLACEMENT_PRESETS: Record<string, PlacementRule> = {
  /** §80: ручка по центру ширины фасада. */
  handleCenter: { reference: 'PARAMETER', x: 'width / 2', y: 'height - 80' },
  /** §81: петля в 100 мм от верхнего края. */
  hingeTop: { reference: 'EDGE', from: 'top', y: 100, x: 'thickness + 6' },
  hingeBottom: { reference: 'EDGE', from: 'bottom', y: 100, x: 'thickness + 6' },
  /** Полкодержатель в 50 мм от переднего края. */
  shelfSupportFront: { reference: 'EDGE', from: 'left', x: 50, y: 'height / 2' },
  /** Крепёж по центру торца. */
  edgeCenter: { reference: 'CENTER', x: 0, y: 0 },
};
