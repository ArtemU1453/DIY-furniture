/**
 * RuleEngine (§20/§21) — единый механизм работы с правилами присадки.
 *
 *   Hardware ──► HardwareRule[] ──► RuleEngine ──► MachiningOperation[]
 *
 * Есть два источника правил, и оба ведут в одну точку:
 *
 * 1. ДЕКЛАРАТИВНЫЕ правила `hardware.machiningRules` — данные, которые
 *    пользователь задаёт в редакторе фурнитуры (§12/§14). Их исполняет этот
 *    движок.
 * 2. ВСТРОЕННЫЕ правила по категории (реестр `engines/machining/rules`) —
 *    код, написанный на этапе 09/15. Используются, когда у фурнитуры нет
 *    собственных правил, поэтому существующий каталог продолжает работать
 *    без изменений.
 *
 * Второй набор операций не создаётся: движок отдаёт обычные
 * MachiningOperation с теми же детерминированными id, что и раньше.
 */
import type {
  HardwareRule,
  Hardware,
  HardwareConnection,
  MachiningOperation,
  Project,
} from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import {
  applyDeclarativeRules,
  applyRule,
  isApplicable,
  type ApplicabilityResult,
  type RuleContext,
} from '@/engines/machining/declarative';
import { getMachiningRule } from '@/engines/machining/rules';
import { validateMachining, type MachiningIssue } from '@/engines/machining/validate';

/* Исполнение правил живёт в engines/machining/declarative — здесь только
 * фасад библиотеки: получить правило, проверить, применить, валидировать. */
export { applyRule, isApplicable };
export type { ApplicabilityResult, RuleContext };

export interface RuleApplyResult {
  operations: MachiningOperation[];
  /** Правила, которые не подошли, с причинами. */
  skipped: Array<{ rule: HardwareRule; reasons: string[] }>;
  /** Откуда взялись правила. */
  source: 'declarative' | 'builtin' | 'none';
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

// ── 1. Получить правило (§21) ────────────────────────────────────────────────

/** Декларативные правила крепежа, если пользователь их задал. */
export function getRules(hardware: Hardware): HardwareRule[] {
  return hardware.machiningRules ?? [];
}

/** Есть ли у крепежа собственные правила (иначе работает встроенное). */
export function hasDeclarativeRules(hardware: Hardware): boolean {
  return getRules(hardware).length > 0;
}

// ── 2/3. Проверить и применить (§15/§21/§45) ─────────────────────────────────

/**
 * Применить все правила крепежа. Если декларативных правил нет, работу
 * выполняет встроенное правило категории — поведение прежних этапов
 * не меняется.
 */
export function applyRules(ctx: RuleContext): RuleApplyResult {
  if (getRules(ctx.hardware).length === 0) {
    const builtin = getMachiningRule(ctx.hardware.category);
    if (!builtin) return { operations: [], skipped: [], source: 'none' };
    const operations = builtin
      .build({ connection: ctx.connection, hardware: ctx.hardware, partA: ctx.partA, partB: ctx.partB })
      .map((op) => ({ ...op, hardwareId: ctx.hardware.id }));
    return { operations, skipped: [], source: 'builtin' };
  }
  const { operations, skipped } = applyDeclarativeRules(ctx);
  return { operations, skipped, source: 'declarative' };
}

// ── 4/5. Результат и его валидация (§21) ─────────────────────────────────────

/** Проверить порождённые операции существующим валидатором присадки. */
export function validateResult(operations: MachiningOperation[], project: Project): MachiningIssue[] {
  return validateMachining(operations, project);
}

/** Полный цикл для одной связи: получить → проверить → применить → валидировать. */
export function runForConnection(
  project: Project,
  connection: HardwareConnection,
): { result: RuleApplyResult; issues: MachiningIssue[] } | null {
  const hardware = project.hardware.find((h) => h.id === connection.hardwareId);
  const partA = findPart(project, connection.partAId);
  const partB = findPart(project, connection.partBId);
  if (!hardware || !partA || !partB) return null;
  const material = project.materials.find((m) => m.id === partA.material);
  const result = applyRules({ connection, hardware, partA, partB, material });
  return { result, issues: validateResult(result.operations, project) };
}

// ── Предпросмотр правил (§43) ────────────────────────────────────────────────

export interface RulePreviewRow {
  /** «2 × DRILL Ø7» */
  label: string;
  count: number;
  operation: string;
  diameter: number;
  depth?: number;
  through: boolean;
}

const OPERATION_LABELS: Record<string, string> = {
  drilling: 'DRILL', boring: 'BORE', dowel: 'DOWEL', confirmat: 'CONFIRMAT',
  hinge: 'HINGE', pocket: 'POCKET', slot: 'SLOT', custom: 'CUSTOM',
};

/**
 * Что будет создано при выборе этой фурнитуры (§43) — без построения стыка,
 * только по описанию правил. Показывается в редакторе соединения.
 */
export function previewRules(hardware: Hardware): RulePreviewRow[] {
  const rules = getRules(hardware);
  if (rules.length === 0) return [];
  return rules.map((rule) => {
    const sides = rule.target === 'both' ? 2 : 1;
    const count = num(rule.count, 2) * sides;
    const op = OPERATION_LABELS[rule.operation] ?? rule.operation.toUpperCase();
    const size = rule.through
      ? `Ø${rule.diameter} THRU`
      : rule.depth != null ? `Ø${rule.diameter} × ${rule.depth}` : `Ø${rule.diameter}`;
    return {
      label: `${count} × ${op} ${size}`,
      count,
      operation: op,
      diameter: rule.diameter,
      depth: rule.depth,
      through: rule.through === true,
    };
  });
}
