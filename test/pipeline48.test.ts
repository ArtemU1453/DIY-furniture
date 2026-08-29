/**
 * ЭТАП 48 · КОНТРАКТ ПРОИЗВОДСТВЕННОГО КОНВЕЙЕРА.
 *
 * Конвейер: ProjectModel → генерация → детали → материал → кромка →
 * фурнитура → присадка → раскрой → спецификация → производство → документы.
 * Новой модели данных здесь не заводится: тест ФИКСИРУЕТ существующую.
 *
 * Что уже проверено в других наборах и здесь НЕ повторяется:
 *   production38 — разделы показывают величины модели (размеры, материал,
 *                  кромка, текстура, количество в BOM и производстве, 3D);
 *   baseline46   — производственный результат эталона заморожен числами;
 *   legacy37     — старые проекты открываются с прежней геометрией.
 *
 * Здесь закрыты четыре места, где контракт держался на слове:
 *   §8  координаты присадки: проверялась их конечность, но не то, что
 *       отверстие попадает В деталь;
 *   §13 количество: сверялись модель/BOM/производство, но не число мест
 *       детали в раскрое;
 *   §23 2D: сверялось только число нарисованных деталей, не размеры;
 *   §15/§16 схемы корпуса: сверялась геометрия деталей, но ни одна схема,
 *       кроме конфигурации эталона, не доходила до раскроя, спецификации,
 *       производства и документов.
 *
 * Эталонный проект — единственный, общий: test/golden/goldenProject.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildGoldenProject, project, store, mm, key } from './golden/goldenProject';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { productionParts } from '@/engines/production';
import { buildPartsDocument, documentToSvgPages } from '@/engines/drawing';
import { buildEntities, partOfEntity } from '@/engines/editor2d';
import { validateProjectModel } from '@/engines/status';
import { constructionMounts, CONSTRUCTION_ORDER } from '@/core/parametric/types';
import type { CabinetConstructionType } from '@/core/parametric/types';
import type { Part, Project } from '@/core/model/types';

/** Допуск: размеры складываются из дробных величин, хвост double не значим. */
const EPS = 0.01;

