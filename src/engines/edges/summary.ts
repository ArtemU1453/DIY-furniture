/**
 * Расход кромки (§31–§42).
 *
 * Ключевое разделение: РАСЧЁТНАЯ длина — точная геометрия детали, её нельзя
 * округлять (§72); ЗАКУПОЧНАЯ длина — расчётная плюс припуск и округление до
 * шага поставки (§34). Смешивать их нельзя: по расчётной проверяют раскрой,
 * по закупочной покупают ленту.
 */
import type { EdgeBanding, EdgeMaterial, Project } from '@/core/model/types';
import type { EdgeMaterialId } from '@/core/model/ids';
import { allEdgeBanding, bandingTotalLength } from './banding';
import { edgeAllowance } from './operations';

/** Строка сводки по материалу и толщине (§32/§33). */
export interface EdgeSummaryRow {
  materialId: EdgeMaterialId;
  materialName: string;
  thickness: number;
  width: number;
  /** Точная геометрическая длина, мм (§72). */
  lengthMm: number;
  /** Длина с припуском, мм (§39). */
  withAllowanceMm: number;
  /** Округлённая длина для закупки, мм (§34). */
  purchaseMm: number;
  /** Сколько записей кромки вошло в строку. */
  bandingCount: number;
  /** Сколько погонных единиц деталей закромить. */
  pieceCount: number;
}

/** Шаг округления закупочной длины (§72). 0 — не округлять. */
export function purchaseRounding(project: Project): number {
  return project.machining.profile?.edgePurchaseRounding ?? 0;
}

/** Округление вверх до шага. Шаг 0 оставляет значение как есть. */
export function roundUpTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Сводка расхода, сгруппированная по материалу И толщине (§32/§33).
 *
 * Группировка идёт по паре (материал, толщина), а не по одному материалу:
 * ABS 1 мм и ABS 2 мм — разные ленты, складывать их метраж нельзя.
 */
export function edgeSummary(project: Project): EdgeSummaryRow[] {
  const allowance = edgeAllowance(project);
  const rounding = purchaseRounding(project);
  const byName = new Map<string, EdgeMaterial>(project.edges.map((e) => [String(e.id), e]));
  const groups = new Map<string, EdgeSummaryRow>();

  for (const banding of allEdgeBanding(project)) {
    const key = `${String(banding.materialId)}|${banding.thickness}`;
    const material = byName.get(String(banding.materialId));
    const row = groups.get(key) ?? {
      materialId: banding.materialId,
      materialName: material?.name ?? 'Материал не найден',
      thickness: banding.thickness,
      width: banding.width,
      lengthMm: 0,
      withAllowanceMm: 0,
      purchaseMm: 0,
      bandingCount: 0,
      pieceCount: 0,
    };
    const exact = bandingTotalLength(banding);
    row.lengthMm += exact;
    row.withAllowanceMm += exact + allowance * banding.quantity;
    row.bandingCount += 1;
    row.pieceCount += banding.quantity;
    groups.set(key, row);
  }

  const rows = [...groups.values()];
  for (const row of rows) row.purchaseMm = roundUpTo(row.withAllowanceMm, rounding);
  // Сначала самый расходуемый материал — с него начинают закупку и работу.
  rows.sort((a, b) => b.lengthMm - a.lengthMm || a.materialName.localeCompare(b.materialName));
  return rows;
}

/** Общая длина кромки проекта, мм (расчётная). */
export function totalEdgeLength(project: Project): number {
  return allEdgeBanding(project).reduce((n, b) => n + bandingTotalLength(b), 0);
}

/** Метры из миллиметров — для отображения (§73). */
export function meters(mm: number): number {
  return mm / 1000;
}

/**
 * Задание на кромкование (§37). Одно задание = одна лента (материал +
 * толщина): смешивать разные ленты в одном задании нельзя.
 *
 * Потребность объединяется по расчёту, но сами детали НЕ объединяются (§41):
 * каждая остаётся отдельной строкой производственного списка.
 */
export interface EdgeCuttingJob {
  id: string;
  materialId: EdgeMaterialId;
  materialName: string;
  thickness: number;
  width: number;
  banding: EdgeBanding[];
  /** Суммарная потребность с припуском, мм (§38). */
  requiredMm: number;
  /** Закупочная длина, мм (§34). */
  purchaseMm: number;
}

/** Задания на кромкование, отсортированные по материалу (§71). */
export function edgeCuttingJobs(project: Project): EdgeCuttingJob[] {
  const allowance = edgeAllowance(project);
  const rounding = purchaseRounding(project);
  const byName = new Map(project.edges.map((e) => [String(e.id), e]));
  const groups = new Map<string, EdgeCuttingJob>();

  for (const banding of allEdgeBanding(project)) {
    const key = `${String(banding.materialId)}|${banding.thickness}`;
    const material = byName.get(String(banding.materialId));
    const job = groups.get(key) ?? {
      id: `edgejob-${key}`,
      materialId: banding.materialId,
      materialName: material?.name ?? 'Материал не найден',
      thickness: banding.thickness,
      width: banding.width,
      banding: [],
      requiredMm: 0,
      purchaseMm: 0,
    };
    job.banding.push(banding);
    job.requiredMm += bandingTotalLength(banding) + allowance * banding.quantity;
    groups.set(key, job);
  }

  const jobs = [...groups.values()];
  for (const job of jobs) {
    job.purchaseMm = roundUpTo(job.requiredMm, rounding);
    // Внутри задания — по детали и стороне, чтобы список был предсказуем.
    job.banding.sort((a, b) => String(a.partId).localeCompare(String(b.partId)) || a.side.localeCompare(b.side));
  }
  jobs.sort((a, b) => a.materialName.localeCompare(b.materialName) || a.thickness - b.thickness);
  return jobs;
}

/** Расход рулона (§40): использовано, отход, остаток. */
export interface EdgeRollUsage {
  requiredMm: number;
  rollLengthMm: number;
  rollsNeeded: number;
  /** Остаток последнего рулона, мм. */
  remainderMm: number;
  /** Технологический отход (припуск), мм. */
  wasteMm: number;
}

/**
 * Сколько рулонов нужно и что останется (§40). Остаток последнего рулона —
 * не отход: его можно пустить в следующий проект.
 */
export function rollUsage(job: EdgeCuttingJob, rollLengthMm: number, allowanceMm = 0): EdgeRollUsage {
  if (rollLengthMm <= 0) {
    return { requiredMm: job.requiredMm, rollLengthMm: 0, rollsNeeded: 0, remainderMm: 0, wasteMm: 0 };
  }
  const rollsNeeded = Math.ceil(job.requiredMm / rollLengthMm);
  const remainderMm = rollsNeeded * rollLengthMm - job.requiredMm;
  const pieces = job.banding.reduce((n, b) => n + b.quantity, 0);
  return { requiredMm: job.requiredMm, rollLengthMm, rollsNeeded, remainderMm, wasteMm: allowanceMm * pieces };
}
