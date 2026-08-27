/**
 * DrawingModel (§7) — формальная модель одного чертежа.
 *
 *   ProjectModel + DocumentSettings → DrawingEngine → DrawingModel → SVG/PNG/PDF
 *
 * Модель описывает ЧТО изображено (виды, размеры, аннотации, таблицы, лист,
 * масштаб), а не как это нарисовано в конкретном формате. Своей геометрии
 * деталей она не заводит: виды строятся из Part/MachiningOperation, размеры —
 * из значений модели.
 */
import type { PartId } from '@/core/model/ids';
import type { Dimension } from './dimensions';
import type { Scene2D } from './scene';
import type { TableColumn } from './table';
import type {
  DocumentType,
  Orientation,
  ScaleValue,
  SheetFormat,
  TitleBlock,
  ViewName,
} from './sheet';

/** Лист чертежа (§8): формат, ориентация, поля, основная надпись. */
export interface DrawingSheet {
  format: SheetFormat;
  orientation: Orientation;
  /** Ширина/высота листа в мм. */
  width: number;
  height: number;
  margins: { left: number; right: number; top: number; bottom: number };
  titleBlock: TitleBlock;
}

/** Один вид на чертеже (§9/§11). */
export interface DrawingView {
  id: string;
  /** Имя основного вида изделия либо произвольная метка вида детали. */
  name: ViewName | string;
  label: string;
  /** Габариты вида в мм модели (до масштабирования). */
  width: number;
  height: number;
  /** Положение вида на листе в мм (левый-нижний угол). */
  x: number;
  y: number;
  /** Скрыт пользователем (§37). */
  hidden?: boolean;
}

/** Аннотация (§36): текст, стрелка, выноска, примечание. */
export interface Annotation {
  id: string;
  kind: 'TEXT' | 'ARROW' | 'LEADER' | 'NOTE';
  x: number;
  y: number;
  /** Для стрелки/выноски — точка, на которую указывает. */
  targetX?: number;
  targetY?: number;
  text: string;
  /** Добавлена пользователем, а не движком. */
  manual?: boolean;
}

/** Позиционная выноска (§22): кружок с номером позиции, привязанный к детали. */
export interface Balloon {
  id: string;
  position: number;
  partId: PartId;
  x: number;
  y: number;
}

/** Таблица на чертеже (§23–§26). */
export interface DrawingTable {
  id: string;
  title: string;
  columns: TableColumn[];
  rows: string[][];
  x: number;
  y: number;
}

/** Полная модель чертежа (§7). */
export interface Drawing {
  id: string;
  type: DocumentType;
  /** Деталь, если чертёж детальный. */
  partId?: PartId;
  views: DrawingView[];
  dimensions: Dimension[];
  annotations: Annotation[];
  balloons: Balloon[];
  tables: DrawingTable[];
  scale: ScaleValue;
  sheet: DrawingSheet;
  /** Отрисованная сцена — производная от видов/размеров/таблиц. */
  scene: Scene2D;
  metadata?: Record<string, unknown>;
}
