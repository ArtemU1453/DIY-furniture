/**
 * Пересчёт деталей корпуса со СТАБИЛЬНЫМИ идентификаторами.
 *
 * При изменении параметров детали не пересоздаются со случайными id: детали
 * сопоставляются по стабильному ключу (metadata.key). Для совпавших ключей
 * сохраняются id, номер (Pxxx) и назначенная пользователем кромка. Это важно
 * для будущих ссылок из чертежей, присадки, раскроя и фурнитуры.
 */
import type { Part } from '@/core/model/types';
import { buildCabinet, type CabinetBuildResult } from './CabinetEngine';
import type { CabinetParameters } from './parameters';

function keyOf(part: Part): string | undefined {
  return part.metadata?.key as string | undefined;
}

function numberOf(part: Part): number {
  const raw = part.metadata?.number as string | undefined;
  const n = raw ? Number(raw.replace(/^P/, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function withNumber(part: Part, num: number): Part {
  return {
    ...part,
    metadata: { ...part.metadata, number: `P${String(num).padStart(3, '0')}` },
  };
}

/** Пересобрать детали шкафа, сохраняя стабильные id/номера/кромку. */
export function rebuildCabinet(
  existing: Part[],
  params: CabinetParameters,
): CabinetBuildResult {
  const built = buildCabinet(params);

  const byKey = new Map<string, Part>();
  for (const p of existing) {
    const k = keyOf(p);
    if (k) byKey.set(k, p);
  }

  let maxNumber = existing.reduce((m, p) => Math.max(m, numberOf(p)), 0);

  const parts = built.parts.map((generated) => {
    const key = keyOf(generated)!;
    const prev = byKey.get(key);
    if (prev) {
      // Сохраняем стабильные поля предыдущей детали.
      return {
        ...generated,
        id: prev.id,
        edges: prev.edges,
        metadata: { ...generated.metadata, number: prev.metadata?.number ?? generated.metadata?.number },
      };
    }
    // Новая деталь — назначаем следующий свободный номер.
    maxNumber += 1;
    return withNumber(generated, maxNumber);
  });

  return { parts, sections: built.sections };
}
