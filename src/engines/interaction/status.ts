/**
 * Статус-бар, индикаторы связи и предпросмотр изменений (§131, §135–§142).
 *
 * Всё здесь — ПРОИЗВОДНОЕ от модели: строка состояния, подписи ошибок и список
 * затронутых элементов вычисляются на лету и ничего не хранят.
 */
import type { Part, Project } from '@/core/model/types';
import { allParts, findPart } from '@/core/model/selectors';
import { affectedByFields, checkCabinet, type CabinetIssue } from '@/engines/cabinet';
import { readParametricModel } from '@/engines/parametric';
import { linkState, type LinkState } from './resize';
import type { SnapCandidate3D } from './snap';

/** Строка состояния (§131). */
export interface StatusLine {
  /** Позиция курсора в мире, мм. */
  cursor: { x: number; y: number; z: number } | null;
  /** Что выбрано. */
  selection: string;
  /** Активный инструмент. */
  tool: string;
  /** Состояние привязки. */
  snap: string;
  units: 'mm';
}

export function buildStatusLine(input: {
  cursor?: { x: number; y: number; z: number } | null;
  selectedNames: string[];
  tool: string;
  snapEnabled: boolean;
  snapMatches?: SnapCandidate3D[];
}): StatusLine {
  const selection = input.selectedNames.length === 0
    ? 'ничего не выбрано'
    : input.selectedNames.length === 1
      ? input.selectedNames[0]
      : `выбрано: ${input.selectedNames.length}`;
  const snap = !input.snapEnabled
    ? 'привязка выключена'
    : input.snapMatches && input.snapMatches.length > 0
      ? `привязка: ${input.snapMatches.map((m) => m.kind).join(', ')}`
      : 'привязка включена';
  return { cursor: input.cursor ?? null, selection, tool: input.tool, snap, units: 'mm' };
}

/**
 * Округление ТОЛЬКО для показа (§134). Внутренние значения не трогаются:
 * округлять модель нельзя, иначе размеры «поплывут» при каждом пересчёте.
 */
export function formatMm(value: number, digits = 1): string {
  const k = 10 ** digits;
  const rounded = Math.round(value * k) / k;
  return `${rounded} мм`;
}

// ── Ошибки и предупреждения у объекта (§135/§136) ────────────────────────────

export interface ObjectIssue {
  partId: string;
  partName: string;
  severity: 'error' | 'warning';
  message: string;
}

/** Замечания, привязанные к конкретным деталям — их показывает подпись рядом. */
export function issuesByPart(project: Project, furnitureId?: string): ObjectIssue[] {
  const furniture = furnitureId
    ? project.furnitures.find((f) => String(f.id) === furnitureId)
    : project.furnitures[0];
  if (!furniture) return [];
  const parts = furniture.assemblies.flatMap((a) => a.parts);
  const model = readParametricModel(furniture);
  const check = checkCabinet(project, model, parts);
  const byId = new Map(parts.map((p) => [String(p.id), p]));

  const out: ObjectIssue[] = [];
  for (const issue of check.issues as CabinetIssue[]) {
    for (const id of issue.partIds ?? []) {
      const part = byId.get(id);
      if (!part) continue;
      out.push({ partId: id, partName: part.name, severity: issue.severity, message: issue.message });
    }
  }
  return out;
}

// ── Индикаторы связи (§137/§138) ─────────────────────────────────────────────

export interface LinkIndicator {
  partId: string;
  state: LinkState;
  label: string;
}

const LINK_LABEL: Record<LinkState, string> = {
  LINKED: 'Linked',
  OVERRIDE: 'Override',
  LOCKED: 'Locked',
  MANUAL: 'Manual',
};

export function linkIndicator(part: Part): LinkIndicator {
  const state = linkState(part);
  return { partId: String(part.id), state, label: LINK_LABEL[state] };
}

export function linkIndicators(project: Project): LinkIndicator[] {
  return allParts(project).map(linkIndicator);
}

/**
 * Подсветить элементы, зависящие от параметра (§138/§139).
 *
 * Цепочка берётся из графа зависимостей корпуса этапа 28 — второго описания
 * зависимостей не заводится.
 */
export interface DependencyPreview {
  field: string;
  /** Узлы графа, до которых доходит изменение. */
  nodes: string[];
  /** Детали, которые перестроятся. */
  partIds: string[];
  description: string;
}

const NODE_TO_TYPES: Record<string, string[]> = {
  sides: ['side_left', 'side_right'],
  topBottom: ['top', 'bottom'],
  shelves: ['shelf'],
  partitions: ['divider'],
  doors: ['facade'],
  drawers: ['drawer_front', 'drawer_side', 'drawer_back', 'drawer_bottom'],
  back: ['back'],
  legs: ['board'],
  plinth: ['board'],
};

export function dependencyPreview(project: Project, field: string): DependencyPreview {
  const nodes = affectedByFields([field]);
  const types = new Set(nodes.flatMap((node) => NODE_TO_TYPES[node] ?? []));
  const partIds = allParts(project)
    .filter((p) => types.has(String(p.metadata?.partType ?? '')))
    .map((p) => String(p.id));
  return {
    field,
    nodes,
    partIds,
    description: nodes.length > 0 ? `${field} → ${nodes.join(' → ')}` : `${field}: зависимостей нет`,
  };
}

// ── Предпросмотр большого изменения (§140–§142) ──────────────────────────────

export interface ChangePreview {
  /** Затронутые детали с именами. */
  parts: Array<{ id: string; name: string }>;
  /** Разделы, которые придётся обновить. */
  sections: string[];
  /** Показывать ли подтверждение: мелкие правки его не требуют. */
  needsConfirmation: boolean;
  summary: string;
}

/** Сколько деталей считается «большим изменением» (§140). */
export const LARGE_CHANGE_THRESHOLD = 10;

export function changePreview(project: Project, field: string): ChangePreview {
  const preview = dependencyPreview(project, field);
  const parts = preview.partIds
    .map((id) => findPart(project, id as Part['id']))
    .filter((p): p is Part => Boolean(p))
    .map((p) => ({ id: String(p.id), name: p.name }));
  const needsConfirmation = parts.length >= LARGE_CHANGE_THRESHOLD;
  return {
    parts,
    sections: preview.nodes,
    needsConfirmation,
    summary: `Изменение «${field}» затронет деталей: ${parts.length}`,
  };
}
