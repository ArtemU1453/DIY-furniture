/**
 * MATERIAL_LIST (§25) — ведомость материалов.
 * Колонки: Материал, Толщина, Количество деталей, Общая площадь, Примечание.
 *
 * Площадь считается по габаритам деталей из модели. Если раскрой уже рассчитан,
 * в примечании указывается число листов — но раскрой здесь НЕ пересчитывается.
 */
import type { Project } from '@/core/model/types';
import { allParts } from '@/core/model/selectors';
import { fmtMm } from './notation';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

export interface MaterialListRow {
  material: string;
  thickness: number;
  partCount: number;
  areaM2: number;
  note: string;
}

/** Строки ведомости материалов, сгруппированные по материалу и толщине. */
export function materialListRows(project: Project): MaterialListRow[] {
  const sheetsByMaterial = new Map<string, number>();
  if (project.cutting.report) {
    for (const job of project.cutting.report.jobs) {
      sheetsByMaterial.set(
        String(job.materialId),
        (sheetsByMaterial.get(String(job.materialId)) ?? 0) + job.statistics.sheetCount,
      );
    }
  }

  const groups = new Map<string, MaterialListRow & { materialId: string }>();
  for (const p of allParts(project)) {
    const m = project.materials.find((x) => x.id === p.material);
    const key = `${p.material ?? 'none'}|${p.thickness}`;
    const areaM2 = (p.width * p.height * p.quantity) / 1_000_000;
    const existing = groups.get(key);
    if (existing) {
      existing.partCount += p.quantity;
      existing.areaM2 += areaM2;
    } else {
      groups.set(key, {
        materialId: String(p.material ?? ''),
        material: m?.name ?? 'Материал не задан',
        thickness: p.thickness,
        partCount: p.quantity,
        areaM2,
        note: '',
      });
    }
  }

  const rows = [...groups.values()].map((g) => {
    const sheets = sheetsByMaterial.get(g.materialId);
    return {
      material: g.material,
      thickness: g.thickness,
      partCount: g.partCount,
      areaM2: g.areaM2,
      // Примечание не выдумываем: пишем только то, что действительно известно.
      note: sheets != null ? `Листов по раскрою: ${sheets}` : '',
    };
  });
  rows.sort((a, b) => a.material.localeCompare(b.material, 'ru') || a.thickness - b.thickness);
  return rows;
}

export function buildMaterialListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: 'Материал', width: 80 },
    { title: 'Толщина', width: 24, align: 'end' },
    { title: 'Деталей', width: 24, align: 'end' },
    { title: 'Площадь, м²', width: 30, align: 'end' },
    { title: 'Примечание', width: 70 },
  ];
  const rows = materialListRows(project).map((r) => [
    r.material,
    fmtMm(r.thickness),
    String(r.partCount),
    r.areaM2.toFixed(3),
    r.note,
  ]);
  const pages = tablePages(project, 'MATERIAL_LIST', 'Ведомость материалов', cols, rows);
  return { id: `doc-materiallist-${project.id}`, type: 'MATERIAL_LIST', projectId: project.id, title: 'Ведомость материалов', pages };
}
