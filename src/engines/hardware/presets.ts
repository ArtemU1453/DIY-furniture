/**
 * HardwarePreset и HardwareProfile (§64–§67).
 *
 * Пресет задаёт КАТЕГОРИЮ → позицию, а не жёсткий список артикулов: поэтому
 * «Стандартный корпус» работает с любой библиотекой, а не только с той, на
 * которой его составили.
 *
 * Применение всегда ограничено выбором (§66): пресет корпуса не должен менять
 * фурнитуру фасадов, а применение к двум деталям — трогать остальные.
 */
import type {
  Hardware,
  HardwareCategory,
  HardwareConnection,
  HardwarePreset,
  HardwareProfile,
  HardwareProfileKind,
  Project,
} from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';

/** Профили: какие категории крепежа к какой части изделия относятся (§67). */
export const HARDWARE_PROFILES: HardwareProfile[] = [
  { kind: 'CARCASS', name: 'Корпус', categories: ['confirmat', 'dowel', 'minifix', 'connector', 'corner', 'screw', 'shelf-support', 'back-panel', 'leg'] },
  { kind: 'FACADE', name: 'Фасады', categories: ['hinge', 'handle'] },
  { kind: 'DRAWER', name: 'Ящики', categories: ['slide'] },
];

export function profileOf(category: HardwareCategory): HardwareProfile | undefined {
  return HARDWARE_PROFILES.find((p) => p.categories.includes(category));
}

export function profileByKind(kind: HardwareProfileKind): HardwareProfile | undefined {
  return HARDWARE_PROFILES.find((p) => p.kind === kind);
}

/** Первая активная позиция нужной категории. */
function pick(hardware: Hardware[], category: HardwareCategory): HardwareId | undefined {
  return hardware.find((h) => h.category === category && !h.archived)?.id;
}

/**
 * Встроенные пресеты (§64). Позиции подставляются из библиотеки проекта,
 * поэтому пресет не может сослаться на то, чего в проекте нет.
 */
export function builtinHardwarePresets(hardware: Hardware[]): HardwarePreset[] {
  const out: HardwarePreset[] = [];

  const confirmat = pick(hardware, 'confirmat');
  if (confirmat) {
    out.push({ id: 'hw-carcass-confirmat', name: 'Стандартный корпус (конфирмат)', selection: { confirmat }, profile: 'CARCASS', builtin: true });
  }
  const dowel = pick(hardware, 'dowel');
  if (dowel) {
    out.push({ id: 'hw-carcass-dowel', name: 'Корпус на шкантах', selection: { confirmat: dowel, dowel }, profile: 'CARCASS', builtin: true });
  }
  const minifix = pick(hardware, 'minifix');
  if (minifix) {
    out.push({ id: 'hw-carcass-minifix', name: 'Корпус на эксцентриках', selection: { confirmat: minifix, minifix }, profile: 'CARCASS', builtin: true });
  }
  const hinge = pick(hardware, 'hinge');
  const handle = pick(hardware, 'handle');
  if (hinge || handle) {
    const selection: HardwarePreset['selection'] = {};
    if (hinge) selection.hinge = hinge;
    if (handle) selection.handle = handle;
    out.push({ id: 'hw-facade-standard', name: 'Стандартные фасады', selection, profile: 'FACADE', builtin: true });
  }
  return out;
}

/** Замена фурнитуры одного соединения. */
export interface HardwareChange {
  connectionId: string;
  hardwareId: HardwareId;
}

/**
 * Что изменит пресет. Возвращает ПЛАН, а не пишет в модель: запись делает
 * store одной командой, поэтому обновление атомарно и целиком попадает в undo.
 *
 * `partIds` ограничивает применение выбранными деталями (§65/§66); пустой
 * список означает «весь проект».
 */
export function planPresetApplication(
  project: Project,
  preset: HardwarePreset,
  partIds: PartId[] = [],
): HardwareChange[] {
  const byId = new Map(project.hardware.map((h) => [String(h.id), h]));
  const selected = new Set(partIds.map(String));
  const changes: HardwareChange[] = [];

  for (const connection of project.hardwareConnections) {
    // Ограничение по выбору: узел меняем, только если ОБЕ детали выбраны —
    // иначе пресет «протёк» бы на соседние, невыбранные детали (§66).
    if (selected.size > 0) {
      if (!selected.has(String(connection.partAId)) || !selected.has(String(connection.partBId))) continue;
    }
    const current = byId.get(String(connection.hardwareId));
    if (!current) continue;
    const replacement = preset.selection[current.category];
    if (!replacement || String(replacement) === String(connection.hardwareId)) continue;
    changes.push({ connectionId: String(connection.id), hardwareId: replacement });
  }
  return changes;
}

/** Пресет из текущего состава проекта — чтобы сохранить удачный набор. */
export function presetFromProject(project: Project, id: string, name: string, kind?: HardwareProfileKind): HardwarePreset {
  const selection: HardwarePreset['selection'] = {};
  const byId = new Map(project.hardware.map((h) => [String(h.id), h]));
  const allowed = kind ? profileByKind(kind)?.categories : undefined;
  for (const connection of project.hardwareConnections) {
    const item = byId.get(String(connection.hardwareId));
    if (!item) continue;
    if (allowed && !allowed.includes(item.category)) continue;
    selection[item.category] = item.id;
  }
  return { id, name, selection, profile: kind };
}

/** Соединения, которых коснётся пресет (для предпросмотра). */
export function affectedConnections(
  project: Project,
  preset: HardwarePreset,
  partIds: PartId[] = [],
): HardwareConnection[] {
  const ids = new Set(planPresetApplication(project, preset, partIds).map((c) => c.connectionId));
  return project.hardwareConnections.filter((c) => ids.has(String(c.id)));
}
