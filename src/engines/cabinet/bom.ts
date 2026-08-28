/**
 * Спецификация шкафа (§108–§114).
 *
 * Строки деталей берутся у существующего buildSpecification этапа 08, кромка —
 * у движка edges этапа 21, фурнитура — у hardwareBom этапа 27. Здесь только
 * ГРУППИРОВКА одинаковых деталей (§109) и сведение двух спецификаций в одну
 * ведомость: второго расчёта деталей, кромки или фурнитуры не появляется.
 */
import type { Furniture, Project } from '@/core/model/types';
import { buildSpecification, type SpecRow } from '@/engines/bom/specification';
import { hardwareBom, type HardwareBomRow } from '@/engines/hardware/bom';
import { edgeBandingForPartWith, bandingTotalLength } from '@/engines/edges';

export interface CabinetBomRow {
  /** Ключ группировки: одинаковые детали идут одной строкой (§109). */
  key: string;
  number: string;
  name: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  materialName: string;
  /** Длина кромки одной детали, мм. */
  edgeLength: number;
  /** Номера деталей, попавших в строку. */
  numbers: string[];
}

export interface CabinetBom {
  parts: CabinetBomRow[];
  hardware: HardwareBomRow[];
  totals: {
    partCount: number;
    uniqueRows: number;
    materialAreaM2: number;
    edgeLengthM: number;
    hardwareCount: number;
  };
}

const round = (v: number, digits = 2): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** Ключ группировки: материал + габарит + толщина + кромка (§109/§110). */
export function bomGroupKey(row: SpecRow): string {
  return [
    row.materialName, round(row.length, 1), round(row.width, 1), row.thickness,
    row.edgeLeft, row.edgeRight, row.edgeTop, row.edgeBottom,
  ].join('|');
}

/** Ведомость деталей и фурнитуры изделия или всего проекта (§114). */
export function cabinetBom(project: Project, furniture?: Furniture): CabinetBom {
  const parts = furniture
    ? furniture.assemblies.flatMap((a) => a.parts)
    : project.furnitures.flatMap((f) => f.assemblies.flatMap((a) => a.parts));

  const spec = buildSpecification(parts, project.materials, project.edges);
  const byPartId = new Map(parts.map((p) => [String(p.id), p]));

  const groups = new Map<string, CabinetBomRow>();
  for (const row of spec.rows) {
    const key = bomGroupKey(row);
    const part = byPartId.get(String(row.partId));
    const edgeLength = part
      ? edgeBandingForPartWith(project.edges, part)
        .reduce((sum, banding) => sum + bandingTotalLength(banding), 0)
      : 0;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.numbers.push(row.number);
      continue;
    }
    groups.set(key, {
      key,
      number: row.number,
      name: row.name,
      quantity: row.quantity,
      length: round(row.length, 1),
      width: round(row.width, 1),
      thickness: row.thickness,
      materialName: row.materialName,
      edgeLength: round(edgeLength, 1),
      numbers: [row.number],
    });
  }

  const rows = [...groups.values()].sort((a, b) => a.number.localeCompare(b.number));
  const hardware = hardwareBom(project);
  return {
    parts: rows,
    hardware,
    totals: {
      partCount: spec.totals.partCount,
      uniqueRows: rows.length,
      materialAreaM2: round(spec.totals.materialAreaM2),
      edgeLengthM: round(spec.totals.edgeLengthM),
      hardwareCount: hardware.reduce((sum, r) => sum + r.quantity, 0),
    },
  };
}

/** Спецификация деталей в CSV (§114). Разделитель — точка с запятой. */
export function cabinetBomCsv(bom: CabinetBom): string {
  const header = 'Number;Name;Material;Length;Width;Thickness;Quantity;EdgeLength';
  const lines = bom.parts.map((r) => [
    r.number, r.name, r.materialName, r.length, r.width, r.thickness, r.quantity, r.edgeLength,
  ].join(';'));
  return [header, ...lines].join('\n');
}
