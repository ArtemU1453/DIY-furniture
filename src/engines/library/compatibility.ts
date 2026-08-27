/**
 * CompatibilityValidator (§44/§45) — проверка сочетаемости данных библиотеки
 * с моделью проекта.
 *
 *   Material ↔ Part      — толщина детали совпадает с материалом, материал есть
 *   Hardware ↔ Connection — крепёж применим к этим деталям
 *   Hardware ↔ Machining  — правила крепежа порождают корректные операции
 *   Edge     ↔ Part      — кромка существует и подходит материалу
 *
 * Несовместимость — это WARNING или ERROR, а не молчаливый сбой: пользователь
 * должен видеть, что конфирмат под 18 мм поставлен в деталь 16 мм.
 */
import type {
  EdgeMaterial,
  Hardware,
  HardwareConnection,
  Material,
  Part,
  Project,
} from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { isApplicable } from '@/engines/machining/declarative';
import { materialCategory } from '@/core/library/types';

export type CompatibilitySeverity = 'error' | 'warning';

export interface CompatibilityIssue {
  severity: CompatibilitySeverity;
  code: string;
  message: string;
  partId?: string;
  hardwareId?: string;
  connectionId?: string;
  materialId?: string;
  edgeId?: string;
}

const label = (p: Part): string => (p.metadata?.number as string) ?? p.name;

// ── Material ↔ Part ──────────────────────────────────────────────────────────

export function checkMaterialPart(part: Part, material: Material | undefined): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  if (!part.material) {
    issues.push({
      severity: 'warning', code: 'compat.part.noMaterial',
      message: `Деталь ${label(part)}: материал не назначен.`, partId: String(part.id),
    });
    return issues;
  }
  if (!material) {
    issues.push({
      severity: 'error', code: 'compat.part.materialMissing',
      message: `Деталь ${label(part)}: материал не найден в проекте.`, partId: String(part.id),
    });
    return issues;
  }
  if (material.archived) {
    issues.push({
      severity: 'warning', code: 'compat.material.archived',
      message: `Деталь ${label(part)}: материал «${material.name}» архивирован.`,
      partId: String(part.id), materialId: String(material.id),
    });
  }
  // Толщина детали должна совпадать с толщиной листа — иначе раскрой и
  // присадка посчитаются по разным числам.
  if (Math.abs(part.thickness - material.thickness) > 0.01) {
    issues.push({
      severity: 'error', code: 'compat.part.thickness',
      message: `Деталь ${label(part)}: толщина ${part.thickness} мм не совпадает с материалом «${material.name}» (${material.thickness} мм).`,
      partId: String(part.id), materialId: String(material.id),
    });
  }
  // Деталь не должна быть больше листа ни в одной ориентации.
  const long = Math.max(part.width, part.height);
  const short = Math.min(part.width, part.height);
  const sheetLong = Math.max(material.sheet.length, material.sheet.width);
  const sheetShort = Math.min(material.sheet.length, material.sheet.width);
  if (long > sheetLong || short > sheetShort) {
    issues.push({
      severity: 'error', code: 'compat.part.oversize',
      message: `Деталь ${label(part)} (${part.width}×${part.height}) не помещается на лист «${material.name}» (${material.sheet.length}×${material.sheet.width}).`,
      partId: String(part.id), materialId: String(material.id),
    });
  }
  return issues;
}

// ── Edge ↔ Part ──────────────────────────────────────────────────────────────

export function checkEdgePart(
  part: Part,
  edges: EdgeMaterial[],
  material: Material | undefined,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const byId = new Map(edges.map((e) => [String(e.id), e]));

  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const id = part.edges[side];
    if (!id) continue;
    const edge = byId.get(String(id));
    if (!edge) {
      issues.push({
        severity: 'error', code: 'compat.edge.missing',
        message: `Деталь ${label(part)}: кромка стороны «${side}» не найдена в проекте.`,
        partId: String(part.id), edgeId: String(id),
      });
      continue;
    }
    if (edge.archived) {
      issues.push({
        severity: 'warning', code: 'compat.edge.archived',
        message: `Деталь ${label(part)}: кромка «${edge.name}» архивирована.`,
        partId: String(part.id), edgeId: String(edge.id),
      });
    }
    // Кромка толще детали физически не наклеится на торец.
    if (edge.thickness >= part.thickness) {
      issues.push({
        severity: 'error', code: 'compat.edge.tooThick',
        message: `Деталь ${label(part)}: кромка «${edge.name}» (${edge.thickness} мм) толще детали (${part.thickness} мм).`,
        partId: String(part.id), edgeId: String(edge.id),
      });
    }
    // Явно заданный список совместимых кромок материала.
    if (material?.edgeCompatibility?.length && !material.edgeCompatibility.includes(edge.id)) {
      issues.push({
        severity: 'warning', code: 'compat.edge.material',
        message: `Деталь ${label(part)}: кромка «${edge.name}» не отмечена как совместимая с материалом «${material.name}».`,
        partId: String(part.id), edgeId: String(edge.id), materialId: String(material.id),
      });
    }
  }
  return issues;
}

