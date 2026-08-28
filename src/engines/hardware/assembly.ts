/**
 * Режимы сборки и разнесённого вида (§143–§149).
 *
 * Разнос — это ПРЕДСТАВЛЕНИЕ, а не конструкция: смещение считается на лету из
 * габарита изделия и на раскрой, присадку и спецификацию не влияет. Именно
 * поэтому функции возвращают трансформации, а не переписывают Part.position.
 *
 * Архитектура анимации (§149) заложена параметром `factor`: значение 0 — это
 * собранное изделие, 1 — полный разнос; промежуточные значения дают кадры,
 * когда анимация понадобится.
 */
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { allParts } from '@/core/model/selectors';
import type { Part, Project, Vec3 } from '@/core/model/types';

export type AssemblyMode = 'ASSEMBLY' | 'EXPLODED';

export interface ExplodedTransform {
  partId: string;
  /** Смещение относительно собранного положения, мм. */
  offset: Vec3;
}

export interface ExplodeOptions {
  /** 0 — собрано, 1 — полный разнос (§149). */
  factor?: number;
  /** Насколько разносить, мм на единицу фактора. */
  distance?: number;
}

const DEFAULT_DISTANCE = 250;

/** Центр габарита набора деталей, мм. */
export function assemblyCenter(parts: Part[]): Vec3 {
  if (parts.length === 0) return { x: 0, y: 0, z: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const box = partWorldAABB(part);
    minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y); maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
}

/**
 * Смещения разнесённого вида (§145/§148).
 *
 * Деталь отодвигается от центра изделия по направлению, в котором она от него
 * и стоит: боковины разъезжаются вбок, полки — вверх и вниз, задняя стенка —
 * назад. Так разнос читается как разборка, а не как случайный разлёт.
 */
export function explodedTransforms(parts: Part[], options: ExplodeOptions = {}): ExplodedTransform[] {
  const factor = Math.max(0, Math.min(1, options.factor ?? 1));
  const distance = options.distance ?? DEFAULT_DISTANCE;
  if (parts.length === 0 || factor === 0) {
    return parts.map((p) => ({ partId: String(p.id), offset: { x: 0, y: 0, z: 0 } }));
  }

  const center = assemblyCenter(parts);
  return parts.map((part) => {
    const box = partWorldAABB(part);
    const mid = {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    };
    const dir = { x: mid.x - center.x, y: mid.y - center.y, z: mid.z - center.z };
    const length = Math.hypot(dir.x, dir.y, dir.z);
    if (length < 1e-6) {
      // Деталь ровно в центре: разносим вверх, иначе она осталась бы внутри.
      return { partId: String(part.id), offset: { x: 0, y: distance * factor, z: 0 } };
    }
    const scale = (distance * factor) / length;
    return {
      partId: String(part.id),
      offset: { x: dir.x * scale, y: dir.y * scale, z: dir.z * scale },
    };
  });
}

/** Смещения разнесённого вида для всего проекта. */
export function projectExploded(project: Project, options: ExplodeOptions = {}): ExplodedTransform[] {
  return explodedTransforms(allParts(project), options);
}

/** Смещение конкретной детали в текущем режиме (§146/§147/§148). */
export function offsetForPart(
  transforms: ExplodedTransform[],
  partId: string,
  mode: AssemblyMode,
): Vec3 {
  if (mode === 'ASSEMBLY') return { x: 0, y: 0, z: 0 };
  return transforms.find((t) => t.partId === partId)?.offset ?? { x: 0, y: 0, z: 0 };
}

/** Положение детали с учётом режима — то, что рисует 3D. */
export function displayPosition(part: Part, offset: Vec3): Vec3 {
  return { x: part.position.x + offset.x, y: part.position.y + offset.y, z: part.position.z + offset.z };
}

/**
 * Кадр анимации сборки (§149). Полноценной анимации на этом этапе нет: здесь
 * только описание кадра, чтобы её можно было добавить без правки модели.
 */
export interface AssemblyFrame {
  /** Доля прогресса, 0…1. */
  t: number;
  transforms: ExplodedTransform[];
}

export function assemblyFrames(parts: Part[], steps = 8, options: ExplodeOptions = {}): AssemblyFrame[] {
  const frames: AssemblyFrame[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    frames.push({ t, transforms: explodedTransforms(parts, { ...options, factor: t }) });
  }
  return frames;
}
