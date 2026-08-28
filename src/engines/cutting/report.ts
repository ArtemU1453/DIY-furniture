/**
 * Отчёт раскроя (§107–§111).
 *
 * Отчёт — ПРОИЗВОДНЫЙ документ: он ничего не считает заново, а собирает то,
 * что уже посчитали раскрой, спецификация и склад. Печать и PDF выполняет
 * существующая система документов.
 */
import type { CuttingResult, LeftoverSheet, Material, Project } from '@/core/model/types';
import { leftoversOfResult, leftoverSummary, type LeftoverLimits } from './leftovers';
import { cuttingCost, type CuttingCost } from './queue';
// Перевод мм² в м² — общий для всего раскроя, чтобы округление совпадало.
import { m2 } from './metrics';

export interface CuttingReportHeader {
  project: string;
  materialId: string;
  material: string;
  thickness: number;
  sheetSize: string;
  sheetCount: number;
  partCount: number;
  utilization: number;
  wasteAreaM2: number;
  usedAreaM2: number;
}

export interface CuttingReportPart {
  index: number;
  number: string;
  name: string;
  size: string;
  quantity: number;
  material: string;
  sheet: string;
}

export interface CuttingReportSheet {
  id: string;
  index: number;
  size: string;
  usedAreaM2: number;
  wasteAreaM2: number;
  utilization: number;
  parts: number;
}

export interface CuttingReportSection {
  header: CuttingReportHeader;
  sheets: CuttingReportSheet[];
  parts: CuttingReportPart[];
  leftovers: LeftoverSheet[];
  cost: CuttingCost | null;
}

const size = (w: number, h: number): string => `${Math.round(w)} × ${Math.round(h)}`;

/** Раздел отчёта по одному заданию (§108–§111). */
export function reportSection(
  project: Project,
  result: CuttingResult,
  limits?: LeftoverLimits,
): CuttingReportSection {
  const material: Material | undefined = project.materials
    .find((m) => String(m.id) === String(result.materialId));
  const sheets = result.sheets;
  const first = sheets[0];

  const placements = sheets.flatMap((sheet) => sheet.placements.map((p) => ({ sheet, p })));
  // Одинаковые детали в отчёте идут одной строкой с количеством (§110/§60).
  const groups = new Map<string, CuttingReportPart>();
  for (const { sheet, p } of placements) {
    /* Группируем по РАЗМЕРУ, а не по имени: «Полка 1» и «Полка 2» — одна и та
     * же заготовка, и в отчёте это одна строка с количеством (§60/§109). */
    const key = `${Math.round(p.length)}x${Math.round(p.width)}`;
    const row = groups.get(key);
    if (row) {
      row.quantity += 1;
      if (!row.sheet.includes(String(sheet.index + 1))) row.sheet += `, ${sheet.index + 1}`;
      continue;
    }
    groups.set(key, {
      index: groups.size + 1,
      number: p.number,
      name: p.name.replace(/\s+\d+$/, ''),
      size: size(p.length, p.width),
      quantity: 1,
      material: material?.name ?? '—',
      sheet: String(sheet.index + 1),
    });
  }

  return {
    header: {
      project: project.name,
      materialId: String(result.materialId),
      material: material?.name ?? '—',
      thickness: material?.thickness ?? 0,
      sheetSize: first ? size(first.length, first.width) : '—',
      sheetCount: sheets.length,
      partCount: placements.length,
      // utilization в модели — доля 0…1; в отчёте показываем проценты (§56).
      utilization: Math.round(result.statistics.utilization * 1000) / 10,
      wasteAreaM2: m2(sheets.reduce((sum, s) => sum + s.wasteAreaMm2, 0)),
      usedAreaM2: m2(sheets.reduce((sum, s) => sum + s.usedAreaMm2, 0)),
    },
    sheets: sheets.map((sheet) => ({
      id: sheet.id,
      index: sheet.index + 1,
      size: size(sheet.length, sheet.width),
      usedAreaM2: m2(sheet.usedAreaMm2),
      wasteAreaM2: m2(sheet.wasteAreaMm2),
      utilization: Math.round(sheet.utilization * 1000) / 10,
      parts: sheet.placements.length,
    })),
    parts: [...groups.values()],
    leftovers: leftoversOfResult(result, material, limits),
    cost: cuttingCost(project, result),
  };
}

/** Полный отчёт проекта (§107). */
export function cuttingReport(project: Project, limits?: LeftoverLimits): CuttingReportSection[] {
  return (project.cutting.report?.jobs ?? []).map((result) => reportSection(project, result, limits));
}

/** Сводка отчёта — то, что видно на первой странице (§108). */
export interface CuttingReportTotals {
  sections: number;
  sheets: number;
  parts: number;
  utilization: number;
  wasteAreaM2: number;
  usableLeftovers: number;
}

export function reportTotals(sections: CuttingReportSection[]): CuttingReportTotals {
  const sheets = sections.reduce((sum, s) => sum + s.header.sheetCount, 0);
  const parts = sections.reduce((sum, s) => sum + s.header.partCount, 0);
  const utilization = sections.length === 0
    ? 0
    : sections.reduce((sum, s) => sum + s.header.utilization, 0) / sections.length;
  return {
    sections: sections.length,
    sheets,
    parts,
    utilization: Math.round(utilization * 10) / 10,
    wasteAreaM2: Math.round(sections.reduce((sum, s) => sum + s.header.wasteAreaM2, 0) * 100) / 100,
    usableLeftovers: sections.reduce(
      (sum, s) => sum + leftoverSummary(s.leftovers).usable, 0,
    ),
  };
}

/** Отчёт в CSV (§110/§115). Разделитель — точка с запятой. */
export function reportToCsvRows(sections: CuttingReportSection[]): string {
  const header = 'Material;Thickness;Sheet;Number;Part;Size;Quantity';
  const rows: string[] = [];
  for (const section of sections) {
    for (const part of section.parts) {
      rows.push([
        section.header.material, section.header.thickness, part.sheet,
        part.number, part.name, part.size, part.quantity,
      ].join(';'));
    }
  }
  return [header, ...rows].join('\n');
}

/** Таблица остатков отчёта (§111). */
export function leftoverTableCsv(sections: CuttingReportSection[]): string {
  const header = 'Material;Thickness;Width;Height;Status;SourceSheet';
  const rows = sections.flatMap((section) => section.leftovers.map((l) => [
    section.header.material, l.thickness, Math.round(l.width), Math.round(l.height), l.status, l.sourceSheetId,
  ].join(';')));
  return [header, ...rows].join('\n');
}
