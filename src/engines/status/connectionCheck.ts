/**
 * ConnectionCheck — проверка соединений фурнитуры: существование деталей и
 * крепежа, корректность генерируемой присадки (координаты/глубина/выход за
 * край), дубли соединений, отсутствие «висячих» операций.
 */
import type { Project } from '@/core/model/types';
import { findPart } from '@/core/model/selectors';
import { generateMachining, validateMachining } from '@/engines/machining';
import { getMachiningRule } from '@/engines/machining';
import type { ProjectIssue } from './projectValidator';

export function validateConnections(project: Project): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const hwById = new Map(project.hardware.map((h) => [h.id, h]));
  const seen = new Set<string>();

  for (const conn of project.hardwareConnections) {
    const hardware = hwById.get(conn.hardwareId);
    const a = findPart(project, conn.partAId);
    const b = findPart(project, conn.partBId);

    if (!hardware) {
      issues.push({ severity: 'error', code: 'conn.noHardware', message: `Соединение ${conn.id.slice(0, 6)}: фурнитура не найдена.`, targetId: conn.id });
      continue;
    }
    if (!a || !b) {
      issues.push({ severity: 'error', code: 'conn.noPart', message: `Соединение ${conn.id.slice(0, 6)}: деталь не найдена.`, targetId: conn.id });
      continue;
    }

    // Дубль соединения (те же детали + тот же крепёж).
    const key = [conn.hardwareId, ...[conn.partAId, conn.partBId].sort()].join('|');
    if (seen.has(key)) {
      issues.push({ severity: 'warning', code: 'conn.duplicate', message: `Дублирующее соединение «${hardware.name}» для ${a.name} ↔ ${b.name}.`, targetId: conn.id });
    }
    seen.add(key);

    // Наличие правила присадки и реально сгенерированные операции.
    const rule = getMachiningRule(hardware.category);
    if (!rule) {
      issues.push({ severity: 'warning', code: 'conn.noRule', message: `Для «${hardware.name}» нет правила присадки — операции не создаются.`, targetId: conn.id });
      continue;
    }
    const ops = rule.build({ connection: conn, hardware, partA: a, partB: b });
    if (ops.length === 0) {
      issues.push({ severity: 'warning', code: 'conn.noOps', message: `Соединение «${hardware.name}» (${a.name} ↔ ${b.name}): не удалось разместить крепёж (детали не соприкасаются?).`, targetId: conn.id });
    }
  }

  // Валидация всех производных операций (глубина/границы/пересечения).
  const machiningIssues = validateMachining(generateMachining(project), project);
  for (const mi of machiningIssues) {
    if (mi.severity === 'error') {
      issues.push({ severity: 'error', code: mi.code, message: mi.message, targetId: mi.operationId });
    }
  }

  return issues;
}
