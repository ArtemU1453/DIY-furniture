/**
 * Очередь заданий раскроя (§90–§94) и передача площади в стоимость (§104–§106).
 *
 * Раскрой всегда идёт по группам «материал + толщина» (§90): 16 и 18 мм не
 * попадают на один лист. Очередь — это ПОРЯДОК обработки таких групп, который
 * пользователь может менять (§94); сам расчёт групп остаётся за buildInput.
 */
import type { CuttingResult, Material, Project } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';

export interface CuttingQueueItem {
  /** Ключ группы: материал + толщина. */
  key: string;
  materialId: MaterialId;
  materialName: string;
  thickness: number;
  /** Деталей в группе (с учётом количества). */
  parts: number;
  /** Листов по последнему расчёту; 0 — ещё не считалось. */
  sheets: number;
  /** Позиция в очереди, начиная с 1 (§94). */
  priority: number;
}

export function queueKey(materialId: unknown, thickness: number): string {
  return `${String(materialId)}:${thickness}`;
}

/**
 * Построить очередь групп (§93). Порядок по умолчанию — по убыванию числа
 * деталей: самая большая группа считается первой, её результат виден сразу.
 */
export function buildCuttingQueue(project: Project, order: string[] = []): CuttingQueueItem[] {
  const materials = new Map<string, Material>(project.materials.map((m) => [String(m.id), m]));
  const results = new Map<string, CuttingResult>(
    (project.cutting.report?.jobs ?? []).map((r) => [String(r.materialId), r]),
  );

  const groups = new Map<string, CuttingQueueItem>();
  for (const part of allParts(project)) {
    if (!part.material) continue;
    const material = materials.get(String(part.material));
    if (!material) continue;
    const thickness = part.thickness || material.thickness;
    const key = queueKey(part.material, thickness);
    const item = groups.get(key) ?? {
      key,
      materialId: part.material,
      materialName: material.name,
      thickness,
      parts: 0,
      sheets: results.get(String(part.material))?.sheets.length ?? 0,
      priority: 0,
    };
    item.parts += part.quantity || 1;
    groups.set(key, item);
  }

  const items = [...groups.values()];
  const explicit = new Map(order.map((key, index) => [key, index]));
  items.sort((a, b) => {
    const ai = explicit.get(a.key);
    const bi = explicit.get(b.key);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return b.parts - a.parts || a.key.localeCompare(b.key);
  });
  return items.map((item, index) => ({ ...item, priority: index + 1 }));
}

/** Переставить группу в очереди (§94). */
export function moveQueueItem(order: string[], key: string, delta: number): string[] {
  const list = [...order];
  const index = list.indexOf(key);
  if (index < 0) return list;
  const target = Math.max(0, Math.min(list.length - 1, index + delta));
  if (target === index) return list;
  list.splice(index, 1);
  list.splice(target, 0, key);
  return list;
}

/** Порядок очереди в виде списка ключей — его хранит проект. */
export function queueOrder(items: CuttingQueueItem[]): string[] {
  return items.map((i) => i.key);
}

// ── Стоимость (§104–§106) ────────────────────────────────────────────────────

/**
 * Стоимость материала по РЕЗУЛЬТАТУ раскроя.
 *
 * Второго калькулятора цен не создаётся (§106): цены берутся из существующего
 * Material.cost, а раскрой лишь передаёт площадь и число листов. Если цена не
 * задана или расчёт стоимости выключен — возвращается null, а не ноль: «нет
 * данных» и «бесплатно» не одно и то же.
 */
export interface CuttingCost {
  materialId: string;
  materialName: string;
  currency: string;
  sheets: number;
  usedAreaM2: number;
  wasteAreaM2: number;
  /** Стоимость израсходованного материала (по листам либо по площади). */
  materialCost: number;
  /** Стоимость отхода в той же логике. */
  wasteCost: number;
}

export function cuttingCost(project: Project, result: CuttingResult): CuttingCost | null {
  if (project.settings?.costEnabled !== true) return null;
  const material = project.materials.find((m) => String(m.id) === String(result.materialId));
  const cost = material?.cost;
  if (!material || !cost || (cost.perSheet === undefined && cost.perSquareMeter === undefined)) return null;

  const sheets = result.sheets.length;
  const usedAreaM2 = result.sheets.reduce((sum, s) => sum + s.usedAreaMm2, 0) / 1_000_000;
  const wasteAreaM2 = result.sheets.reduce((sum, s) => sum + s.wasteAreaMm2, 0) / 1_000_000;
  const sheetAreaM2 = result.sheets.reduce((sum, s) => sum + s.usableAreaMm2, 0) / 1_000_000;

  const materialCost = cost.perSheet !== undefined
    ? cost.perSheet * sheets
    : (cost.perSquareMeter ?? 0) * sheetAreaM2;
  const wasteCost = cost.perSheet !== undefined
    ? (sheetAreaM2 > 0 ? (materialCost * wasteAreaM2) / sheetAreaM2 : 0)
    : (cost.perSquareMeter ?? 0) * wasteAreaM2;

  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    materialId: String(result.materialId),
    materialName: material.name,
    currency: cost.currency ?? '₽',
    sheets,
    usedAreaM2: round(usedAreaM2),
    wasteAreaM2: round(wasteAreaM2),
    materialCost: round(materialCost),
    wasteCost: round(wasteCost),
  };
}

/** Стоимость по всем заданиям проекта (§105). */
export function projectCuttingCost(project: Project): CuttingCost[] {
  return (project.cutting.report?.jobs ?? [])
    .map((result) => cuttingCost(project, result))
    .filter((c): c is CuttingCost => c !== null);
}
