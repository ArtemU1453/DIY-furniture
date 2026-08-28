/**
 * Пересборка соединений при изменении конструкции (§47–§50, §96).
 *
 * Правила те же, что и для деталей этапа 18:
 *
 * СТАБИЛЬНОСТЬ — соединение узнаётся по stableId (ключи деталей + позиция) и
 * сохраняет свой id, а значит производные операции присадки не пересоздаются
 * со случайными идентификаторами и ручные правки не теряются.
 *
 * ЧИСТКА (§49) — если деталь исчезла из конфигурации, её соединения исчезают
 * вместе с ней: «мёртвых» операций присадки не остаётся.
 *
 * РУЧНЫЕ (§50) — соединение с source: MANUAL переживает регенерацию, даже
 * если правила его бы не создали.
 */
import type {
  Hardware,
  HardwareCategory,
  HardwareConnection,
  Part,
  Project,
} from '@/core/model/types';
import { catalogByCategory, hardwareFromTemplate } from '@/core/model/hardwareCatalog';
import type { HardwareConnectionId, HardwareId } from '@/core/model/ids';
import { newHardwareConnectionId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';
import { inferJointType } from '@/engines/machining/joint';
import { connectionTypeOfCategory } from '@/engines/machining/connectionType';
import { planConnections, type ConnectionRuleContext, type ConnectionPlanItem } from './rules';
import { partKey } from './identity';

export interface ReconcileResult {
  connections: HardwareConnection[];
  /** Стабильные id созданных соединений. */
  added: string[];
  /** Стабильные id удалённых (деталь исчезла или правило больше не создаёт). */
  removed: string[];
  /** Сохранённые ручные соединения. */
  manual: string[];
  /** Соединения, потерявшие деталь и удалённые как мёртвые. */
  orphaned: string[];
}

/** Источник соединения: ручное переживает регенерацию. */
export function connectionSource(c: HardwareConnection): 'PARAMETRIC' | 'MANUAL' {
  if (c.source) return c.source;
  // Соединения без stableId созданы вручную (или ещё до этапа 19).
  return c.stableId ? 'PARAMETRIC' : 'MANUAL';
}

/** Подобрать фурнитуру нужной категории; при отсутствии — undefined. */
function pickHardware(project: Project, category: HardwareCategory): HardwareId | undefined {
  const active = project.hardware.filter((h) => h.category === category && h.archived !== true);
  return (active[0] ?? project.hardware.find((h) => h.category === category))?.id;
}

/**
 * Пересобрать соединения проекта по правилам.
 *
 * parts — АКТУАЛЬНЫЙ список деталей (после регенерации). Соединения, чьи
 * детали в нём отсутствуют, отбрасываются.
 */
export function reconcileConnections(
  project: Project,
  parts: Part[],
  ctx: Omit<ConnectionRuleContext, 'parts'>,
): ReconcileResult {
  const livePartIds = new Set(parts.map((p) => String(p.id)));
  const partByKey = new Map(parts.map((p) => [partKey(p), p]));
  const existing = project.hardwareConnections;

  // Ручные соединения сохраняем — но только если их детали ещё существуют.
  const manual: HardwareConnection[] = [];
  const orphaned: string[] = [];
  for (const c of existing) {
    if (connectionSource(c) !== 'MANUAL') continue;
    if (livePartIds.has(String(c.partAId)) && livePartIds.has(String(c.partBId))) {
      manual.push(c);
    } else {
      orphaned.push(c.stableId ?? String(c.id));
    }
  }

  const byStableId = new Map(
    existing.filter((c) => c.stableId).map((c) => [c.stableId!, c]),
  );

  const plans: ConnectionPlanItem[] = planConnections({ ...ctx, parts });
  const added: string[] = [];
  const generated: HardwareConnection[] = [];

  for (const item of plans) {
    const partA = partByKey.get(item.aKey);
    const partB = partByKey.get(item.bKey);
    if (!partA || !partB) continue;

    const hardwareId = pickHardware(project, item.category);
    if (!hardwareId) continue; // нет такой фурнитуры в проекте — соединение не создаём

    const prev = byStableId.get(item.stableId);
    const id: HardwareConnectionId = prev?.id ?? newHardwareConnectionId();
    if (!prev) added.push(item.stableId);

    generated.push({
      id,
      hardwareId: prev?.hardwareId ?? hardwareId,
      partAId: partA.id,
      partBId: partB.id,
      connectionType: connectionTypeOfCategory(item.category),
      jointType: inferJointType(partA, partB),
      quantity: prev?.quantity ?? item.quantity,
      stableId: item.stableId,
      source: 'PARAMETRIC',
      position: item.position,
      // Параметры, заданные пользователем, переживают пересчёт.
      parameters: prev?.parameters,
      metadata: { ...prev?.metadata, rule: item.ruleId },
    });
  }

  const activeStableIds = new Set(plans.map((p) => p.stableId));
  const removed = [...byStableId.keys()].filter((k) => !activeStableIds.has(k));

  return {
    connections: [...generated, ...manual],
    added,
    removed,
    manual: manual.map((c) => c.stableId ?? String(c.id)),
    orphaned,
  };
}

/**
 * Дозавести фурнитуру, которой требуют запланированные соединения (этап 35).
 *
 * reconcileConnections молча пропускает узел, если в проекте нет фурнитуры его
 * категории. Раньше это компенсировал только путь шаблонов — из-за чего один и
 * тот же шкаф, созданный мастером, получал меньше соединений (а значит и
 * присадки), чем созданный из шаблона. Теперь недостающие позиции добирает
 * общий шаг, и оба пути дают одинаковый результат.
 *
 * Возвращает НОВЫЕ позиции фурнитуры; записывает их вызывающий — тем же
 * commit, что и детали, поэтому шаг целиком ложится в undo/redo.
 */
export function ensureConnectionHardware(
  project: Project,
  parts: Part[],
  ctx: Omit<ConnectionRuleContext, 'parts'>,
): Hardware[] {
  const created: Hardware[] = [];
  const has = (category: HardwareCategory) =>
    project.hardware.some((h) => h.category === category)
    || created.some((h) => h.category === category);

  for (const plan of planConnections({ ...ctx, parts })) {
    if (has(plan.category)) continue;
    const template = catalogByCategory(plan.category)[0];
    if (!template) continue; // категории нет в каталоге — соединение не создастся
    created.push(hardwareFromTemplate(template));
  }
  return created;
}

/**
 * Убрать соединения, ссылающиеся на несуществующие детали (§49).
 * Применяется и вне регенерации — например после ручного удаления детали.
 */
export function pruneDeadConnections(project: Project): {
  connections: HardwareConnection[];
  removed: string[];
} {
  const live = new Set(allParts(project).map((p) => String(p.id)));
  const kept: HardwareConnection[] = [];
  const removed: string[] = [];
  for (const c of project.hardwareConnections) {
    if (live.has(String(c.partAId)) && live.has(String(c.partBId))) kept.push(c);
    else removed.push(String(c.id));
  }
  return { connections: kept, removed };
}

/**
 * Какие соединения затронет изменение перечисленных деталей (§96).
 * Позволяет пересчитывать только зависимое, а не весь проект.
 */
export function affectedConnections(
  connections: HardwareConnection[],
  changedPartIds: string[],
): HardwareConnection[] {
  const changed = new Set(changedPartIds.map(String));
  return connections.filter(
    (c) => changed.has(String(c.partAId)) || changed.has(String(c.partBId)),
  );
}
