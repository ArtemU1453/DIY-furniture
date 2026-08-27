/**
 * Каталог алгоритмов раскроя (§28–§30).
 *
 * Тип CuttingAlgorithmKind — производственная классификация, а id движка —
 * то, что реально зарегистрировано в реестре. Пользователь выбирает вид, UI
 * получает конкретный движок; появление нового движка не требует правок UI.
 */
import { getCuttingEngine, listCuttingEngines, type CuttingEngine } from './CuttingEngine';

export type CuttingAlgorithmKind = 'SIMPLE_SHELF' | 'GUILLOTINE' | 'MAXRECTS' | 'SKYLINE' | 'CUSTOM';

export interface CuttingAlgorithmInfo {
  kind: CuttingAlgorithmKind;
  /** id зарегистрированного движка (CuttingEngine.id). */
  engineId: string;
  name: string;
  /** Даёт ли алгоритм гильотинный раскрой (сквозные линии реза). */
  guillotine: boolean;
  description: string;
}

/**
 * Известные виды алгоритмов. CUSTOM намеренно без engineId: под него
 * подставляется любой сторонний движок, зарегистрированный в реестре.
 */
export const CUTTING_ALGORITHMS: CuttingAlgorithmInfo[] = [
  {
    kind: 'MAXRECTS',
    engineId: 'maxrects',
    name: 'MaxRects',
    guillotine: false,
    description: 'Наилучшее использование материала; рез не всегда сквозной.',
  },
  {
    kind: 'GUILLOTINE',
    engineId: 'guillotine',
    name: 'Гильотинный',
    guillotine: true,
    description: 'Сквозные резы через весь лист — под форматно-раскроечный станок.',
  },
  {
    kind: 'SIMPLE_SHELF',
    engineId: 'shelf',
    name: 'Полочный',
    guillotine: true,
    description: 'Ряды одинаковой высоты, один проход. Самый предсказуемый рез.',
  },
  {
    kind: 'SKYLINE',
    engineId: 'skyline',
    name: 'Skyline',
    guillotine: false,
    description: 'Быстрая укладка больших партий деталей.',
  },
];

/** Алгоритм по умолчанию (§30): существующий движок не заменяется. */
export const DEFAULT_ALGORITHM_KIND: CuttingAlgorithmKind = 'MAXRECTS';

export function algorithmByKind(kind: CuttingAlgorithmKind): CuttingAlgorithmInfo | undefined {
  return CUTTING_ALGORITHMS.find((a) => a.kind === kind);
}

export function algorithmByEngineId(engineId: string): CuttingAlgorithmInfo | undefined {
  return CUTTING_ALGORITHMS.find((a) => a.engineId === engineId);
}

/** Вид алгоритма для движка; незнакомый движок классифицируется как CUSTOM. */
export function kindOfEngine(engineId: string): CuttingAlgorithmKind {
  return algorithmByEngineId(engineId)?.kind ?? 'CUSTOM';
}

/** Движок по виду алгоритма (только зарегистрированные). */
export function engineForKind(kind: CuttingAlgorithmKind): CuttingEngine | undefined {
  const info = algorithmByKind(kind);
  if (!info) return undefined;
  return getCuttingEngine(info.engineId);
}

/**
 * Виды алгоритмов, доступные прямо сейчас: заявленные и одновременно
 * зарегистрированные. Плюс CUSTOM, если в реестре есть посторонний движок.
 */
export function availableAlgorithms(): CuttingAlgorithmInfo[] {
  const registered = new Set(listCuttingEngines().map((e) => e.id));
  const known = CUTTING_ALGORITHMS.filter((a) => registered.has(a.engineId));
  const extra = listCuttingEngines().filter((e) => !algorithmByEngineId(e.id));
  return [
    ...known,
    ...extra.map((e) => ({
      kind: 'CUSTOM' as const,
      engineId: e.id,
      name: e.name,
      guillotine: false,
      description: 'Сторонний движок раскроя.',
    })),
  ];
}
