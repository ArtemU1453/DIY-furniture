/**
 * Проверка пересечений и зазоров корпуса (§79–§85).
 *
 * Пересечения ищет существующий Collision3DChecker этапа 13 — второго
 * геометрического движка здесь не появляется. Задача этого модуля — знать,
 * какие перекрытия КОНСТРУКТИВНЫ (деталь входит в паз) и потому пересечением
 * не считаются, и проверить зазоры, о которых знает только модель шкафа.
 */
import type { Part, Project } from '@/core/model/types';
import { detectCollisions } from '@/engines/viewer/collision';
import { allParts } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { faceInfo, partFrame } from '@/core/geometry/coordinateSystem';
import { allOperations } from '@/engines/machining';
import type { ParametricModel } from '@/core/parametric/types';
import { toCabinetModel } from './model';
import { drawerSlots } from '@/engines/parametric/rules';

export type CabinetIssueSeverity = 'error' | 'warning';

export interface CabinetIssue {
  severity: CabinetIssueSeverity;
  code: string;
  message: string;
  partIds?: string[];
}

const typeOf = (p: Part): string => String(p.metadata?.partType ?? '');

/** Деталь входит в паз соседней — это конструкция, а не ошибка (§25/§48). */
export function isPermittedOverlap(a: Part, b: Part): boolean {
  const pair = [typeOf(a), typeOf(b)];
  const has = (x: string, y: string) => pair.includes(x) && pair.includes(y);

  // Задняя стенка в пазу заходит в тело боковин, крыши и дна.
  const backInGroove = pair.includes('back')
    && (a.metadata?.backType === 'GROOVE' || b.metadata?.backType === 'GROOVE');
  if (backInGroove && (has('back', 'side_left') || has('back', 'side_right')
    || has('back', 'top') || has('back', 'bottom'))) return true;

  // Дно ящика лежит в пазу боковин и задней стенки короба.
  if (has('drawer_bottom', 'drawer_side') || has('drawer_bottom', 'drawer_back')) {
    return a.metadata?.drawer === b.metadata?.drawer;
  }
  return false;
}

/** Part vs Part (§79/§80). Конструктивные вхождения в паз не считаются. */
export function checkPartCollisions(parts: Part[], tolerance = 1): CabinetIssue[] {
  const byId = new Map(parts.map((p) => [String(p.id), p]));
  return detectCollisions(parts, tolerance)
    .filter((pair) => {
      const a = byId.get(pair.a);
      const b = byId.get(pair.b);
      return !(a && b && isPermittedOverlap(a, b));
    })
    .map((pair) => ({
      severity: 'error' as const,
      code: 'collision.parts',
      message: `Детали пересекаются: «${pair.aName}» и «${pair.bName}».`,
      partIds: [pair.a, pair.b],
    }));
}

/**
 * Hardware vs Part (§85). Отверстие обязано лежать в теле своей детали: если
 * присадка вышла за габарит, крепёж встанет в воздух.
 */
export function checkHardwareClearance(project: Project): CabinetIssue[] {
  const parts = new Map(allParts(project).map((p) => [String(p.id), p]));
  const issues: CabinetIssue[] = [];
  for (const op of allOperations(project)) {
    const part = parts.get(String(op.partId));
    if (!part) continue;

    /* Границы считаются ПО ГРАНИ, а не по пласти: конфирмат уходит в торец
     * на 34 мм, и это нормально — там доступна не толщина, а длина детали. */
    const face = faceInfo(partFrame(part), op.face);
    if (op.x < 0 || op.x > face.uSize || op.y < 0 || op.y > face.vSize) {
      issues.push({
        severity: 'error',
        code: 'clearance.hardware',
        message: `Присадка выходит за габарит детали «${part.name}»: X ${Math.round(op.x)}, Y ${Math.round(op.y)}.`,
        partIds: [String(part.id)],
      });
    }
    const depth = op.depth ?? 0;
    if (!op.through && depth > face.depthExtent) {
      issues.push({
        severity: 'error',
        code: 'clearance.depth',
        message: `Глухая операция глубиной ${depth} мм не помещается в детали «${part.name}»: `
          + `с грани доступно ${Math.round(face.depthExtent)} мм.`,
        partIds: [String(part.id)],
      });
    }
  }
  return issues;
}