// ── Hardware ↔ Connection / Machining ────────────────────────────────────────

export function checkHardwareConnection(
  connection: HardwareConnection,
  hardware: Hardware | undefined,
  partA: Part | undefined,
  partB: Part | undefined,
  material?: Material,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  if (!hardware) {
    issues.push({
      severity: 'error', code: 'compat.conn.noHardware',
      message: 'Соединение ссылается на несуществующую фурнитуру.',
      connectionId: String(connection.id),
    });
    return issues;
  }
  if (!partA || !partB) {
    issues.push({
      severity: 'error', code: 'compat.conn.noParts',
      message: `Соединение «${hardware.name}»: одна из деталей не найдена.`,
      connectionId: String(connection.id), hardwareId: String(hardware.id),
    });
    return issues;
  }
  if (hardware.archived) {
    issues.push({
      severity: 'warning', code: 'compat.hardware.archived',
      message: `Соединение ${label(partA)} ↔ ${label(partB)}: фурнитура «${hardware.name}» архивирована.`,
      connectionId: String(connection.id), hardwareId: String(hardware.id),
    });
  }

  // Ограничения правил присадки: несовместимость — это ошибка (§45).
  const ctx = { connection, hardware, partA, partB, material };
  for (const rule of hardware.machiningRules ?? []) {
    const check = isApplicable(rule, ctx);
    if (!check.applicable) {
      issues.push({
        severity: 'error', code: 'compat.hardware.rule',
        message: `Фурнитура «${hardware.name}» не подходит для ${label(partA)} ↔ ${label(partB)}: ${check.reasons.join('; ')}.`,
        connectionId: String(connection.id), hardwareId: String(hardware.id),
        partId: String(partA.id),
      });
    }
  }

  // Категория материала, если у крепежа она ограничена параметрами.
  const minThickness = hardware.parameters?.minThickness;
  if (typeof minThickness === 'number') {
    const thickness = Math.min(partA.thickness, partB.thickness);
    if (thickness < minThickness) {
      issues.push({
        severity: 'error', code: 'compat.hardware.thickness',
        message: `Фурнитура «${hardware.name}» требует толщину не менее ${minThickness} мм, а деталь ${thickness} мм.`,
        connectionId: String(connection.id), hardwareId: String(hardware.id),
      });
    }
  }
  if (material) {
    const cat = materialCategory(material);
    const allowed = hardware.parameters?.materialCategories;
    if (typeof allowed === 'string' && allowed.length > 0) {
      const list = allowed.split(',').map((s) => s.trim());
      if (!list.includes(cat)) {
        issues.push({
          severity: 'warning', code: 'compat.hardware.material',
          message: `Фурнитура «${hardware.name}» не рассчитана на материал категории ${cat}.`,
          connectionId: String(connection.id), hardwareId: String(hardware.id),
        });
      }
    }
  }
  return issues;
}

// ── Полная проверка проекта ──────────────────────────────────────────────────

export interface CompatibilityReport {
  ok: boolean;
  issues: CompatibilityIssue[];
  errors: number;
  warnings: number;
}

/** Проверить весь проект: материалы, кромка, фурнитура, присадка. */
export function validateCompatibility(project: Project): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const materialById = new Map(project.materials.map((m) => [String(m.id), m]));

  for (const part of allParts(project)) {
    const material = part.material ? materialById.get(String(part.material)) : undefined;
    issues.push(...checkMaterialPart(part, material));
    issues.push(...checkEdgePart(part, project.edges, material));
  }

  for (const conn of project.hardwareConnections) {
    const hardware = project.hardware.find((h) => h.id === conn.hardwareId);
    const partA = findPart(project, conn.partAId);
    const partB = findPart(project, conn.partBId);
    const material = partA?.material ? materialById.get(String(partA.material)) : undefined;
    issues.push(...checkHardwareConnection(conn, hardware, partA, partB, material));
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, issues, errors, warnings };
}
