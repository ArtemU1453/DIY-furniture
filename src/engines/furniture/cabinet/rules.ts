/**
 * Система конструктивных правил корпуса.
 *
 * Каждое правило — самостоятельный модуль, порождающий детали одного семейства
 * из контекста. Новые варианты установки/детали добавляются регистрацией нового
 * правила или стратегии, без переписывания генератора корпуса.
 */
import type { CabinetContext } from './context';
import type { PanelSpec } from './panel';

export interface ConstructionRule {
  id: string;
  build(ctx: CabinetContext): PanelSpec[];
}

// ── Боковины ────────────────────────────────────────────────────────────────
const sidesRule: ConstructionRule = {
  id: 'sides',
  build(ctx) {
    const { params, t, sideY } = ctx;
    const W = params.width;
    const z = { min: 0, max: params.depth };
    return [
      {
        key: 'side_left',
        partType: 'side_left',
        x: { min: 0, max: t },
        y: sideY,
        z,
        thicknessAxis: 'x',
        material: params.material,
        grain: 'length',
      },
      {
        key: 'side_right',
        partType: 'side_right',
        x: { min: W - t, max: W },
        y: sideY,
        z,
        thicknessAxis: 'x',
        material: params.material,
        grain: 'length',
      },
    ];
  },
};

// ── Верх (стратегия по схеме установки) ──────────────────────────────────────
type HorizontalStrategy = (ctx: CabinetContext) => PanelSpec['x'];

const TOP_STRATEGIES: Record<string, HorizontalStrategy> = {
  between: (ctx) => ({ min: ctx.t, max: ctx.params.width - ctx.t }),
  overlay: (ctx) => ({ min: 0, max: ctx.params.width }),
};

const topRule: ConstructionRule = {
  id: 'top',
  build(ctx) {
    const { params, t } = ctx;
    const strategy = TOP_STRATEGIES[params.top] ?? TOP_STRATEGIES.between;
    return [
      {
        key: 'top',
        partType: 'top',
        x: strategy(ctx),
        y: { min: params.height - t, max: params.height },
        z: { min: 0, max: params.depth },
        thicknessAxis: 'y',
        material: params.material,
        grain: 'length',
      },
    ];
  },
};

// ── Низ (стратегия по схеме установки) ───────────────────────────────────────
const BOTTOM_STRATEGIES: Record<string, HorizontalStrategy> = {
  between: (ctx) => ({ min: ctx.t, max: ctx.params.width - ctx.t }),
  under: (ctx) => ({ min: 0, max: ctx.params.width }),
};

const bottomRule: ConstructionRule = {
  id: 'bottom',
  build(ctx) {
    const { params, t } = ctx;
    const strategy = BOTTOM_STRATEGIES[params.bottom] ?? BOTTOM_STRATEGIES.between;
    return [
      {
        key: 'bottom',
        partType: 'bottom',
        x: strategy(ctx),
        y: { min: 0, max: t },
        z: { min: 0, max: params.depth },
        thicknessAxis: 'y',
        material: params.material,
        grain: 'length',
      },
    ];
  },
};

// ── Перегородки ──────────────────────────────────────────────────────────────
const dividersRule: ConstructionRule = {
  id: 'dividers',
  build(ctx) {
    const { params, t, interior, interiorDepthMax } = ctx;
    const specs: PanelSpec[] = [];
    // Границы перегородок совпадают с правыми краями секций (кроме последней).
    let cursor = interior.x.min;
    const innerWidth = interior.x.max - interior.x.min;
    const sectionWidth = (innerWidth - params.dividers * t) / (params.dividers + 1);
    for (let i = 1; i <= params.dividers; i++) {
      cursor += sectionWidth;
      specs.push({
        key: `divider_${i}`,
        partType: 'divider',
        index: i,
        x: { min: cursor, max: cursor + t },
        y: interior.y,
        z: { min: 0, max: interiorDepthMax },
        thicknessAxis: 'x',
        material: params.material,
        grain: 'length',
      });
      cursor += t;
    }
    return specs;
  },
};

