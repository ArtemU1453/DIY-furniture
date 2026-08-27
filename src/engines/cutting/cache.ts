/**
 * Кэш результатов раскроя. Если входные данные не изменились, повторный расчёт
 * не нужен. Ключ учитывает детали, листы, kerf, припуск, поворот и алгоритм.
 */
import type { CuttingResult } from '@/core/model/types';
import type { CuttingInput } from './types';

/** Детерминированный ключ кэша по входу раскроя и идентификатору алгоритма. */
export function cuttingCacheKey(input: CuttingInput, algorithmId: string): string {
  const pieces = input.pieces
    .map((p) => `${p.pieceId}:${p.length}x${p.width}:${p.grain}:${p.allowRotate}`)
    .sort()
    .join(',');
  const locked = (input.locked ?? [])
    .map((l) => `${l.pieceId}@${l.sheetIndex}:${l.x},${l.y},${l.rotation}`)
    .sort()
    .join(',');
  const remnants = (input.remnantSheets ?? []).map((r) => `${r.id}:${r.length}x${r.width}`).sort().join(',');
  const o = input.options;
  const raw = [
    `algo:${algorithmId}`,
    `mat:${input.materialId}`,
    `sheet:${input.sheet.length}x${input.sheet.width}`,
    `qty:${input.availableQuantity ?? 0}`,
    `kerf:${input.kerf}`,
    `trim:${input.trim.left},${input.trim.right},${input.trim.top},${input.trim.bottom}`,
    `grain:${o.respectGrain}`,
    `mode:${o.optimizationMode}`,
    `sort:${o.sortStrategy}`,
    `attempts:${o.attempts}`,
    `minRemnant:${o.minRemnant}`,
    `usable:${o.usableRemnant.minWidth},${o.usableRemnant.minLength},${o.usableRemnant.minArea}`,
    `pieces:${pieces}`,
    `locked:${locked}`,
    `remnants:${remnants}`,
  ].join('|');
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const MAX_ENTRIES = 24;
const store = new Map<string, CuttingResult>();

export function getCachedResult(key: string): CuttingResult | undefined {
  const hit = store.get(key);
  if (hit) {
    // LRU: освежаем позицию.
    store.delete(key);
    store.set(key, hit);
  }
  return hit;
}

export function setCachedResult(key: string, result: CuttingResult): void {
  store.set(key, result);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function clearCuttingCache(): void {
  store.clear();
}

export function cuttingCacheSize(): number {
  return store.size;
}