/** Door vs Cabinet (§79/§82): зазор фасада должен быть положительным. */
export function checkDoorClearance(model: ParametricModel): CabinetIssue[] {
  const m = toCabinetModel(model);
  const issues: CabinetIssue[] = [];
  if (Math.trunc(m.doors.count) <= 0) return issues;
  const g = m.doors.gaps;
  const entries: Array<[number, string]> = [
    [g.topGap, 'сверху'], [g.bottomGap, 'снизу'],
    [g.leftGap, 'слева'], [g.rightGap, 'справа'],
  ];
  for (const [value, where] of entries) {
    if (value < 0) {
      issues.push({ severity: 'error', code: 'clearance.doorGap', message: `Зазор фасада ${where} отрицательный (${value} мм).` });
    } else if (value === 0) {
      issues.push({ severity: 'warning', code: 'clearance.doorGapZero', message: `Зазор фасада ${where} равен нулю: фасад будет задевать корпус.` });
    }
  }
  if (m.doors.count > 1 && g.betweenGap <= 0) {
    issues.push({ severity: 'error', code: 'clearance.doorBetween', message: 'Зазор между фасадами должен быть больше нуля.' });
  }
  return issues;
}

/** Drawer vs Cabinet (§79/§83): короб с направляющими должен помещаться. */
export function checkDrawerClearance(model: ParametricModel): CabinetIssue[] {
  const m = toCabinetModel(model);
  const issues: CabinetIssue[] = [];
  const count = Math.trunc(m.drawers.count);
  if (count <= 0) return issues;

  if (m.drawers.gap <= 0) {
    issues.push({ severity: 'error', code: 'clearance.drawerGap', message: 'Зазор между ящиками должен быть больше нуля.' });
  }
  const innerWidth = m.width - 2 * m.thickness;
  const boxWidth = innerWidth - 2 * m.drawers.sideClearance;
  if (boxWidth <= 2 * m.drawers.sideThickness) {
    issues.push({
      severity: 'error', code: 'clearance.drawerWidth',
      message: `Короб ящика шириной ${Math.round(boxWidth)} мм не собирается: не хватает места на направляющие.`,
    });
  }
  const slots = drawerSlots(model);
  for (const slot of slots) {
    if (slot.height <= 0) {
      issues.push({
        severity: 'error', code: 'clearance.drawerHeight',
        message: `Ящик ${slot.index}: высота фронта ${Math.round(slot.height)} мм — уменьшите количество ящиков или зазор.`,
      });
    }
  }
  const top = slots.length > 0 ? Math.max(...slots.map((s) => s.y + s.height)) : 0;
  if (top > m.height) {
    issues.push({
      severity: 'error', code: 'clearance.drawerStack',
      message: `Стопка ящиков (${Math.round(top)} мм) выше изделия (${m.height} мм).`,
    });
  }
  return issues;
}

/** Минимальный просвет между полками (§84). */
export const MIN_SHELF_CLEARANCE = 60;

export function checkShelfClearance(model: ParametricModel, minimum = MIN_SHELF_CLEARANCE): CabinetIssue[] {
  const m = toCabinetModel(model);
  const count = Math.trunc(m.shelves.count);
  if (count <= 0) return [];
  const innerHeight = m.height - 2 * m.thickness;
  const free = innerHeight - count * m.thickness;
  const gap = free / (count + 1);
  if (gap < minimum) {
    return [{
      severity: gap <= 0 ? 'error' : 'warning',
      code: 'clearance.shelf',
      message: `Просвет между полками ${Math.round(gap)} мм меньше минимального (${minimum} мм).`,
    }];
  }
  return [];
}

export interface CabinetCheck {
  ok: boolean;
  issues: CabinetIssue[];
  errors: number;
  warnings: number;
}

/** Полная проверка конструкции (§79–§85). */
export function checkCabinet(
  project: Project,
  model: ParametricModel,
  parts: Part[],
): CabinetCheck {
  const issues = [
    ...checkPartCollisions(parts),
    ...checkHardwareClearance(project),
    ...checkDoorClearance(model),
    ...checkDrawerClearance(model),
    ...checkShelfClearance(model),
  ];
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, issues, errors, warnings: issues.length - errors };
}

/** Габарит изделия по его деталям — для отчётов и предпросмотра. */
export function cabinetBounds(parts: Part[]): { width: number; height: number; depth: number } {
  if (parts.length === 0) return { width: 0, height: 0, depth: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const box = partWorldAABB(part);
    minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y); maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z);
  }
  return { width: maxX - minX, height: maxY - minY, depth: maxZ - minZ };
}
