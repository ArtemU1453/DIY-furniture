/**
 * FurnitureScene — сцена мебели (§2–§15).
 *
 * Сцена ПРОИЗВОДНАЯ: она описывает, что показать, но не хранит ни размеров,
 * ни положений как самостоятельных данных. Каждый узел ссылается на объект
 * ProjectModel, а его геометрия и трансформация вычисляются при сборке.
 * Поэтому 3D не может разойтись с производственной моделью.
 */
import type {
  GrainDirection,
  MachiningType,
  PartFace,
  Vec3,
} from '@/core/model/types';

/** Что за объект стоит за узлом сцены (§4–§9). */
export type SceneNodeKind = 'PROJECT' | 'CABINET' | 'MODULE' | 'PART' | 'HARDWARE' | 'MACHINING';

/** Трансформация узла: положение, поворот (рад) и масштаб (§10/§11). */
export interface NodeTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** Габарит узла в мм. */
export interface NodeSize {
  x: number;
  y: number;
  z: number;
}

/** Материал узла для отображения (§16–§21). */
export interface NodeMaterial {
  materialId: string | null;
  name: string;
  color: string;
  /** Локальная текстура, если она есть в проекте (§18/§19). */
  textureId?: string;
  grain: GrainDirection;
  /** Поворот текстуры на детали, градусы (§21). */
  grainAngle: number;
}

/** Кромка на стороне детали (§22–§24). */
export interface NodeEdgeBand {
  side: 'top' | 'right' | 'bottom' | 'left';
  materialId: string;
  name: string;
  color: string;
  thickness: number;
  length: number;
}

/** Визуальное представление операции присадки (§101–§105). */
export interface NodeMachining {
  operationId: string;
  type: MachiningType;
  face: PartFace;
  /** Локальные координаты на грани, мм. */
  x: number;
  y: number;
  diameter: number;
  depth: number;
  length?: number;
  width?: number;
  through: boolean;
  /** Направление сверления в мировых координатах (§102). */
  direction: Vec3;
  /** Как рисовать: отверстие, паз, карман, вырез (§101). */
  shape: 'HOLE' | 'GROOVE' | 'POCKET' | 'CUTOUT';
}

/** Представление единицы фурнитуры (§108/§109). */
export interface NodeHardware {
  itemId: string;
  hardwareId: string;
  kind: string;
  /** Путь к локальной 3D-модели, если он задан (§113). */
  modelPath?: string;
  /** Заглушка, когда модели нет (§109/§114). */
  placeholder: 'BOX' | 'CYLINDER' | 'PLATE';
}

/** Узел сцены (§5–§9). */
export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  label: string;
  parentId: string | null;
  childIds: string[];
  /** Ссылка на объект модели: partId, itemId, operationId и т.п. (§3/§15). */
  refId: string | null;
  /** Локальная трансформация относительно родителя (§11). */
  local: NodeTransform;
  /** Мировая трансформация — вычислена, а не сохранена (§12). */
  world: NodeTransform;
  size: NodeSize;
  material?: NodeMaterial;
  edges?: NodeEdgeBand[];
  machining?: NodeMachining;
  hardware?: NodeHardware;
  /** Скрыт пользователем (§79). */
  hidden?: boolean;
}

/** Сцена целиком (§2). */
export interface FurnitureScene {
  /** Идентификатор корневого узла. */
  rootId: string;
  nodes: Record<string, SceneNode>;
  /** Порядок обхода: родители раньше детей. */
  order: string[];
  /** Сигнатура модели, из которой собрана сцена (§127). */
  signature: string;
  stats: {
    cabinets: number;
    modules: number;
    parts: number;
    hardware: number;
    machining: number;
  };
}

export const IDENTITY_TRANSFORM: NodeTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export function transform(position: Vec3, rotation: Vec3, scale?: Vec3): NodeTransform {
  return {
    position: { ...position },
    rotation: { ...rotation },
    scale: scale ? { ...scale } : { x: 1, y: 1, z: 1 },
  };
}

/** Сложение трансформаций: родитель ∘ ребёнок (§12/§13). */
export function composeTransform(parent: NodeTransform, child: NodeTransform): NodeTransform {
  /* Повороты узлов сцены — только вокруг осей корпуса, поэтому достаточно
   * сложить углы и повернуть смещение ребёнка вокруг Y родителя: этого хватает
   * для мебели и не требует полноценной матричной алгебры. */
  const ry = parent.rotation.y;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const px = child.position.x * cos + child.position.z * sin;
  const pz = -child.position.x * sin + child.position.z * cos;
  return {
    position: {
      x: parent.position.x + px * parent.scale.x,
      y: parent.position.y + child.position.y * parent.scale.y,
      z: parent.position.z + pz * parent.scale.z,
    },
    rotation: {
      x: parent.rotation.x + child.rotation.x,
      y: parent.rotation.y + child.rotation.y,
      z: parent.rotation.z + child.rotation.z,
    },
    scale: {
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
      z: parent.scale.z * child.scale.z,
    },
  };
}

/** Округление до 0.1 мм для отображения (§136). */
export function round01(value: number): number {
  return Math.round(value * 10) / 10;
}