/** Сколько мест детали занято в раскрое. */
function placementsPerPart(report: ReturnType<typeof runCutting>): Map<string, number> {
  const out = new Map<string, number>();
  for (const job of report.jobs) {
    for (const sheet of job.sheets) {
      for (const pl of sheet.placements) {
        const id = String(pl.partId);
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
  }
  return out;
}

describe('Этап 48 · присадка попадает в деталь', () => {
  beforeEach(() => { buildGoldenProject(); });

  it('§8 каждая операция лежит в плоскости своей детали', () => {
    const parts = new Map(allParts(project()).map((p) => [String(p.id), p]));
    const ops = allOperations(project());
    expect(ops.length).toBeGreaterThan(0);

    const outside: string[] = [];
    for (const op of ops) {
      const part = parts.get(String(op.partId));
      // Операция без детали — уже пойманная в другом наборе ошибка; здесь
      // важно, что координаты существующей операции лежат на детали.
      if (!part) continue;
      const onPart = op.x >= -EPS && op.y >= -EPS
        && op.x <= part.width + EPS && op.y <= part.height + EPS;
      if (!onPart) {
        outside.push(`${key(part)} (${mm(part.width)}×${mm(part.height)}): ${op.face} x=${mm(op.x)} y=${mm(op.y)}`);
      }
    }
    // Отверстие за краем панели — брак, который в цеху увидят слишком поздно.
    expect(outside).toEqual([]);
  });

  it('§8 у операции есть деталь, грань и измеримые параметры', () => {
    const ops = allOperations(project());
    for (const op of ops) {
      expect(String(op.partId)).toBeTruthy();
      expect(['front', 'back', 'left', 'right', 'top', 'bottom']).toContain(op.face);
      // Диаметр и глубина не обязательны для всех типов, но если заданы —
      // это размеры инструмента, и нулевыми быть не могут.
      if (op.diameter != null) expect(op.diameter).toBeGreaterThan(0);
      if (op.depth != null) expect(op.depth).toBeGreaterThan(0);
    }
    // Глубина считается от той грани, в которую идёт инструмент:
    //   пласть (front/back) — сверление в толщину, глубина не больше плиты;
    //   торец (left/right/top/bottom) — конфирмат идёт ВДОЛЬ детали, и 34 мм
    //     в 16-миллиметровой плите нормальны: сверлится торец, а не пласть.
    // Сравнивать торцевую глубину с толщиной — ошибка, а не проверка.
    const parts = new Map(allParts(project()).map((p) => [String(p.id), p]));
    const face = new Set(['front', 'back']);
    for (const op of ops) {
      const part = parts.get(String(op.partId));
      if (!part || op.depth == null) continue;
      const limit = face.has(String(op.face))
        ? part.thickness
        : Math.max(part.width, part.height);
      expect(op.depth, `${key(part)}: ${op.face} глубина ${mm(op.depth)}`)
        .toBeLessThanOrEqual(limit + EPS);
    }
  });
});

describe('Этап 48 · количество совпадает по всей цепочке', () => {
  beforeEach(() => { buildGoldenProject(); });

  it('§13 модель = раскрой = спецификация = производство, деталь за деталью', () => {
    const parts = allParts(project());
    const report = runCutting(project());
    const placed = placementsPerPart(report);
    const spec = buildSpecification(parts, project().materials, project().edges);
    const production = productionParts(project());

    for (const part of parts) {
      const id = String(part.id);
      const row = spec.rows.find((r) => String(r.partId) === id);
      const prod = production.find((r) => String(r.partId) === id);
      expect(row, `нет строки спецификации для ${key(part)}`).toBeDefined();
      expect(prod, `нет строки производства для ${key(part)}`).toBeDefined();

      expect(row!.quantity).toBe(part.quantity);
      expect(prod!.quantity).toBe(part.quantity);
      // Деталь без материала в раскрой не идёт — это не расхождение.
      if (part.material) {
        expect(placed.get(id) ?? 0, `мест в раскрое для ${key(part)}`).toBe(part.quantity);
      } else {
        expect(placed.get(id) ?? 0).toBe(0);
      }
    }

    // И ни одного лишнего места: раскрой не размещает того, чего нет в модели.
    const live = new Set(parts.map((p) => String(p.id)));
    for (const id of placed.keys()) expect(live.has(id)).toBe(true);
  });

  it('§13 количество больше единицы доходит до раскроя, спецификации и цеха', () => {
    const shelf = allParts(project()).find((p) => p.metadata?.partType === 'shelf')!;
    expect(shelf.quantity).toBe(1);

    // Тем же действием, что и панель свойств: своего пути записи здесь нет.
    store().updatePart(shelf.id, { quantity: 3 });
    const updated = allParts(project()).find((p) => String(p.id) === String(shelf.id))!;
    expect(updated.quantity).toBe(3);

    const parts = allParts(project());
    const placed = placementsPerPart(runCutting(project()));
    const row = buildSpecification(parts, project().materials, project().edges)
      .rows.find((r) => String(r.partId) === String(shelf.id))!;
    const prod = productionParts(project()).find((r) => String(r.partId) === String(shelf.id))!;

    // Три полки — три места на листе, три штуки в спецификации и в цехе.
    expect(placed.get(String(shelf.id))).toBe(3);
    expect(row.quantity).toBe(3);
    expect(prod.quantity).toBe(3);

    // Суммарно раскрой размещает столько деталей, сколько их заказано.
    const total = [...placed.values()].reduce((n, v) => n + v, 0);
    const ordered = parts.filter((p) => p.material).reduce((n, p) => n + p.quantity, 0);
    expect(total).toBe(ordered);
  });
});

describe('Этап 48 · 2D показывает модель, а не свои числа', () => {
  beforeEach(() => { buildGoldenProject(); });

  for (const plane of ['FRONT', 'TOP', 'SIDE'] as const) {
    it(`§23 прямоугольник детали на плоскости ${plane} собран из её размеров`, () => {
      const parts = allParts(project());
      const entities = buildEntities(project(), { plane });

      const drawn = new Set<string>();
      for (const entity of entities) {
        const part = partOfEntity(project(), entity);
        if (!part) continue;
        drawn.add(String(part.id));
        const { width, height } = (entity as unknown as {
          transform: { width: number; height: number };
        }).transform;

        // 2D — проекция: какие именно два размера видны, зависит от плоскости,
        // но взяться они могут только из самой детали. Своих размеров у
        // холста нет.
        const own = [part.width, part.height, part.thickness];
        const near = (v: number) => own.some((d) => Math.abs(d - v) <= EPS);
        expect(near(width), `${key(part)}: ширина ${mm(width)} не из ${own.map(mm).join('/')}`).toBe(true);
        expect(near(height), `${key(part)}: высота ${mm(height)} не из ${own.map(mm).join('/')}`).toBe(true);
      }

      // Ни одна деталь модели не потеряна на холсте.
      expect(drawn.size).toBe(parts.length);
    });
  }
});

/**
 * Полный конвейер для одной конфигурации: возвращает то, что уходит в цех.
 * Используется для каждой схемы корпуса — руками ничего не считается.
 */
function runPipeline(p: Project) {
  const parts = allParts(p);
  const report = runCutting(p);
  const spec = buildSpecification(parts, p.materials, p.edges);
  const production = productionParts(p);
  const document = buildPartsDocument(p);
  return { parts, report, spec, production, document };
}

const partOfType = (parts: Part[], type: string) =>
  parts.find((p) => p.metadata?.partType === type);

describe('Этап 48 · все схемы корпуса доходят до цеха', () => {
  const W = 900, H = 2000, D = 550, T = 16;

  /** Создаёт шкаф заданной схемы через тот же путь, что и пользователь. */
  function cabinetWith(construction: CabinetConstructionType) {
    store().newProject(`Схема ${construction}`);
    const id = store().createParametricCabinet({
      type: 'CABINET', name: 'Шкаф', width: W, height: H, depth: D, thickness: T,
    })!;
    const model = store().getCabinetModel(id)!;
    store().applyCabinetPatch(id, {
      construction,
      shelves: { ...model.shelves, count: 3 },
    });
    return project();
  }

  for (const construction of CONSTRUCTION_ORDER) {
    it(`§15/§16 ${construction}: геометрия по схеме и весь конвейер цел`, () => {
      const p = cabinetWith(construction);
      const { parts, report, spec, production, document } = runPipeline(p);
      const mounts = constructionMounts(construction);

      // ── Геометрия схемы (§15/§16) ───────────────────────────────────────
      // Боковина укорачивается на каждую накладную деталь; верх и низ
      // становятся во всю ширину, когда лежат НА боковинах.
      const side = partOfType(parts, 'side_left')!;
      const top = partOfType(parts, 'top')!;
      const bottom = partOfType(parts, 'bottom')!;
      expect(side).toBeDefined();

      const expectedSide = H - (mounts.topOnSides ? T : 0) - (mounts.bottomUnder ? T : 0);
      expect(mm(Math.max(side.width, side.height))).toBeCloseTo(expectedSide, 2);
      expect(mm(Math.max(top.width, top.height))).toBeCloseTo(mounts.topOnSides ? W : W - 2 * T, 2);
      expect(mm(Math.max(bottom.width, bottom.height))).toBeCloseTo(mounts.bottomUnder ? W : W - 2 * T, 2);

      // ── Конвейер (§3–§12) ───────────────────────────────────────────────
      expect(validateProjectModel(p).issues.filter((i) => i.severity === 'error')).toEqual([]);

      // Раскрой размещает каждую деталь с материалом и ничего не теряет.
      const placed = placementsPerPart(report);
      const withMaterial = parts.filter((x) => x.material);
      expect(report.jobs.flatMap((j) => j.unplaced)).toHaveLength(0);
      for (const part of withMaterial) {
        expect(placed.get(String(part.id)) ?? 0, `${key(part)} не размещена`).toBe(part.quantity);
      }

      // Спецификация, производство и документы — строка (страница) на деталь.
      expect(spec.rows).toHaveLength(parts.length);
      expect(production).toHaveLength(parts.length);
      expect(document.pages).toHaveLength(parts.length);
      expect(documentToSvgPages(document).every((svg) => svg.includes('<svg'))).toBe(true);

      // Присадка есть и лежит на существующих деталях этой схемы.
      const live = new Set(parts.map((x) => String(x.id)));
      const ops = allOperations(p);
      expect(ops.length).toBeGreaterThan(0);
      for (const op of ops) expect(live.has(String(op.partId))).toBe(true);

      // Материал и толщина доходят до спецификации без подмены.
      for (const part of parts) {
        const row = spec.rows.find((r) => String(r.partId) === String(part.id))!;
        expect(String(row.materialId)).toBe(String(part.material));
        expect(mm(row.thickness)).toBeCloseTo(mm(part.thickness), 2);
      }
    });
  }

  it('§15/§16 схемы отличаются геометрией, а не только названием', () => {
    const sizes = new Map<string, string>();
    for (const construction of CONSTRUCTION_ORDER) {
      const p = cabinetWith(construction);
      const parts = allParts(p);
      const side = partOfType(parts, 'side_left')!;
      const top = partOfType(parts, 'top')!;
      sizes.set(construction, `${mm(Math.max(side.width, side.height))}/${mm(Math.max(top.width, top.height))}`);
    }
    // Иначе проверка выше проходила бы на одной и той же геометрии
    // и ничего бы не доказывала.
    expect(new Set(sizes.values()).size).toBe(CONSTRUCTION_ORDER.length);
  });
});
