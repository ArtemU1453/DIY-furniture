/**
 * Материалы, текстура, направление волокна и кромка в сцене (§16–§24).
 *
 * Всё берётся из каталога проекта: сцена не заводит собственных цветов и
 * толщин. Если материал не назначен — показывается нейтральный цвет, а не
 * выдуманный «по умолчанию из кода».
 */
import type { EdgeMaterial, EdgeSide, Material, Part, Project } from '@/core/model/types';
import { edgeBandingWith } from '@/engines/edges';
import type { NodeEdgeBand, NodeMaterial } from './types';

/** Цвет детали без назначенного материала. */
export const NEUTRAL_COLOR = '#c9c4bb';

const EDGE_ORDER: EdgeSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Угол поворота текстуры на детали (§20/§21).
 *
 * `width` — волокно поперёк детали, поэтому текстуру нужно повернуть на 90°;
 * `length` и `none` оставляют её вдоль длины.
 */
export function grainAngle(part: Part): number {
  return part.grain === 'width' ? 90 : 0;
}

/** Материал узла детали (§16–§19). */
export function nodeMaterial(part: Part, materials: Material[]): NodeMaterial {
  const material = part.material
    ? materials.find((m) => String(m.id) === String(part.material))
    : undefined;
  return {
    materialId: material ? String(material.id) : null,
    name: material?.name ?? 'Без материала',
    // §17/§19: реальный цвет материала, иначе нейтральный — не выдуманный.
    color: material?.color ?? NEUTRAL_COLOR,
    textureId: material?.textureId,
    grain: part.grain,
    grainAngle: grainAngle(part),
  };
}

/** Есть ли у материала локальная текстура (§18). */
export function hasTexture(material: NodeMaterial): boolean {
  return typeof material.textureId === 'string' && material.textureId.length > 0;
}

/**
 * Кромка детали для сцены (§22–§24).
 *
 * Считает существующий движок кромки: сцена только переводит результат в
 * визуальные полосы с цветом и толщиной.
 */
export function nodeEdges(part: Part, edges: EdgeMaterial[]): NodeEdgeBand[] {
  const out: NodeEdgeBand[] = [];
  for (const side of EDGE_ORDER) {
    const banding = edgeBandingWith(edges, part, side);
    if (!banding) continue;
    const material = edges.find((e) => String(e.id) === String(banding.materialId));
    out.push({
      side,
      materialId: String(banding.materialId),
      name: material?.name ?? 'Кромка',
      color: material?.color ?? '#8a7f70',
      thickness: banding.thickness,
      length: banding.length,
    });
  }
  return out;
}

/** Предпросмотр материалов проекта (§116/§117). */
export interface MaterialPreviewItem {
  id: string;
  name: string;
  color: string;
  thickness: number;
  textureId?: string;
  /** Сколько деталей проекта уже использует материал. */
  usedBy: number;
}

export function materialPreview(project: Project, parts: Part[]): MaterialPreviewItem[] {
  const used = new Map<string, number>();
  for (const part of parts) {
    if (!part.material) continue;
    const key = String(part.material);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return project.materials
    .filter((m) => !m.archived)
    .map((m) => ({
      id: String(m.id),
      name: m.name,
      color: m.color,
      thickness: m.thickness,
      textureId: m.textureId,
      usedBy: used.get(String(m.id)) ?? 0,
    }));
}
