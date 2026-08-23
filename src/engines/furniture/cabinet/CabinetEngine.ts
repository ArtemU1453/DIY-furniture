/**
 * Параметрический движок корпусного шкафа.
 *
 *   CabinetParameters → computeCabinetContext → ConstructionRule[] →
 *   PanelSpec[] → Part[]
 *
 * Реализует общий интерфейс FurnitureEngine, поэтому подключается к системе без
 * изменения вызывающего кода. Русские названия берутся из i18n по типу детали.
 */
import type { Furniture, Part, PartRole, Section } from '@/core/model/types';
import { newPartId } from '@/core/model/ids';
import { partTypeName, type PartType } from '@/i18n/partNames';
import type { FurnitureEngine } from '../FurnitureEngine';
import { readCabinetParameters, type CabinetParameters } from './parameters';
import { computeCabinetContext } from './context';
import { CABINET_RULES } from './rules';
import { panelToPartFields, type PanelSpec } from './panel';

const ROLE_BY_TYPE: Record<PartType, PartRole> = {
  side_left: 'side',
  side_right: 'side',
  top: 'top',
  bottom: 'bottom',
  shelf: 'shelf',
  divider: 'divider',
  back: 'back',
};

function pad(n: number): string {
  return `P${String(n).padStart(3, '0')}`;
}

/** Построить деталь из PanelSpec. */
function specToPart(spec: PanelSpec, params: CabinetParameters, number: number): Part {
  const fields = panelToPartFields(spec, { width: params.width, depth: params.depth });
  return {
    id: newPartId(),
    name: partTypeName(spec.partType, spec.index),
    role: ROLE_BY_TYPE[spec.partType],
    width: fields.width,
    height: fields.height,
    thickness: fields.thickness,
    material: spec.material,
    grain: spec.grain ?? 'none',
    quantity: 1,
    edges: { left: null, right: null, top: null, bottom: null },
    position: fields.position,
    rotation: fields.rotation,
    machining: [],
    metadata: {
      key: spec.key,
      partType: spec.partType,
      index: spec.index,
      sectionId: spec.sectionId,
      number: pad(number),
    },
  };
}

export interface CabinetBuildResult {
  parts: Part[];
  sections: Section[];
}

/** Собрать детали и секции шкафа из параметров (чистая функция). */
export function buildCabinet(params: CabinetParameters): CabinetBuildResult {
  const ctx = computeCabinetContext(params);
  const specs = CABINET_RULES.flatMap((rule) => rule.build(ctx));
  const parts = specs.map((spec, i) => specToPart(spec, params, i + 1));
  return { parts, sections: ctx.sections };
}

export class CabinetEngine implements FurnitureEngine {
  readonly type = 'cabinet';
  readonly name = 'Шкаф';

  generate(furniture: Furniture): Part[] {
    const params = readCabinetParameters(furniture.params);
    return buildCabinet(params).parts;
  }
}
