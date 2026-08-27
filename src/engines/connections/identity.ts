/**
 * Идентичность соединений (§5, §42–§44) и операций присадки (§48).
 *
 * Соединение узнаётся по СТАБИЛЬНОМУ ключу, собранному из ключей деталей и
 * позиции узла: при пересчёте параметров соединение сохраняет свой id, а
 * значит и производные операции присадки не «прыгают».
 *
 * Дубликат — это соединение с тем же ключом. Ключ не зависит от порядка
 * деталей: SIDE↔TOP и TOP↔SIDE — одно и то же соединение.
 */
import type { HardwareConnection, Part } from '@/core/model/types';

/** Стабильный ключ детали из параметрического генератора. */
export function partKey(part: Part): string {
  return (part.metadata?.key as string | undefined) ?? String(part.id);
}

/**
 * Стабильный id соединения (§5): CABINET.SIDE.LEFT↔CABINET.TOP.
 * Детали сортируются, поэтому порядок аргументов роли не играет.
 */
export function connectionStableId(
  aKey: string,
  bKey: string,
  position?: string,
): string {
  const [first, second] = [aKey, bKey].sort();
  return position ? `${first}↔${second}#${position}` : `${first}↔${second}`;
}

/**
 * Ключ дедупликации (§43): тип + отсортированная пара деталей + крепёж +
 * позиция. Два соединения с одинаковым ключом считаются одним и тем же.
 */
export function connectionKey(connection: {
  connectionType?: string;
  partAId: string;
  partBId: string;
  hardwareId: string;
  position?: string;
}): string {
  const [a, b] = [String(connection.partAId), String(connection.partBId)].sort();
  return [
    connection.connectionType ?? 'OTHER',
    a, b,
    String(connection.hardwareId),
    connection.position ?? '',
  ].join('|');
}

/** Есть ли уже такое соединение в списке (§42). */
export function isDuplicate(
  existing: HardwareConnection[],
  candidate: Pick<HardwareConnection, 'connectionType' | 'partAId' | 'partBId' | 'hardwareId' | 'position'>,
  ignoreId?: string,
): boolean {
  const key = connectionKey({
    connectionType: candidate.connectionType,
    partAId: String(candidate.partAId),
    partBId: String(candidate.partBId),
    hardwareId: String(candidate.hardwareId),
    position: candidate.position,
  });
  return existing.some((c) => {
    if (ignoreId && String(c.id) === ignoreId) return false;
    return connectionKey({
      connectionType: c.connectionType,
      partAId: String(c.partAId),
      partBId: String(c.partBId),
      hardwareId: String(c.hardwareId),
      position: c.position,
    }) === key;
  });
}

/** Убрать дубликаты, сохранив первое вхождение. */
export function dedupeConnections(connections: HardwareConnection[]): HardwareConnection[] {
  const seen = new Set<string>();
  const out: HardwareConnection[] = [];
  for (const c of connections) {
    const key = connectionKey({
      connectionType: c.connectionType,
      partAId: String(c.partAId),
      partBId: String(c.partBId),
      hardwareId: String(c.hardwareId),
      position: c.position,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ── Идентификаторы операций (§48) ────────────────────────────────────────────

/** Человекочитаемый номер соединения: C001, C002. */
export function connectionNumber(index: number): string {
  return `C${String(index + 1).padStart(3, '0')}`;
}

/** Карта id соединения → его номер C001 (для чертежей и отчётов, §64). */
export function connectionNumbers(connections: HardwareConnection[]): Map<string, string> {
  return new Map(connections.map((c, i) => [String(c.id), connectionNumber(i)]));
}

/**
 * Стабильный id операции присадки (§48): CONN001.PART_A.DRILL.001.
 *
 * Форма читаемая и детерминированная: одна и та же операция при пересчёте
 * получает тот же id, поэтому ручные правки (overrides) её не теряют.
 */
export function machiningStableId(
  connectionNo: string,
  role: string,
  kind: string,
  index: number,
): string {
  return `${connectionNo}.${role}.${kind}.${String(index + 1).padStart(3, '0')}`;
}
