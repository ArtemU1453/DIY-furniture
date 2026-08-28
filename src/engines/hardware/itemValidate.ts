/**
 * Проверки установленной фурнитуры (§111–§114).
 *
 * Проверяется положение, зазоры, коллизии и конфликты присадки. Валидатор
 * присадки при этом не дублируется: операции проверяет существующий
 * validateMachining, а здесь — то, что относится к самой фурнитуре.
 */
import type { HardwareItem, Project } from '@/core/model/types';
import { faceSize } from './parametric';
import { itemLayout, itemPart, projectItems } from './items';

export interface HardwareItemIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  itemId: string;
  partId?: string;
}

/** Минимальное расстояние между отверстиями разных единиц, мм (§113). */
export const MIN_HOLE_CLEARANCE = 8;

/** Проверка одной единицы: родитель, границы, правила вида (§111/§112). */
export function checkItem(project: Project, item: HardwareItem): HardwareItemIssue[] {
  const issues: HardwareItemIssue[] = [];
  const part = itemPart(project, item);
  const hardware = project.hardware.find((h) => h.id === item.hardwareId);

  if (!hardware) {
    issues.push({
      severity: 'error', code: 'item.hardware', itemId: item.id,
      message: `Единица ${item.id}: позиция каталога не найдена.`,
    });
  }
  if (!part) {
    issues.push({
      severity: 'error', code: 'item.parent', itemId: item.id,
      message: `Единица ${item.id}: деталь-родитель не найдена.`,
    });
    return issues;
  }

  const layout = itemLayout(project, item);
  if (!layout) return issues;

  for (const issue of layout.issues) {
    issues.push({ ...issue, itemId: item.id, partId: String(part.id) });
  }

  // Операции не должны выходить за границы детали (§112).
  for (const op of layout.operations) {
    const size = faceSize(part, op.face);
    const r = (op.diameter ?? 0) / 2;
    if (op.x - r < -0.01 || op.x + r > size.u + 0.01 || op.y - r < -0.01 || op.y + r > size.v + 0.01) {
      issues.push({
        severity: 'error', code: 'item.bounds', itemId: item.id, partId: String(part.id),
        message: `Фурнитура «${hardware?.name ?? item.hardwareId}»: отверстие выходит за границы детали.`,
      });
      break;
    }
    if (op.through !== true && (op.depth ?? 0) >= size.depth) {
      issues.push({
        severity: 'error', code: 'item.depth', itemId: item.id, partId: String(part.id),
        message: `Глухое отверстие ${op.depth} мм глубже толщины детали ${size.depth} мм.`,
      });
      break;
    }
  }
  return issues;
}

/**
 * Конфликты присадки между единицами (§114).
 *
 * Две операции конфликтуют, если стоят на одной грани одной детали и их
 * отверстия пересекаются — сверлить такое нельзя.
 */
export function checkItemConflicts(project: Project): HardwareItemIssue[] {
  const placed: Array<{ itemId: string; partId: string; face: string; x: number; y: number; d: number }> = [];
  for (const item of projectItems(project)) {
    const layout = itemLayout(project, item);
    if (!layout) continue;
    for (const op of layout.operations) {
      placed.push({
        itemId: item.id, partId: String(item.partId), face: op.face,
        x: op.x, y: op.y, d: op.diameter ?? 0,
      });
    }
  }

  const issues: HardwareItemIssue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.itemId === b.itemId || a.partId !== b.partId || a.face !== b.face) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const overlap = (a.d + b.d) / 2;
      const key = [a.itemId, b.itemId].sort().join('|');
      if (seen.has(key)) continue;
      if (distance < overlap) {
        seen.add(key);
        issues.push({
          severity: 'error', code: 'item.conflict', itemId: a.itemId, partId: a.partId,
          message: `Операции фурнитуры ${a.itemId} и ${b.itemId} пересекаются на детали.`,
        });
      } else if (distance < overlap + MIN_HOLE_CLEARANCE) {
        seen.add(key);
        issues.push({
          severity: 'warning', code: 'item.clearance', itemId: a.itemId, partId: a.partId,
          message: `Между операциями ${a.itemId} и ${b.itemId} всего ${Math.round(distance)} мм.`,
        });
      }
    }
  }
  return issues;
}

/** Все замечания по фурнитуре проекта (§111). */
export function validateHardwareItems(project: Project): HardwareItemIssue[] {
  return [
    ...projectItems(project).flatMap((item) => checkItem(project, item)),
    ...checkItemConflicts(project),
  ];
}

/** Можно ли поставить единицу: используется для атомарности (§104). */
export function canPlaceItem(project: Project, item: HardwareItem): { ok: boolean; issues: HardwareItemIssue[] } {
  const issues = checkItem(project, item);
  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}
