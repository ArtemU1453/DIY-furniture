/**
 * HardwareSpecification (§49–§55/§84/§85).
 *
 * Количество НИКОГДА не хранится: спецификация считает его из соединений при
 * каждом обращении. Поэтому изменение конструкции — другое число фасадов,
 * другая ширина — сразу меняет спецификацию, и расхождению между чертежом и
 * закупкой взяться неоткуда.
 */
import type { Hardware, HardwareStatus, Project } from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import { HARDWARE_CATEGORY_LABELS } from '@/i18n/catalog';
import { resolveHardwareItem, resolveItemPart } from './parametric';
import { allHardwareInstances } from './instances';
import { expandKit, kitOfHardware, projectKits, type ExpandedComponent } from './kits';
import { findHardware, hardwareStatus } from './status';

/** Строка спецификации фурнитуры (§51). */
export interface HardwareSpecRow {
  position: number;
  hardwareId: HardwareId;
  name: string;
  article: string;
  type: string;
  quantity: number;
  unit: string;
  note: string;
  status: HardwareStatus;
  /** Компоненты, если позиция — комплект (§54/§55). */
  components?: ExpandedComponent[];
}

/** Единица измерения (§52). Штучный крепёж — «шт.». */
export const HARDWARE_UNIT = 'шт.';

/**
 * Количество каждой позиции — из установленных единиц (§17/§84).
 * Возвращает и позиции, которых нет в проекте: их нельзя молча потерять (§79).
 */
export function hardwareCounts(project: Project): Map<string, number> {
  const counts = new Map<string, number>();
  const parts = allParts(project);
  for (const inst of allHardwareInstances(project)) {
    const key = String(inst.hardwareId);
    /* Единица соединения — всегда одна штука, а установленная напрямую может
     * представлять несколько элементов (четыре петли на фасаде): их число
     * даёт раскладка вида, а не отдельное поле (§69/§93). */
    let units = 1;
    if (!inst.connectionId) {
      const hardware = findHardware(project, key);
      const part = resolveItemPart(parts, inst);
      units = inst.quantity
        ?? (hardware && part ? Math.max(1, resolveHardwareItem(inst, hardware, part).anchors.length) : 1);
    }
    counts.set(key, (counts.get(key) ?? 0) + units);
  }
  return counts;
}

/**
 * Спецификация фурнитуры (§49/§50). Группировка по позиции; комплекты
 * раскрываются в компоненты, но остаются одной строкой — разворачивать их
 * решает интерфейс (§55).
 */
export function hardwareSpecification(project: Project): HardwareSpecRow[] {
  const counts = hardwareCounts(project);
  const kits = projectKits(project);
  const rows: HardwareSpecRow[] = [];

  for (const [hardwareId, quantity] of counts) {
    const item: Hardware | undefined = findHardware(project, hardwareId);
    const kit = kits.find((k) => k.id === hardwareId) ?? kitOfHardware(project, hardwareId as HardwareId);
    const isKitItself = kits.some((k) => k.id === hardwareId);

    rows.push({
      position: 0, // проставляется ниже, после сортировки
      hardwareId: hardwareId as HardwareId,
      name: item?.name ?? (isKitItself ? kit!.name : 'Позиция отсутствует в проекте'),
      article: item?.article ?? (isKitItself ? (kit?.article ?? '') : ''),
      type: item ? HARDWARE_CATEGORY_LABELS[item.category] : (isKitItself ? 'Комплект' : '—'),
      quantity,
      unit: HARDWARE_UNIT,
      // Примечание не выдумываем: только то, что действительно известно.
      note: !item && !isKitItself ? 'Позиция не найдена — назначьте замену' : (item?.archived ? 'Архивная позиция' : ''),
      status: hardwareStatus(project, hardwareId),
      components: isKitItself ? expandKit(kit!, quantity, project.hardware) : undefined,
    });
  }

  // Сначала по типу, затем по названию — так спецификацию удобно читать.
  rows.sort((a, b) => a.type.localeCompare(b.type, 'ru') || a.name.localeCompare(b.name, 'ru'));
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

/**
 * Спецификация с РАСКРЫТЫМИ комплектами (§54): вместо строки комплекта идут
 * его компоненты. Нужна для закупки, где комплект как таковой не заказывают.
 */
export function expandedSpecification(project: Project): HardwareSpecRow[] {
  const rows: HardwareSpecRow[] = [];
  const merged = new Map<string, HardwareSpecRow>();

  for (const row of hardwareSpecification(project)) {
    if (!row.components) {
      merged.set(String(row.hardwareId), { ...row, position: 0 });
      continue;
    }
    for (const component of row.components) {
      const key = String(component.hardwareId);
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += component.quantity;
        continue;
      }
      const item = findHardware(project, component.hardwareId);
      merged.set(key, {
        position: 0,
        hardwareId: component.hardwareId,
        name: component.name,
        article: component.article ?? '',
        type: item ? HARDWARE_CATEGORY_LABELS[item.category] : '—',
        quantity: component.quantity,
        unit: HARDWARE_UNIT,
        note: `Из комплекта «${row.name}»`,
        status: hardwareStatus(project, component.hardwareId),
      });
    }
  }

  rows.push(...merged.values());
  rows.sort((a, b) => a.type.localeCompare(b.type, 'ru') || a.name.localeCompare(b.name, 'ru'));
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

/** Итог: сколько всего единиц фурнитуры в проекте (§53). */
export function totalHardwareUnits(project: Project): number {
  return allHardwareInstances(project).length;
}
