/**
 * ЭТАП 46 · БАЗОВАЯ ВЕРСИЯ (RELEASE BASELINE).
 *
 * Здесь зафиксирован производственный результат РАБОТАЮЩЕЙ версии 1.0.0
 * (коммит ce50decd8e212f97e2670c84ffe46eb1c3f70afd). Смысл файла ровно один:
 * незаметно изменить то, что уходит в цех, больше нельзя. Любая правка,
 * которая сдвинет размер детали, количество, кромку, присадку или раскрой
 * эталонного проекта, обязана уронить этот тест — и человек решит, это
 * улучшение или регрессия.
 *
 * Почему числа записаны буквально, а не через «больше или равно»:
 * существующие проверки (production38) сверяют разделы МЕЖДУ СОБОЙ и
 * сравнивают эталон САМ С СОБОЙ — они ловят рассогласование, но пропускают
 * согласованное изменение конструкции. Базовая версия закрывает именно этот
 * зазор.
 *
 * Эталонный проект — тот же самый, единственный: test/golden/goldenProject.
 * Второй эталон не заводится.
 *
 * Устойчивость утверждений: ни одно значение здесь не зависит от случайных
 * id, времени, порядка обхода и окружения. Детали сверяются по стабильному
 * ключу (metadata.key) и типу, списки сортируются, материалы называются по
 * имени, дробные миллиметры сравниваются с допуском.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildGoldenProject, project, store, mm, key, snapshotOf } from './golden/goldenProject';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { runCutting } from '@/engines/cutting';
import { buildSpecification } from '@/engines/bom/specification';
import { buildHardwareLedger } from '@/engines/bom/hardwareLedger';
import { productionParts } from '@/engines/production';
import { buildPartsDocument, documentToSvgPages } from '@/engines/drawing';
import { edgeSummary, totalEdgeLength } from '@/engines/edges';
import { serializeProject, deserializeProject } from '@/storage/project/serialization';
import { validateProjectModel } from '@/engines/status';
import type { Part } from '@/core/model/types';

/** Размер детали как его читает цех: длина × ширина × толщина. */
const size = (p: Part) => `${mm(p.width)}×${mm(p.height)}×${mm(p.thickness)}`;

