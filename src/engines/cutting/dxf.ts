/**
 * Экспорт раскроя в DXF (§114).
 *
 * Внешних сервисов и платных библиотек здесь нет: DXF — текстовый формат, и
 * минимальный корректный файл (заголовок, слои, LWPOLYLINE, TEXT) пишется
 * локально. Интерфейс CuttingExporter оставляет место другим форматам, не
 * заставляя менять вызывающий код.
 */
import type { CuttingResult, CuttingSheetResult } from '@/core/model/types';

/** Экспортёр раскроя (§114): один и тот же вызов для любого формата. */
export interface CuttingExporter {
  id: string;
  label: string;
  /** Расширение файла без точки. */
  extension: string;
  mimeType: string;
  sheet(sheet: CuttingSheetResult): string;
  result(result: CuttingResult): string;
}

const line = (code: number | string, value: string | number): string => `${code}\n${value}\n`;

/** Замкнутый прямоугольник как LWPOLYLINE. */
function polyline(layer: string, x: number, y: number, w: number, h: number): string {
  return line(0, 'LWPOLYLINE')
    + line(8, layer)
    + line(100, 'AcDbEntity')
    + line(100, 'AcDbPolyline')
    + line(90, 4)
    + line(70, 1) // замкнутая
    + line(10, x) + line(20, y)
    + line(10, x + w) + line(20, y)
    + line(10, x + w) + line(20, y + h)
    + line(10, x) + line(20, y + h);
}

function text(layer: string, x: number, y: number, height: number, value: string): string {
  return line(0, 'TEXT')
    + line(8, layer)
    + line(10, x) + line(20, y)
    + line(40, height)
    + line(1, value);
}

function header(): string {
  return line(0, 'SECTION') + line(2, 'HEADER')
    + line(9, '$INSUNITS') + line(70, 4) // миллиметры
    + line(0, 'ENDSEC')
    + line(0, 'SECTION') + line(2, 'ENTITIES');
}

const footer = (): string => line(0, 'ENDSEC') + line(0, 'EOF');

/** Один лист раскроя в DXF: контур листа, рабочая область, детали и подписи. */
export function sheetToDxf(sheet: CuttingSheetResult): string {
  let body = header();
  body += polyline('SHEET', 0, 0, sheet.length, sheet.width);
  body += polyline(
    'USABLE',
    sheet.trim.left,
    sheet.trim.bottom,
    sheet.length - sheet.trim.left - sheet.trim.right,
    sheet.width - sheet.trim.top - sheet.trim.bottom,
  );
  for (const placement of sheet.placements) {
    body += polyline('PARTS', placement.x, placement.y, placement.length, placement.width);
    const size = Math.max(8, Math.min(placement.length, placement.width) / 6);
    body += text('LABELS', placement.x + 5, placement.y + 5, size, placement.number || placement.name);
  }
  for (const remnant of sheet.remnants) {
    body += polyline(remnant.usable ? 'REMNANT' : 'WASTE', remnant.x, remnant.y, remnant.width, remnant.height);
  }
  return body + footer();
}

/** Весь результат: листы идут друг за другом со сдвигом по X. */
export function resultToDxf(result: CuttingResult): string {
  let body = header();
  let offset = 0;
  for (const sheet of result.sheets) {
    body += polyline('SHEET', offset, 0, sheet.length, sheet.width);
    for (const placement of sheet.placements) {
      body += polyline('PARTS', offset + placement.x, placement.y, placement.length, placement.width);
    }
    offset += sheet.length + 100;
  }
  return body + footer();
}

export const dxfExporter: CuttingExporter = {
  id: 'dxf',
  label: 'DXF',
  extension: 'dxf',
  mimeType: 'application/dxf',
  sheet: sheetToDxf,
  result: resultToDxf,
};

const registry = new Map<string, CuttingExporter>([[dxfExporter.id, dxfExporter]]);

/** Зарегистрировать свой экспортёр, не трогая вызывающий код (§114). */
export function registerCuttingExporter(exporter: CuttingExporter): void {
  registry.set(exporter.id, exporter);
}

export function getCuttingExporter(id: string): CuttingExporter | undefined {
  return registry.get(id);
}

export function listCuttingExporters(): CuttingExporter[] {
  return [...registry.values()];
}
