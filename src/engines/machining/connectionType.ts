/**
 * Способ соединения (ConnectionType) и его связь с категорией фурнитуры.
 *
 * Категория крепежа отвечает на вопрос «ЧЕМ крепим», ConnectionType — «КАК».
 * Отображение двустороннее, чтобы выбор способа соединения в шаблоне/UI
 * однозначно резолвился в конкретный крепёж и правило присадки.
 */
import type { ConnectionType, HardwareCategory, HardwareConnection, Project } from '@/core/model/types';

/** Категория крепежа → способ соединения. */
const BY_CATEGORY: Partial<Record<HardwareCategory, ConnectionType>> = {
  confirmat: 'CONFIRMAT',
  dowel: 'DOWEL',
  minifix: 'MINIFIX',
  screw: 'SCREW',
  connector: 'CAM_LOCK',
};

/** Способ соединения → категория крепежа (для подбора фурнитуры). */
const TO_CATEGORY: Record<ConnectionType, HardwareCategory> = {
  CONFIRMAT: 'confirmat',
  DOWEL: 'dowel',
  MINIFIX: 'minifix',
  SCREW: 'screw',
  CAM_LOCK: 'connector',
  OTHER: 'other',
};

export const CONNECTION_TYPES: ConnectionType[] = ['CONFIRMAT', 'DOWEL', 'MINIFIX', 'SCREW', 'CAM_LOCK'];

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  CONFIRMAT: 'Конфирмат',
  DOWEL: 'Шкант',
  MINIFIX: 'Минификс',
  SCREW: 'Саморез',
  CAM_LOCK: 'Эксцентриковая стяжка',
  OTHER: 'Другое',
};

export function connectionTypeOfCategory(category: HardwareCategory): ConnectionType {
  return BY_CATEGORY[category] ?? 'OTHER';
}

export function categoryOfConnectionType(type: ConnectionType): HardwareCategory {
  return TO_CATEGORY[type];
}

/**
 * Способ соединения для связи: явное поле, иначе выводится из категории
 * назначенного крепежа (обратная совместимость со связями без connectionType).
 */
export function resolveConnectionType(project: Project, connection: HardwareConnection): ConnectionType {
  if (connection.connectionType) return connection.connectionType;
  const hw = project.hardware.find((h) => h.id === connection.hardwareId);
  return hw ? connectionTypeOfCategory(hw.category) : 'OTHER';
}
