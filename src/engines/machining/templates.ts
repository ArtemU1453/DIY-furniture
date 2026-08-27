/**
 * Шаблоны операций (§13/§14/§84).
 *
 * Правило описывается НАБОРОМ ШАБЛОНОВ — данными, а не кодом. Поэтому свою
 * технологию можно описать в редакторе, не трогая исходники, а координаты
 * пересчитываются при изменении детали сами (§42): в шаблоне хранится не
 * число, а способ его получить.
 */
import type {
  MachiningOperation,
  MachiningSource,
  OperationTemplate,
  Part,
  PositionReference,
} from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';
import { resolvePosition, resolveValue, resolvedMap, scopeFor } from './position';
import { toolTypeFor } from './tools';

/**
 * Стабильный id операции (§38/§39): деталь + узел + правило + номер шаблона.
 * Одинаковый вход даёт одинаковый id, поэтому пересчёт не плодит дубли и не
 * теряет ручные правки, привязанные к операции.
 */
export function operationId(
  partId: string,
  connectionId: string | undefined,
  ruleId: string,
  index: number,
): MachiningId {
  const scope = connectionId ? `${partId}:${connectionId}` : partId;
  return `op:${scope}:${ruleId}:${String(index + 1).padStart(3, '0')}` as MachiningId;
}

export interface TemplateContext {
  part: Part;
  ruleId: string;
  ruleVersion: string;
  connectionId?: string;
  hardwareId?: string;
  source?: MachiningSource;
  /** Дополнительные переменные для выражений (параметры крепежа). */
  variables?: Record<string, number>;
}

/**
 * Собрать операции по шаблонам. Шаблоны обрабатываются по порядку, поэтому
 * ссылка «от предыдущего отверстия» видит уже посчитанные координаты (§19).
 */
export function applyTemplates(
  templates: OperationTemplate[],
  ctx: TemplateContext,
): MachiningOperation[] {
  const out: MachiningOperation[] = [];

  templates.forEach((template, index) => {
    const scope = { ...scopeFor(ctx.part, template.face), ...(ctx.variables ?? {}) };
    const resolved = resolvedMap(out);
    const num = (v: number | string | undefined): number | undefined =>
      v === undefined ? undefined : resolveValue(v, scope);

    const x = resolvePosition(template.x, { part: ctx.part, face: template.face, axis: 'x', resolved });
    const y = resolvePosition(template.y, { part: ctx.part, face: template.face, axis: 'y', resolved });

    // Сквозное отверстие не хранит глубину числом-заглушкой: она равна
    // толщине детали и меняется вместе с ней (§23).
    const depth = template.through ? ctx.part.thickness : num(template.depth);

    out.push({
      id: operationId(String(ctx.part.id), ctx.connectionId, template.id || ctx.ruleId, index),
      type: template.type,
      partId: ctx.part.id,
      face: template.face,
      x,
      y,
      z: 0,
      diameter: num(template.diameter),
      depth,
      length: num(template.length),
      width: num(template.width),
      through: template.through,
      origin: ctx.source === 'MANUAL' ? 'manual' : 'generated',
      source: ctx.source ?? 'PARAMETRIC_RULE',
      toolType: template.toolType ?? toolTypeFor(template.type),
      sequence: index + 1,
      ...(ctx.connectionId ? { sourceHardwareConnectionId: ctx.connectionId as MachiningOperation['sourceHardwareConnectionId'] } : {}),
      ...(ctx.hardwareId ? { hardwareId: ctx.hardwareId as MachiningOperation['hardwareId'] } : {}),
      metadata: { rule: ctx.ruleId, ruleVersion: ctx.ruleVersion },
    });
  });

  return out;
}

/** Шаблон сверления — самая частая операция (§14/§22). */
export function drillTemplate(
  id: string,
  face: OperationTemplate['face'],
  x: PositionReference,
  y: PositionReference,
  diameter: number | string,
  depth: number | string,
  through = false,
): OperationTemplate {
  return { id, type: 'drilling', toolType: 'DRILL', face, x, y, diameter, depth, through };
}

/** Шаблон присадки под чашку (§25). */
export function boreTemplate(
  id: string,
  face: OperationTemplate['face'],
  x: PositionReference,
  y: PositionReference,
  diameter: number | string,
  depth: number | string,
): OperationTemplate {
  return { id, type: 'boring', toolType: 'DRILL', face, x, y, diameter, depth };
}

/** Шаблон паза (§26). */
export function grooveTemplate(
  id: string,
  face: OperationTemplate['face'],
  x: PositionReference,
  y: PositionReference,
  length: number | string,
  width: number | string,
  depth: number | string,
): OperationTemplate {
  return { id, type: 'groove', toolType: 'END_MILL', face, x, y, length, width, depth };
}
