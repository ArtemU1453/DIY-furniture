/**
 * Исполнение ДЕКЛАРАТИВНЫХ правил присадки (§14/§15).
 *
 * HardwareRule — это данные: пользователь описывает крепёж в редакторе, не
 * трогая код. Здесь описание превращается в обычные MachiningOperation с теми
 * же детерминированными id, что и у встроенных правил категорий, поэтому
 * ручные правки (overrides) и нумерация продолжают работать без изменений.
 *
 * Модуль живёт в engines/machining, а не в engines/library, чтобы генерация
 * присадки не зависела от библиотеки: зависимость идёт только в одну сторону.
 */
import type {
  Hardware,
  HardwareConnection,
  HardwareRule,
  MachiningOperation,
  Material,
  Part,
} from '@/core/model/types';
import type { MachiningId } from '@/core/model/ids';
import { analyzeJoint, type JointSidePlan } from './joint';

export interface RuleContext {
  connection: HardwareConnection;
  hardware: Hardware;
  partA: Part;
  partB: Part;
  /** Материал проходной детали — для ограничений по категории. */
  material?: Material;
}

export interface ApplicabilityResult {
  applicable: boolean;
  /** Почему правило неприменимо — текстом для пользователя. */
  reasons: string[];
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Детерминированный id — тот же формат, что и у встроенных правил. */
function ruleOpId(connectionId: string, ruleId: string, index: number): MachiningId {
  return `gen:${connectionId}:${ruleId}:${index}` as MachiningId;
}

/**
 * Категория материала без импорта библиотеки: ограничение правила описывается
 * в терминах категорий, а связь kind → category однозначна.
 */
function categoryOf(material: Material | undefined): string | null {
  if (!material) return null;
  if (material.category) return material.category;
  switch (material.kind) {
    case 'ldsp': return 'LDSP';
    case 'mdf': return 'MDF';
    case 'plywood': return 'PLYWOOD';
    case 'solid': case 'edge-glued': return 'SOLID_WOOD';
    case 'hdf': return 'HDF';
    default: return 'OTHER';
  }
}

/**
 * Применимо ли правило: проверяются ограничения толщины, категории материала
 * и наличия стыка — то есть то, что физически мешает поставить крепёж (§45).
 */
export function isApplicable(rule: HardwareRule, ctx: RuleContext): ApplicabilityResult {
  const reasons: string[] = [];
  const c = rule.constraints;
  if (!c) return { applicable: true, reasons };

  const thickness = Math.min(ctx.partA.thickness, ctx.partB.thickness);
  if (c.minThickness != null && thickness < c.minThickness) {
    reasons.push(`требуется толщина не менее ${c.minThickness} мм, а деталь ${thickness} мм`);
  }
  if (c.maxThickness != null && thickness > c.maxThickness) {
    reasons.push(`требуется толщина не более ${c.maxThickness} мм, а деталь ${thickness} мм`);
  }
  if (c.materialCategories?.length) {
    const cat = categoryOf(ctx.material);
    if (cat && !c.materialCategories.includes(cat as never)) {
      reasons.push(`не применяется к материалу категории ${cat}`);
    }
  }
  if (c.minJointLength != null) {
    const joint = analyzeJoint(ctx.partA, ctx.partB, {
      count: num(rule.count, 2),
      edgeOffset: num(rule.edgeOffset, 32),
    });
    if (!joint) reasons.push('детали не образуют стык');
  }
  return { applicable: reasons.length === 0, reasons };
}

/** Стороны стыка, на которые ложится правило. */
function targets(
  rule: HardwareRule,
  joint: { through: JointSidePlan; receiving: JointSidePlan },
): Array<{ plan: JointSidePlan; role: string }> {
  switch (rule.target) {
    case 'through': return [{ plan: joint.through, role: 'through' }];
    case 'receiving': return [{ plan: joint.receiving, role: 'recv' }];
    case 'both': return [
      { plan: joint.through, role: 'through' },
      { plan: joint.receiving, role: 'recv' },
    ];
  }
}

/** Одно правило → операции присадки. */
export function applyRule(rule: HardwareRule, ctx: RuleContext): MachiningOperation[] {
  const count = num(rule.count, 2);
  const edgeOffset = num(ctx.connection.parameters?.edgeOffset, num(rule.edgeOffset, 32));
  const joint = analyzeJoint(ctx.partA, ctx.partB, { count, edgeOffset });
  if (!joint) return [];

  const ops: MachiningOperation[] = [];
  for (const { plan, role } of targets(rule, joint)) {
    plan.holes.forEach((hole, i) => {
      const through = rule.through === true;
      // Глухое отверстие не может быть глубже доступного материала.
      const depth = through
        ? plan.thickness
        : Math.min(num(rule.depth, 12), Math.max(plan.thickness * 4, 1));
      ops.push({
        id: ruleOpId(ctx.connection.id, `${rule.id}:${role}`, i),
        type: rule.operation,
        partId: plan.part.id,
        face: plan.face,
        x: hole.x,
        y: hole.y,
        z: 0,
        diameter: rule.diameter,
        depth,
        through,
        origin: 'generated',
        sourceHardwareConnectionId: ctx.connection.id,
        hardwareId: ctx.hardware.id,
      });
    });
  }
  return ops;
}

/** Все декларативные правила крепежа для одной связи. */
export function applyDeclarativeRules(ctx: RuleContext): {
  operations: MachiningOperation[];
  skipped: Array<{ rule: HardwareRule; reasons: string[] }>;
} {
  const operations: MachiningOperation[] = [];
  const skipped: Array<{ rule: HardwareRule; reasons: string[] }> = [];
  for (const rule of ctx.hardware.machiningRules ?? []) {
    const check = isApplicable(rule, ctx);
    if (!check.applicable) {
      skipped.push({ rule, reasons: check.reasons });
      continue;
    }
    operations.push(...applyRule(rule, ctx));
  }
  return { operations, skipped };
}
