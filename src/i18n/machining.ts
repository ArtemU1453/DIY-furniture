/** Локализация присадки: грани и типы операций. */
import type { MachiningType, PartFace } from '@/core/model/types';

export const FACE_LABELS: Record<PartFace, string> = {
  front: 'Фронт (FRONT)',
  back: 'Тыл (BACK)',
  left: 'Левая (LEFT)',
  right: 'Правая (RIGHT)',
  top: 'Верх (TOP)',
  bottom: 'Низ (BOTTOM)',
};

export const MACHINING_TYPE_LABELS: Record<MachiningType, string> = {
  drilling: 'Сверление',
  boring: 'Присадка (чашка)',
  pocket: 'Карман',
  slot: 'Паз',
  dowel: 'Шкант',
  confirmat: 'Конфирмат',
  hinge: 'Петля',
  custom: 'Прочее',
};

export const faceLabel = (f: PartFace): string => FACE_LABELS[f] ?? f;
export const machiningTypeLabel = (t: MachiningType): string => MACHINING_TYPE_LABELS[t] ?? t;

/** Номер операции по её порядковому номеру (sequence). */
export const opNumber = (sequence: number | undefined): string =>
  `M${String(sequence ?? 0).padStart(3, '0')}`;
