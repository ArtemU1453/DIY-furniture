/**
 * Производственные данные детали (§4–§16, §29).
 *
 * Это ПРОЕКЦИЯ детали ProjectModel на нужды цеха: тот же Part, но с готовым
 * номером, ревизией, статусом, кромкой по сторонам и присадкой по граням.
 * Второй системы деталей не появляется — всё выводится из модели при обращении.
 */
import type {
  EdgeMaterial,
  EdgeSide,
  GrainDirection,
  MachiningOperation,
  Material,
  Part,
  ProductionPartStatus,
  Project,
} from '@/core/model/types';
import type { MaterialId, PartId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { edgeBandingWith } from '@/engines/edges';

/** Кромка одной стороны детали (§12–§14). */
export interface ProductionEdge {
  side: EdgeSide;
  edgeMaterialId: string | null;
  materialName: string;
  /** Толщина ленты, мм (§14). */
  edgeThickness: number;
  /** Условное обозначение стороны: К1…К4 (§16). */
  label: string;
  /** Длина стороны, мм. */
  length: number;
}

/** Операция присадки с производственным порядком (§17–§29). */
export interface ProductionOperation {
  id: string;
  /** Порядковый номер операции в детали, начиная с 1 (§29). */
  operationIndex: number;
  type: MachiningOperation['type'];
  face: MachiningOperation['face'];
  x: number;
  y: number;
  diameter?: number;
  depth?: number;
  length?: number;
  width?: number;
  through: boolean;
  /** Откуда операция: фурнитура, правило или рука (§32/§33). */
  source: string;
  hardwareId?: string;
  connectionId?: string;
}

/** Деталь в производстве (§4). */
export interface ProductionPart {
  partId: PartId;
  /** Человекочитаемый номер: P-001 (§6). */
  number: string;
  name: string;
  materialId: MaterialId | null;
  materialName: string;
  thickness: number;
  /** Чистовой размер детали, мм (§10). */
  width: number;
  height: number;
  quantity: number;
  /**
   * Заготовочный размер (§11): чистовой минус наклеенная кромка. Хранится
   * отдельно, потому что пилят заготовку, а измеряют готовую деталь.
   */
  rawWidth: number;
  rawHeight: number;
  grain: GrainDirection;
  edges: ProductionEdge[];
  operations: ProductionOperation[];
  /** Ревизия детали — сигнатура её производственных данных (§8). */
  revision: string;
  status: ProductionPartStatus;
  /** Что не так с деталью, если статус ERROR. */
  issues: string[];
}

/** Обозначения сторон кромки (§16). */
export const EDGE_LABELS: Record<EdgeSide, string> = {
  top: 'К1',
  right: 'К2',
  bottom: 'К3',
  left: 'К4',
};

const EDGE_ORDER: EdgeSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Человекочитаемый номер детали (§6/§7).
 *
 * Номер СТАБИЛЕН: он берётся из metadata.number, который генератор
 * присваивает детали один раз и сохраняет при пересчёте. Если номера нет
 * (деталь добавлена вручную), он выводится из порядка — но уже существующие
 * номера не переприсваиваются.
 */
export function partNumber(part: Part, fallbackIndex: number): string {
  const stored = part.metadata?.number;
  if (typeof stored === 'string' && stored.length > 0) {
    const digits = stored.replace(/\D/g, '');
    return digits.length > 0 ? `P-${digits.padStart(3, '0')}` : stored;
  }
  return `P-${String(fallbackIndex).padStart(3, '0')}`;
}

/** Сигнатура производственных данных детали — она же ревизия (§8/§82). */
export function partRevision(part: Part, operations: MachiningOperation[]): string {
  const edges = EDGE_ORDER.map((side) => part.edges[side] ?? '-').join(',');
  const ops = operations
    .map((op) => `${op.type}:${op.face}:${Math.round(op.x)}:${Math.round(op.y)}:${op.diameter ?? 0}:${op.depth ?? 0}`)
    .sort()
    .join('|');
  const src = [
    part.name,
    part.material ?? '-',
    part.thickness,
    Math.round(part.width * 100) / 100,
    Math.round(part.height * 100) / 100,
    part.quantity,
    part.grain,
    edges,
    ops,
  ].join(';');
  // Короткий детерминированный хэш: одинаковые данные — одинаковая ревизия.
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Кромка детали по сторонам (§12–§14). */
export function productionEdges(part: Part, edgeMaterials: EdgeMaterial[]): ProductionEdge[] {
  return EDGE_ORDER.map((side) => {
    const banding = edgeBandingWith(edgeMaterials, part, side);
    const material = banding
      ? edgeMaterials.find((m) => String(m.id) === String(banding.materialId))
      : undefined;
    return {
      side,
      edgeMaterialId: banding ? String(banding.materialId) : null,
      materialName: material?.name ?? '—',
      edgeThickness: banding?.thickness ?? 0,
      label: EDGE_LABELS[side],
      length: banding?.length ?? (side === 'top' || side === 'bottom' ? part.width : part.height),
    };
  });
}

/** Операции детали в производственном порядке (§29). */
export function productionOperations(operations: MachiningOperation[]): ProductionOperation[] {
  return [...operations]
    .sort((a, b) => a.face.localeCompare(b.face) || a.x - b.x || a.y - b.y || String(a.id).localeCompare(String(b.id)))
    .map((op, index) => ({
      id: String(op.id),
      operationIndex: index + 1,
      type: op.type,
      face: op.face,
      x: op.x,
      y: op.y,
      diameter: op.diameter,
      depth: op.depth,
      length: op.length,
      width: op.width,
      through: op.through === true,
      source: op.source ?? (op.origin === 'manual' ? 'MANUAL' : 'HARDWARE_RULE'),
      hardwareId: op.hardwareId ? String(op.hardwareId) : undefined,
      connectionId: op.sourceHardwareConnectionId ? String(op.sourceHardwareConnectionId) : undefined,
    }));
}

/**
 * Заготовочный размер (§11).
 *
 * Кромка наклеивается на торец, поэтому заготовка меньше готовой детали на
 * толщину ленты с каждой облицованной стороны.
 */
export function rawDimensions(part: Part, edges: ProductionEdge[]): { rawWidth: number; rawHeight: number } {
  const byside = new Map(edges.map((e) => [e.side, e.edgeThickness]));
  const rawWidth = part.width - (byside.get('left') ?? 0) - (byside.get('right') ?? 0);
  const rawHeight = part.height - (byside.get('top') ?? 0) - (byside.get('bottom') ?? 0);
  return {
    rawWidth: Math.round(rawWidth * 100) / 100,
    rawHeight: Math.round(rawHeight * 100) / 100,
  };
}

/** Проверки детали (§70–§74). */
export function partIssues(part: Part, material: Material | undefined): string[] {
  const issues: string[] = [];
  if (!part.material) issues.push(`Детали «${part.name}» не назначен материал.`);
  else if (!material) issues.push(`Материал детали «${part.name}» отсутствует в проекте.`);
  if (!(part.width > 0)) issues.push(`Ширина детали «${part.name}» должна быть больше нуля.`);
  if (!(part.height > 0)) issues.push(`Высота детали «${part.name}» должна быть больше нуля.`);
  if (!(part.thickness > 0)) issues.push(`Толщина детали «${part.name}» должна быть больше нуля.`);
  return issues;
}

/**
 * Производственные детали проекта (§4).
 *
 * `previous` — снимок прошлого расчёта: по нему деталь получает статус NEW или
 * MODIFIED (§9). Без снимка все детали считаются READY.
 */
export function productionParts(
  project: Project,
  previous?: Record<string, string>,
): ProductionPart[] {
  const materials = new Map<string, Material>(project.materials.map((m) => [String(m.id), m]));
  const operations = allOperations(project);
  const byPart = new Map<string, MachiningOperation[]>();
  for (const op of operations) {
    const list = byPart.get(String(op.partId)) ?? [];
    list.push(op);
    byPart.set(String(op.partId), list);
  }

  return allParts(project).map((part, index) => {
    const material = part.material ? materials.get(String(part.material)) : undefined;
    const ops = byPart.get(String(part.id)) ?? [];
    const edges = productionEdges(part, project.edges);
    const issues = partIssues(part, material);
    const revision = partRevision(part, ops);
    const known = previous?.[String(part.id)];

    const status: ProductionPartStatus = issues.length > 0
      ? 'ERROR'
      : previous === undefined
        ? 'READY'
        : known === undefined
          ? 'NEW'
          : known !== revision ? 'MODIFIED' : 'READY';

    return {
      partId: part.id,
      number: partNumber(part, index + 1),
      name: part.name,
      materialId: part.material,
      materialName: material?.name ?? '—',
      thickness: part.thickness,
      width: part.width,
      height: part.height,
      quantity: part.quantity || 1,
      ...rawDimensions(part, edges),
      grain: part.grain,
      edges,
      operations: productionOperations(ops),
      revision,
      status,
      issues,
    };
  });
}

/** Деталь производства по идентификатору. */
export function findProductionPart(parts: ProductionPart[], partId: string): ProductionPart | undefined {
  return parts.find((p) => String(p.partId) === partId);
}
