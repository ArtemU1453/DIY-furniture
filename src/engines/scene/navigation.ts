/**
 * Переходы из сцены в другие разделы (§153–§159).
 *
 * Навигация не меняет данные: она лишь говорит, какой экран открыть и какой
 * объект там выбрать. Сами экраны уже существуют — новых не создаём.
 */
import type { Project } from '@/core/model/types';
import { allOperations } from '@/engines/machining';
import { projectItems } from '@/engines/hardware';
import type { FurnitureScene } from './types';
import { partOfSelection, type SceneSelection } from './select';

/** Куда можно перейти из сцены (§159). */
export type NavigationTarget = 'VIEW_3D' | 'VIEW_2D' | 'CUTTING' | 'PRODUCTION' | 'BOM' | 'MACHINING' | 'HARDWARE';

export interface NavigationCommand {
  target: NavigationTarget;
  label: string;
  /** Что выбрать на целевом экране. */
  partId?: string;
  operationId?: string;
  hardwareItemId?: string;
  /** Почему команда недоступна, если это так. */
  disabledReason?: string;
}

/**
 * Команды перехода для текущего выбора (§153–§159).
 *
 * Если выбрана фурнитура или операция, деталь-родитель всё равно известна —
 * поэтому раскрой и производство доступны и для них (§157/§158).
 */
export function navigationCommands(
  scene: FurnitureScene,
  selection: SceneSelection,
  project: Project,
): NavigationCommand[] {
  const node = selection.activeId ? scene.nodes[selection.activeId] : undefined;
  const partId = partOfSelection(scene, selection) ?? undefined;

  const placedInCutting = partId
    ? (project.cutting.report?.jobs ?? []).some((job) =>
      job.sheets.some((sheet) => sheet.placements.some((p) => String(p.partId) === partId)))
    : false;

  const commands: NavigationCommand[] = [
    { target: 'VIEW_2D', label: 'Показать в 2D', partId },
    { target: 'VIEW_3D', label: 'Показать в 3D', partId },
    {
      target: 'CUTTING',
      label: 'Показать в раскрое',
      partId,
      disabledReason: partId
        ? (placedInCutting ? undefined : 'Деталь ещё не размещена в раскрое.')
        : 'Не выбрана деталь.',
    },
    { target: 'PRODUCTION', label: 'Показать в производстве', partId, disabledReason: partId ? undefined : 'Не выбрана деталь.' },
    { target: 'BOM', label: 'Показать в спецификации', partId },
  ];

  if (node?.kind === 'MACHINING' && node.refId) {
    const op = allOperations(project).find((o) => String(o.id) === node.refId);
    commands.push({
      target: 'MACHINING',
      label: 'Показать операцию',
      operationId: node.refId,
      partId: op ? String(op.partId) : partId,
    });
  }
  if (node?.kind === 'HARDWARE' && node.refId) {
    const item = projectItems(project).find((i) => i.id === node.refId);
    commands.push({
      target: 'HARDWARE',
      label: 'Показать фурнитуру',
      hardwareItemId: node.refId,
      partId: item ? String(item.partId) : partId,
    });
  }
  return commands;
}

/** Доступна ли команда (§159). */
export function isAvailable(command: NavigationCommand): boolean {
  return command.disabledReason === undefined;
}
