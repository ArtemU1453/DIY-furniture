/**
 * EDGE_LIST (§59/§62/§63) — ведомость кромки.
 *
 * Две таблицы в одном документе: построчный список «что и где кромить» и
 * итоговый расход по материалам. Документ ничего не считает сам — берёт
 * готовый результат движка кромки, поэтому чертёж и производственный список
 * не могут разойтись.
 */
import type { Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import {
  SIDE_LABELS,
  allEdgeBanding,
  bandingTotalLength,
  edgeSummary,
  meters,
} from '@/engines/edges';
import { fmtMm } from './notation';
import { tablePages } from './specification';
import type { TableColumn } from './table';
import type { DrawingDocument } from './sheet';

export interface EdgeListRow {
  part: string;
  side: string;
  material: string;
  thickness: number;
  width: number;
  length: number;
  quantity: number;
  totalMm: number;
}

/** Строки ведомости кромки (§30). */
export function edgeListRows(project: Project): EdgeListRow[] {
  const names = new Map(project.edges.map((e) => [String(e.id), e.name]));
  const rows = allEdgeBanding(project).map((b) => {
    const part = findPart(project, b.partId);
    const number = (part?.metadata?.number as string) ?? '';
    return {
      part: `${number} ${part?.name ?? ''}`.trim(),
      side: SIDE_LABELS[b.side],
      material: names.get(String(b.materialId)) ?? 'не найден',
      thickness: b.thickness,
      width: b.width,
      length: b.length,
      quantity: b.quantity,
      totalMm: bandingTotalLength(b),
    };
  });
  // По детали, затем по стороне — так лист удобно обходить в цехе.
  rows.sort((a, b) => a.part.localeCompare(b.part, 'ru') || a.side.localeCompare(b.side, 'ru'));
  return rows;
}

/** Итоговый расход по материалам для документа (§63). */
export function edgeSummaryRowsForDocument(project: Project): string[][] {
  return edgeSummary(project).map((r) => [
    r.materialName,
    fmtMm(r.thickness),
    fmtMm(r.width),
    meters(r.lengthMm).toFixed(2),
    meters(r.purchaseMm).toFixed(2),
  ]);
}

export function buildEdgeListDocument(project: Project): DrawingDocument {
  const cols: TableColumn[] = [
    { title: 'Деталь', width: 70 },
    { title: 'Сторона', width: 24 },
    { title: 'Кромка', width: 56 },
    { title: 'Толщ.', width: 18, align: 'end' },
    { title: 'Шир.', width: 18, align: 'end' },
    { title: 'Длина', width: 22, align: 'end' },
    { title: 'Кол-во', width: 20, align: 'end' },
    { title: 'Итого, мм', width: 26, align: 'end' },
  ];
  const rows = edgeListRows(project).map((r) => [
    r.part,
    r.side,
    r.material,
    fmtMm(r.thickness),
    fmtMm(r.width),
    fmtMm(r.length),
    String(r.quantity),
    fmtMm(r.totalMm),
  ]);

  const pages = tablePages(project, 'EDGE_LIST', 'Ведомость кромки', cols, rows);

  // Итоговый расход — отдельным листом, чтобы его можно было отдать в закупку.
  const summaryCols: TableColumn[] = [
    { title: 'Кромка', width: 90 },
    { title: 'Толщина', width: 26, align: 'end' },
    { title: 'Ширина', width: 26, align: 'end' },
    { title: 'Расчёт, м', width: 30, align: 'end' },
    { title: 'К закупке, м', width: 32, align: 'end' },
  ];
  const summaryPages = tablePages(
    project, 'EDGE_LIST', 'Расход кромки', summaryCols, edgeSummaryRowsForDocument(project),
  );

  return {
    id: `doc-edgelist-${project.id}`,
    type: 'EDGE_LIST',
    projectId: project.id,
    title: 'Ведомость кромки',
    pages: [...pages, ...summaryPages],
  };
}
