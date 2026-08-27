/**
 * Построение входных данных раскроя из производственной модели.
 *
 *   Furniture → Parts → Materials → CuttingInput (по материалам)
 *
 * Детали разворачиваются по количеству в отдельные экземпляры (P001#1, P001#2…),
 * исходный Part остаётся одним объектом. Детали группируются по материалу —
 * разные материалы раскраиваются независимо.
 */
import type { Material, Project, SheetMaterial } from '@/core/model/types';
import type { MaterialId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import type { CuttingInput, CuttingPieceInstance, RemnantSheet } from './types';

function planeDims(part: { width: number; height: number }): { length: number; width: number } {
  return { length: Math.max(part.width, part.height), width: Math.min(part.width, part.height) };
}

/** Экземпляры деталей для раскроя, сгруппированные по материалу. */
export function buildPieceInstances(project: Project): Map<MaterialId, CuttingPieceInstance[]> {
  const byMaterial = new Map<MaterialId, CuttingPieceInstance[]>();
  const materials = new Map(project.materials.map((m) => [m.id, m]));

  for (const part of allParts(project)) {
    if (!part.material) continue;
    const material = materials.get(part.material);
    if (!material) continue;
    const { length, width } = planeDims(part);
    const number = (part.metadata?.number as string) ?? '';
    for (let i = 1; i <= part.quantity; i++) {
      const piece: CuttingPieceInstance = {
        pieceId: `${part.id}#${i}`,
        partId: part.id,
        name: part.name,
        number,
        length,
        width,
        grain: material.grain,
        allowRotate: material.allowRotate,
        materialId: part.material,
        edges: part.edges,
      };
      (byMaterial.get(part.material) ?? byMaterial.set(part.material, []).get(part.material)!).push(piece);
    }
  }
  return byMaterial;
}

/**
 * Форматы листа для материала в порядке приоритета (§23/§24):
 * 1) явный приоритет (sheetPriority), 2) выбранный формат, 3) остальные
 * форматы библиотеки по убыванию площади. Алгоритм пробует их по очереди.
 */
export function sheetFormatsFor(project: Project, material: Material): SheetMaterial[] {
  const forMaterial = project.sheets.filter((s) => s.materialId === material.id);
  if (forMaterial.length === 0) return [];
  const byId = new Map(forMaterial.map((s) => [s.id, s]));
  const out: SheetMaterial[] = [];
  const seen = new Set<string>();
  const push = (sh: SheetMaterial | undefined) => {
    if (sh && !seen.has(sh.id)) { seen.add(sh.id); out.push(sh); }
  };
  for (const id of project.cutting.settings.sheetPriority[material.id] ?? []) push(byId.get(id));
  push(byId.get(project.cutting.settings.sheetSelection[material.id]));
  for (const sh of [...forMaterial].sort((a, b) => b.height * b.width - a.height * a.width)) push(sh);
  return out;
}

/** Выбранный формат листа из библиотеки для материала (или из материала). */
function selectedSheet(project: Project, material: Material): SheetMaterial | undefined {
  return sheetFormatsFor(project, material)[0];
}

function sheetFor(project: Project, material: Material): { length: number; width: number; sheetMaterialId?: string; availableQuantity?: number } {
  const override = project.cutting.settings.sheetOverrides[material.id];
  if (override) return { length: override.length, width: override.width };
  const chosen = selectedSheet(project, material);
  if (chosen) {
    return { length: chosen.height, width: chosen.width, sheetMaterialId: chosen.id, availableQuantity: chosen.availableQuantity };
  }
  return { length: material.sheet.length, width: material.sheet.width };
}

function kerfFor(project: Project, material: Material): number {
  return project.cutting.settings.kerfOverride ?? material.kerf ?? project.settings.kerf;
}

/** Переиспользуемые остатки для материала (если включено использование остатков). */
function remnantSheetsFor(project: Project, materialId: MaterialId): RemnantSheet[] {
  if (!project.cutting.settings.useRemnants) return [];
  return project.remnants
    .filter((r) => r.materialId === materialId)
    .map((r) => ({ id: r.id, length: Math.max(r.width, r.height), width: Math.min(r.width, r.height) }));
}

/** Построить входы раскроя (по одному на материал с деталями). */
export function buildCuttingInputs(project: Project, materialFilter?: MaterialId): CuttingInput[] {
  const instances = buildPieceInstances(project);
  const settings = project.cutting.settings;
  const materials = new Map(project.materials.map((m) => [m.id, m]));
  const inputs: CuttingInput[] = [];

  for (const [materialId, pieces] of instances) {
    if (materialFilter && materialId !== materialFilter) continue;
    const material = materials.get(materialId);
    if (!material) continue;
    const locked = settings.locked.filter((l) => pieces.some((p) => p.pieceId === l.pieceId));
    const sheet = sheetFor(project, material);
    // Альтернативные форматы (для деталей, не влезающих в предпочтительный).
    const alternates = sheetFormatsFor(project, material)
      .slice(1)
      .map((sh) => ({ id: sh.id, length: sh.height, width: sh.width, availableQuantity: sh.availableQuantity }));
    inputs.push({
      materialId,
      pieces,
      sheet: { length: sheet.length, width: sheet.width },
      sheetMaterialId: sheet.sheetMaterialId,
      availableQuantity: sheet.availableQuantity,
      alternateSheets: alternates,
      remnantSheets: remnantSheetsFor(project, materialId),
      kerf: kerfFor(project, material),
      trim: { ...settings.trim },
      options: {
        respectGrain: settings.respectGrain,
        attempts: settings.attempts,
        sortStrategy: settings.sortStrategy,
        minRemnant: settings.minRemnant,
        optimizationMode: settings.optimizationMode,
        usableRemnant: { ...settings.usableRemnant },
      },
      locked,
    });
  }
  return inputs;
}

/** Простой детерминированный хэш строки (djb2). */
function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Сигнатура производственной модели, влияющей на раскрой. Если она изменилась —
 * сохранённый результат раскроя устарел (см. isCuttingStale).
 */
export function productionSignature(project: Project): string {
  const s = project.cutting.settings;
  const parts = allParts(project)
    .filter((p) => p.material)
    .map((p) => `${p.id}:${p.width}x${p.height}x${p.thickness}:${p.material}:${p.quantity}`)
    .sort();
  const mats = project.materials
    .map((m) => `${m.id}:${m.thickness}:${m.sheet.length}x${m.sheet.width}:${m.grain}:${m.allowRotate}`)
    .sort();
  const sheets = project.sheets
    .map((sh) => `${sh.id}:${sh.materialId}:${sh.height}x${sh.width}x${sh.thickness}:${sh.grainDirection}:${sh.availableQuantity}`)
    .sort();
  const remnants = project.cutting.settings.useRemnants
    ? project.remnants.map((r) => `${r.id}:${r.materialId}:${r.width}x${r.height}`).sort()
    : [];
  const cfg = [
    `kerf:${s.kerfOverride ?? 'mat'}`,
    `trim:${s.trim.left},${s.trim.right},${s.trim.top},${s.trim.bottom}`,
    `grain:${s.respectGrain}`,
    `attempts:${s.attempts}`,
    `sort:${s.sortStrategy}`,
    `minRemnant:${s.minRemnant}`,
    `overrides:${JSON.stringify(s.sheetOverrides)}`,
    `settingsKerf:${project.settings.kerf}`,
    `mode:${s.optimizationMode}`,
    `algo:${s.algorithm}`,
    `usable:${s.usableRemnant.minWidth},${s.usableRemnant.minLength},${s.usableRemnant.minArea}`,
    `useRemnants:${s.useRemnants}`,
    `selection:${JSON.stringify(s.sheetSelection)}`,
    `priority:${JSON.stringify(s.sheetPriority)}`,
    `fewerSheets:${s.preferFewerSheets}`,
  ];
  return hash([...parts, ...mats, ...sheets, ...remnants, ...cfg].join('|'));
}

/** Устарел ли сохранённый результат раскроя относительно текущей модели. */
export function isCuttingStale(project: Project): boolean {
  const report = project.cutting.report;
  if (!report) return true;
  return report.sourceVersion !== productionSignature(project);
}
