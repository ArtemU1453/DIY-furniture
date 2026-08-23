/**
 * HardwareLedger — подсчёт количества фурнитуры из связей (HardwareConnection).
 * Количество НЕ вводится вручную: оно = число связей, ссылающихся на крепёж.
 */
import type { Hardware, HardwareConnection } from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';

export interface HardwareLedgerRow {
  hardwareId: HardwareId;
  name: string;
  count: number;
}

export function buildHardwareLedger(
  hardware: Hardware[],
  connections: HardwareConnection[],
): HardwareLedgerRow[] {
  const counts = new Map<HardwareId, number>();
  for (const c of connections) {
    counts.set(c.hardwareId, (counts.get(c.hardwareId) ?? 0) + 1);
  }
  return hardware.map((h) => ({
    hardwareId: h.id,
    name: h.name,
    count: counts.get(h.id) ?? 0,
  }));
}
