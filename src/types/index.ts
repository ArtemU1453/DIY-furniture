/**
 * Публичные типы модели (ре-экспорт из core/model для удобного импорта из UI).
 * Единственное каноническое определение — в core/model/types.ts.
 */
export type {
  Project,
  Furniture,
  Assembly,
  Part,
  PartRole,
  Material,
  MaterialKind,
  EdgeMaterial,
  Hardware,
  HardwareCategory,
  MachiningOperation,
  CuttingPiece,
  CuttingSheet,
  Drawing,
  ProjectSettings,
  Mm,
  Vec3,
  Rotation,
  GrainDirection,
  EdgeSide,
} from '@/core/model/types';