// ── Полки (по секциям, равномерно по высоте) ─────────────────────────────────
const shelvesRule: ConstructionRule = {
  id: 'shelves',
  build(ctx) {
    const { params, t, interior, shelfZ, sections } = ctx;
    const n = params.shelves;
    if (n <= 0) return [];
    const interiorHeight = interior.y.max - interior.y.min;
    const specs: PanelSpec[] = [];
    for (const section of sections) {
      for (let j = 1; j <= n; j++) {
        const yc = interior.y.min + (interiorHeight * j) / (n + 1);
        specs.push({
          key: `shelf_${section.id}_${j}`,
          partType: 'shelf',
          index: j,
          sectionId: section.id,
          x: { min: section.x, max: section.x + section.width },
          y: { min: yc - t / 2, max: yc + t / 2 },
          z: shelfZ,
          thicknessAxis: 'y',
          material: params.material,
          grain: 'length',
        });
      }
    }
    return specs;
  },
};

// ── Задняя стенка (стратегия по типу) ────────────────────────────────────────
const backRule: ConstructionRule = {
  id: 'back',
  build(ctx) {
    const { params, t } = ctx;
    const { back, width: W, height: H, depth: D, construction } = params;
    if (back === 'none') return [];
    const bt = construction.backThickness;
    const off = construction.backOffset;
    let x: PanelSpec['x'];
    let y: PanelSpec['y'];
    let z: PanelSpec['z'];
    if (back === 'overlay') {
      x = { min: 0, max: W };
      y = { min: 0, max: H };
      z = { min: D, max: D + bt };
    } else if (back === 'groove') {
      const g = 6; // допуск захода в паз
      x = { min: t - g, max: W - t + g };
      y = { min: t - g, max: H - t + g };
      z = { min: D - bt - off, max: D - off };
    } else {
      // inset (вкладная)
      x = { min: t, max: W - t };
      y = { min: t, max: H - t };
      z = { min: D - bt - off, max: D - off };
    }
    return [
      {
        key: 'back',
        partType: 'back',
        x,
        y,
        z,
        thicknessAxis: 'z',
        material: params.backMaterial,
        grain: 'none',
      },
    ];
  },
};

// ── Фасады (двери) ────────────────────────────────────────────────────────────
const facadeRule: ConstructionRule = {
  id: 'facades',
  build(ctx) {
    const { params } = ctx;
    const n = params.doors;
    if (n <= 0) return [];
    const gap = params.construction.facadeGap; // зазор по периметру фасадной зоны
    const doorGap = params.doorGap; // зазор между фасадами
    const zoneW = params.width - 2 * gap;
    const zoneH = params.height - 2 * gap;
    if (zoneW <= 0 || zoneH <= 0) return [];
    // Ширина каждого фасада рассчитывается автоматически (не фиксированная).
    const facadeW = (zoneW - (n - 1) * doorGap) / n;
    const zFront = params.depth;
    const ft = params.thickness;
    const specs: PanelSpec[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = gap + i * (facadeW + doorGap);
      specs.push({
        key: `facade_${i + 1}`,
        partType: 'facade',
        index: i + 1,
        x: { min: x0, max: x0 + facadeW },
        y: { min: gap, max: gap + zoneH },
        z: { min: zFront, max: zFront + ft },
        thicknessAxis: 'z',
        material: params.frontMaterial ?? params.material,
        grain: 'length',
      });
    }
    return specs;
  },
};

// ── Полка-щит (единственная деталь для шаблона «Полка») ──────────────────────
const boardRule: ConstructionRule = {
  id: 'board',
  build(ctx) {
    const { params } = ctx;
    return [
      {
        key: 'board',
        partType: 'board',
        x: { min: 0, max: params.width },
        y: { min: 0, max: params.thickness },
        z: { min: 0, max: params.depth },
        thicknessAxis: 'y',
        material: params.material,
        grain: 'length',
      },
    ];
  },
};

/** Порядок правил в базовом корпусе. Расширяется добавлением правил. */
export const CABINET_RULES: ConstructionRule[] = [
  sidesRule,
  topRule,
  bottomRule,
  dividersRule,
  shelvesRule,
  backRule,
  facadeRule,
];

/** Правила для полки-щита (единственная деталь). */
export const BOARD_RULES: ConstructionRule[] = [boardRule];
