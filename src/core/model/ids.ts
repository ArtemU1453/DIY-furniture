/**
 * Идентификаторы модели.
 *
 * Все объекты идентифицируются стабильным UUID, а НЕ именем.
 * Брендированные типы не дают перепутать, например, PartId с MaterialId
 * на этапе компиляции, оставаясь при этом обычными строками в JSON.
 */
import { v4 as uuid } from 'uuid';

type Id<Brand extends string> = string & { readonly __brand: Brand };

export type ProjectId = Id<'Project'>;
export type FurnitureId = Id<'Furniture'>;
export type AssemblyId = Id<'Assembly'>;
export type PartId = Id<'Part'>;
export type MaterialId = Id<'Material'>;
export type EdgeMaterialId = Id<'EdgeMaterial'>;
export type HardwareId = Id<'Hardware'>;
export type HardwareConnectionId = Id<'HardwareConnection'>;
export type MachiningId = Id<'MachiningOperation'>;
export type DrawingId = Id<'Drawing'>;
export type SheetMaterialId = Id<'SheetMaterial'>;
export type StoredRemnantId = Id<'StoredRemnant'>;

export function newProjectId(): ProjectId {
  return uuid() as ProjectId;
}
export function newFurnitureId(): FurnitureId {
  return uuid() as FurnitureId;
}
export function newAssemblyId(): AssemblyId {
  return uuid() as AssemblyId;
}
export function newPartId(): PartId {
  return uuid() as PartId;
}
export function newMaterialId(): MaterialId {
  return uuid() as MaterialId;
}
export function newEdgeMaterialId(): EdgeMaterialId {
  return uuid() as EdgeMaterialId;
}
export function newHardwareId(): HardwareId {
  return uuid() as HardwareId;
}
export function newHardwareConnectionId(): HardwareConnectionId {
  return uuid() as HardwareConnectionId;
}
export function newMachiningId(): MachiningId {
  return uuid() as MachiningId;
}
export function newDrawingId(): DrawingId {
  return uuid() as DrawingId;
}
export function newSheetMaterialId(): SheetMaterialId {
  return uuid() as SheetMaterialId;
}
export function newStoredRemnantId(): StoredRemnantId {
  return uuid() as StoredRemnantId;
}