/** Сколько деталей каждого конструктивного типа. Сортировка — по имени типа. */
function countsByType(parts: Part[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of parts) {
    const t = String(p.metadata?.partType ?? '?');
    out[t] = (out[t] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * СОСТАВ БАЗОВОЙ ВЕРСИИ. Снято с версии 1.0.0 запуском эталонного проекта.
 */
const BASELINE_PART_COUNTS: Record<string, number> = {
  back: 3,
  bottom: 2,
  divider: 2,
  drawer_back: 3,
  drawer_bottom: 3,
  drawer_front: 3,
  drawer_side: 6,
  facade: 3,
  shelf: 15,
  side_left: 2,
  side_right: 2,
  top: 2,
};

const BASELINE_PARTS_TOTAL = 46;

/** Размеры деталей базовой версии: тип → отсортированный список размеров. */
const BASELINE_SIZES: Record<string, string[]> = {
  back: ['2368×1184×3', '2368×1184×3', '768×788×3'],
  bottom: ['2368×600×16', '768×560×16'],
  divider: ['597×2368×16', '597×2368×16'],
  drawer_back: ['710×251×16', '710×252×16', '710×252×16'],
  drawer_bottom: ['726×499×3', '726×499×3', '726×499×3'],
  drawer_front: ['796×268×16', '796×268×16', '796×268×16'],
  drawer_side: ['507×251×16', '507×251×16', '507×252×16', '507×252×16', '507×252×16', '507×252×16'],
  facade: ['796.67×2396×16', '796.67×2396×16', '796.67×2396×16'],
  shelf: [
    '768×537×16', '768×537×16', '768×537×16',
    '773.33×577×16', '773.33×577×16', '773.33×577×16', '773.33×577×16',
    '781.33×577×16', '781.33×577×16', '781.33×577×16', '781.33×577×16',
    '781.33×577×16', '781.33×577×16', '781.33×577×16', '781.33×577×16',
  ],
  side_left: ['560×820×16', '600×2400×16'],
  side_right: ['560×820×16', '600×2400×16'],
  top: ['2368×600×16', '768×560×16'],
};

/** Фурнитура базовой версии: имя → количество, посчитанное из соединений. */
const BASELINE_HARDWARE: Record<string, number> = {
  'Конфирмат 7×50': 146,
  'Направляющая роликовая 450': 6,
  'Петля чашечная 35 мм': 15,
  'Полкодержатель Ø5': 0,
  'Ручка 96 мм': 3,
  'Шкант 8×30': 0,
};

const BASELINE_OPERATIONS = 356;
const BASELINE_CONNECTIONS = 66;
const BASELINE_EDGE_LENGTH_MM = 14038;
const BASELINE_EDGE_PIECES = 18;
const BASELINE_CUTTING_JOBS = 2;
const BASELINE_CUTTING_SHEETS = [3, 6];

describe('Этап 46 · производственный результат базовой версии зафиксирован', () => {
  beforeEach(() => { buildGoldenProject(); });

  it('§7/§8 состав деталей эталона не изменился', () => {
    const parts = allParts(project());
    expect(parts).toHaveLength(BASELINE_PARTS_TOTAL);
    expect(countsByType(parts)).toEqual(BASELINE_PART_COUNTS);
  });

  it('§7/§8 размеры деталей эталона не изменились', () => {
    const parts = allParts(project());
    const actual: Record<string, string[]> = {};
    for (const p of parts) {
      const t = String(p.metadata?.partType ?? '?');
      (actual[t] ??= []).push(size(p));
    }
    for (const t of Object.keys(actual)) actual[t].sort();
    expect(actual).toEqual(BASELINE_SIZES);
  });

  it('§8 присадка, соединения и фурнитура эталона не изменились', () => {
    const p = project();
    expect(allOperations(p)).toHaveLength(BASELINE_OPERATIONS);
    expect(p.hardwareConnections).toHaveLength(BASELINE_CONNECTIONS);

    const ledger = Object.fromEntries(
      buildHardwareLedger(p.hardware, p.hardwareConnections)
        .map((r) => [r.name, r.count] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(ledger).toEqual(BASELINE_HARDWARE);
  });

  it('§8 расход кромки эталона не изменился', () => {
    const rows = edgeSummary(project());
    expect(rows).toHaveLength(1);
    expect(rows[0].materialName).toBe('Кромка ABS 0.4 мм');
    expect(rows[0].pieceCount).toBe(BASELINE_EDGE_PIECES);
    // Допуск: длина складывается из дробных размеров, хвост double не важен.
    expect(totalEdgeLength(project())).toBeCloseTo(BASELINE_EDGE_LENGTH_MM, 2);
  });

  it('§8 раскрой эталона укладывается в то же число листов', () => {
    const report = runCutting(project());
    expect(report.jobs).toHaveLength(BASELINE_CUTTING_JOBS);
    expect(report.jobs.map((j) => j.sheets.length).sort((a, b) => a - b))
      .toEqual(BASELINE_CUTTING_SHEETS);
    expect(report.jobs.flatMap((j) => j.unplaced)).toHaveLength(0);
  });

  it('§9 критический конвейер модель → раскрой → спецификация → цех → документы цел', () => {
    const p = project();
    const parts = allParts(p);

    // Раскрой размещает каждую деталь с материалом — и ничего сверх того.
    const report = runCutting(p);
    const placed = report.jobs.flatMap((j) => j.sheets.flatMap((s) => s.placements));
    expect(placed).toHaveLength(parts.filter((x) => x.material).length);

    // Спецификация и задание цеха — строка на деталь.
    expect(buildSpecification(parts, p.materials, p.edges).rows).toHaveLength(BASELINE_PARTS_TOTAL);
    expect(productionParts(p)).toHaveLength(BASELINE_PARTS_TOTAL);

    // Документы печатаются и содержат страницы.
    const pages = documentToSvgPages(buildPartsDocument(p));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((svg) => svg.includes('<svg'))).toBe(true);

    // Модель остаётся корректной — конвейер не портит источник истины.
    expect(validateProjectModel(p).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('§10 сохранение и открытие возвращают тот же производственный снимок', () => {
    const before = snapshotOf(project());
    const file = serializeProject(project());

    store().newProject('Другой проект');
    expect(allParts(project())).not.toHaveLength(BASELINE_PARTS_TOTAL);

    store().loadProject(deserializeProject(file));
    expect(snapshotOf(project())).toEqual(before);
    expect(allParts(project())).toHaveLength(BASELINE_PARTS_TOTAL);
  });

  it('§10 экспорт и импорт не теряют присадку, кромку и фурнитуру', () => {
    const opsBefore = allOperations(project()).length;
    const edgeBefore = totalEdgeLength(project());
    const file = serializeProject(project());

    store().newProject('Пустой');
    store().loadProject(deserializeProject(file));

    expect(allOperations(project())).toHaveLength(opsBefore);
    expect(totalEdgeLength(project())).toBeCloseTo(edgeBefore, 6);
    expect(project().hardwareConnections).toHaveLength(BASELINE_CONNECTIONS);
  });

  it('§11 ключи деталей стабильны: снимок не зависит от случайных id', () => {
    const first = snapshotOf(project()).map((s) => `${s.key}|${s.partType}|${s.width}×${s.height}`);
    const idsFirst = allParts(project()).map((p) => String(p.id));

    buildGoldenProject();
    const second = snapshotOf(project()).map((s) => `${s.key}|${s.partType}|${s.width}×${s.height}`);
    const idsSecond = allParts(project()).map((p) => String(p.id));

    // Снимок совпадает…
    expect(second).toEqual(first);
    // …при этом id действительно другие — значит, тест держится не за них.
    expect(idsSecond).not.toEqual(idsFirst);
  });

  it('§11 повторный расчёт даёт тот же результат: порядок и время ни на что не влияют', () => {
    const once = runCutting(project());
    const twice = runCutting(project());
    const shape = (r: ReturnType<typeof runCutting>) =>
      r.jobs.map((j) => ({
        sheets: j.sheets.length,
        placements: j.sheets
          .flatMap((s) => s.placements.map((pl) => `${mm(pl.length)}×${mm(pl.width)}@${mm(pl.x)},${mm(pl.y)}`))
          .sort(),
      }));
    expect(shape(twice)).toEqual(shape(once));

    const keys = allParts(project()).map(key).sort();
    expect(keys).toEqual([...keys].sort());
  });
});
