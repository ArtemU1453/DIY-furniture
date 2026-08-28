/**
 * QR-код детали (§106/§107, §110–§112).
 *
 * Готового генератора QR в проекте нет, поэтому здесь описан ИНТЕРФЕЙС и
 * реестр генераторов: содержимое кода считает движок, а рисование матрицы
 * подключается локально (библиотека или собственный кодировщик). Никаких
 * внешних сервисов: данные детали не уходят наружу (§112). Пока генератор не
 * зарегистрирован, движок отдаёт содержимое кода, а слой представления
 * показывает его текстом или штрихкодом.
 */
import type { Project } from '@/core/model/types';
import type { PartId } from '@/core/model/ids';
import { labelCode, parseLabelCode } from '@/engines/cutting';

/** Содержимое QR (§111): идентификатор проекта и детали, без внешних ссылок. */
export interface QrPayload {
  projectId: string;
  partId: string;
  instance?: string;
}

/** Строка QR детали — тот же код, что и на этикетке раскроя (§111). */
export function qrPayload(project: Project, partId: PartId, instance?: string): string {
  return labelCode(String(project.id), partId, instance);
}

/** Разобрать содержимое QR обратно (для сканера цеха). */
export function parseQrPayload(text: string): QrPayload | null {
  const parsed = parseLabelCode(text);
  if (!parsed) return null;
  return { projectId: parsed.projectId, partId: parsed.partId, instance: parsed.instance };
}

/** Матрица QR: true — тёмный модуль. */
export type QrMatrix = boolean[][];

/** Локальный генератор QR (§107). Внешние сервисы недопустимы. */
export interface QrGenerator {
  id: string;
  name: string;
  /** Вернуть матрицу модулей или null, если текст не кодируется. */
  generate(text: string): QrMatrix | null;
}

const GENERATORS = new Map<string, QrGenerator>();
let activeId: string | null = null;

/** Зарегистрировать локальный генератор QR. */
export function registerQrGenerator(generator: QrGenerator, makeActive = true): void {
  GENERATORS.set(generator.id, generator);
  if (makeActive || activeId === null) activeId = generator.id;
}

export function listQrGenerators(): QrGenerator[] {
  return [...GENERATORS.values()];
}

/** Текущий генератор или undefined, если ни один не подключён. */
export function getQrGenerator(id?: string): QrGenerator | undefined {
  const key = id ?? activeId;
  return key === null || key === undefined ? undefined : GENERATORS.get(key);
}

export function clearQrGenerators(): void {
  GENERATORS.clear();
  activeId = null;
}

/** Матрица QR для текста; null — генератор не подключён (§107). */
export function qrMatrix(text: string, generatorId?: string): QrMatrix | null {
  return getQrGenerator(generatorId)?.generate(text) ?? null;
}

/** SVG-разметка матрицы QR. Возвращает null, если матрицы нет. */
export function qrMatrixToSvg(matrix: QrMatrix | null, size = 24): string | null {
  if (!matrix || matrix.length === 0) return null;
  const n = matrix.length;
  const cell = size / n;
  const rects: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue;
      rects.push(`<rect x="${(x * cell).toFixed(3)}" y="${(y * cell).toFixed(3)}" width="${cell.toFixed(3)}" height="${cell.toFixed(3)}" />`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="#111"><rect width="${size}" height="${size}" fill="#fff"/>${rects.join('')}</svg>`;
}
