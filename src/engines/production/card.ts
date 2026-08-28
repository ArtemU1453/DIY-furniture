/**
 * Карта детали для цеха (§85–§105).
 *
 * Карта НЕ рисует деталь заново: чертёж берётся у существующего движка
 * документов (buildPartPage), а карта добавляет производственные данные —
 * маркировку, кромку по сторонам, таблицу присадки и набор видов.
 */
import type { MachiningOperation, PartFace, Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { allOperations } from '@/engines/machining';
import { buildPartPage } from '@/engines/drawing';
import { holeNotation } from '@/engines/drawing/notation';
import { faceLabel, machiningTypeLabel } from '@/i18n/machining';
import { labelCode } from '@/engines/cutting';
import type { DrawingPage } from '@/engines/drawing/sheet';
import type { ProductionEdge, ProductionOperation, ProductionPart } from './parts';

/** Виды детали в карте (§88): шесть граней. */
export type CardView = 'FRONT' | 'BACK' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';

export const CARD_VIEWS: CardView[] = ['FRONT', 'BACK', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT'];

export const CARD_VIEW_LABELS: Record<CardView, string> = {
  FRONT: 'Спереди',
  BACK: 'Сзади',
  TOP: 'Сверху',
  BOTTOM: 'Снизу',
  LEFT: 'Слева',
  RIGHT: 'Справа',
};

const VIEW_FACE: Record<CardView, PartFace> = {
  FRONT: 'front',
  BACK: 'back',
  TOP: 'top',
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
};

/** Один вид карты: включён ли он и что на нём есть (§88/§89). */
export interface CardViewInfo {
  view: CardView;
  label: string;
  face: PartFace;
  /** Вид показывается, если на грани есть операции; пласть — всегда (§88). */
  visible: boolean;
  operationCount: number;
}

/** Строка таблицы присадки в карте (§93/§94). */
export interface CardOperationRow {
  index: number;
  type: string;
  face: string;
  x: number;
  y: number;
  /** Обозначение вида «Ø5 × 12» (§94). */
  notation: string;
  through: boolean;
  source: string;
}

/** Строка таблицы кромки (§95). */
export interface CardEdgeRow {
  label: string;
  side: string;
  materialName: string;
  thickness: number;
  length: number;
}

/** Карта детали (§85). */
export interface PartCard {
  partId: string;
  /** Производственная маркировка P-001 (§97). */
  mark: string;
  name: string;
  materialName: string;
  thickness: number;
  /** Чистовой размер (§10). */
  width: number;
  height: number;
  /** Заготовочный размер (§11). */
  rawWidth: number;
  rawHeight: number;
  quantity: number;
  grain: string;
  /** Ориентация детали в карте: длинная сторона по горизонтали (§96). */
  orientation: 'LANDSCAPE' | 'PORTRAIT';
  /** Поворот детали при печати, ° (§96). */
  rotation: 0 | 90;
  views: CardViewInfo[];
  operations: CardOperationRow[];
  edges: CardEdgeRow[];
  /** Код детали для этикетки/QR (§110/§111). */
  code: string;
  revision: string;
  status: ProductionPart['status'];
  /** Чертёж детали из движка документов; null, если деталь не найдена. */
  page: DrawingPage | null;
}

const GRAIN_LABELS: Record<string, string> = {
  NONE: 'без текстуры',
  ALONG_WIDTH: 'вдоль ширины',
  ALONG_HEIGHT: 'вдоль высоты',
  ALONG_LENGTH: 'вдоль длины',
};

/** Обозначение операции: «Ø5 × 12» (§94). */
export function operationNotation(op: ProductionOperation): string {
  return holeNotation({
    diameter: op.diameter,
    depth: op.depth,
    through: op.through,
    type: op.type,
  });
}

/** Виды карты по операциям детали (§88). */
export function cardViews(operations: ProductionOperation[]): CardViewInfo[] {
  return CARD_VIEWS.map((view) => {
    const face = VIEW_FACE[view];
    const operationCount = operations.filter((op) => op.face === face).length;
    return {
      view,
      label: CARD_VIEW_LABELS[view],
      face,
      // Пласть показывается всегда: без неё карта не читается.
      visible: view === 'FRONT' || operationCount > 0,
      operationCount,
    };
  });
}

/** Таблица присадки карты (§93). */
export function cardOperations(operations: ProductionOperation[]): CardOperationRow[] {
  return operations.map((op) => ({
    index: op.operationIndex,
    type: machiningTypeLabel(op.type),
    face: faceLabel(op.face),
    x: op.x,
    y: op.y,
    notation: operationNotation(op),
    through: op.through,
    source: op.source,
  }));
}

/** Таблица кромки карты (§95): только облицованные стороны. */
export function cardEdges(edges: ProductionEdge[]): CardEdgeRow[] {
  return edges
    .filter((e) => e.edgeMaterialId !== null)
    .map((e) => ({
      label: e.label,
      side: e.side,
      materialName: e.materialName,
      thickness: e.edgeThickness,
      length: e.length,
    }));
}

/**
 * Карта одной детали (§85–§97).
 *
 * `page` строится существующим движком чертежей: вторая система рисования
 * детали не создаётся.
 */
export function partCard(project: Project, part: ProductionPart): PartCard {
  const source = findPart(project, part.partId);
  const ops: MachiningOperation[] = source
    ? allOperations(project).filter((op) => String(op.partId) === String(part.partId))
    : [];
  const page = source ? buildPartPage(project, source, ops, 1, 1, { revision: part.revision }) : null;

  return {
    partId: String(part.partId),
    mark: part.number,
    name: part.name,
    materialName: part.materialName,
    thickness: part.thickness,
    width: part.width,
    height: part.height,
    rawWidth: part.rawWidth,
    rawHeight: part.rawHeight,
    quantity: part.quantity,
    grain: GRAIN_LABELS[part.grain] ?? part.grain,
    orientation: part.width >= part.height ? 'LANDSCAPE' : 'PORTRAIT',
    rotation: part.width >= part.height ? 0 : 90,
    views: cardViews(part.operations),
    operations: cardOperations(part.operations),
    edges: cardEdges(part.edges),
    code: labelCode(String(project.id), part.partId),
    revision: part.revision,
    status: part.status,
    page,
  };
}

/** Карты всех деталей производства (§85). */
export function partCards(project: Project, parts: ProductionPart[]): PartCard[] {
  return parts.map((part) => partCard(project, part));
}
