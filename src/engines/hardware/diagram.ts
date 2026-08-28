/**
 * Монтажные схемы фурнитуры (§125–§131).
 *
 * Схема строится из той же раскладки, что и присадка: контур детали, реальные
 * отверстия и размеры. Поэтому она не может «разойтись» с тем, что уйдёт в
 * цех, — вторых координат не существует.
 */
import type { HardwareItem, Project } from '@/core/model/types';
import { itemLayout, itemPart } from './items';
import { faceSize, kindOfItem } from './parametric';

export interface DiagramHole {
  x: number;
  y: number;
  diameter: number;
  depth: number;
  role: string;
  through: boolean;
}

export interface DiagramDimension {
  /** Что меряем: 'x' — по горизонтали, 'y' — по вертикали. */
  axis: 'x' | 'y';
  from: number;
  to: number;
  /** Смещение выносной линии от контура, мм. */
  at: number;
  label: string;
}

/** Монтажная схема одной единицы (§126). */
export interface InstallationDiagram {
  itemId: string;
  title: string;
  kind: string;
  face: string;
  /** Габарит вида, мм. */
  width: number;
  height: number;
  holes: DiagramHole[];
  dimensions: DiagramDimension[];
  notes: string[];
}

/**
 * Схема установки единицы (§127–§131).
 *
 * Размеры проставляются от края детали до отверстий — так, как их отмеряет
 * сборщик.
 */
export function installationDiagram(project: Project, item: HardwareItem): InstallationDiagram | null {
  const part = itemPart(project, item);
  const hardware = project.hardware.find((h) => h.id === item.hardwareId);
  const layout = itemLayout(project, item);
  if (!part || !hardware || !layout) return null;

  const face = item.face ?? layout.operations[0]?.face ?? 'front';
  const size = faceSize(part, face);
  const kind = kindOfItem(item, hardware);

  const holes: DiagramHole[] = layout.operations.map((op) => ({
    x: op.x,
    y: op.y,
    diameter: op.diameter ?? 0,
    depth: op.depth ?? 0,
    role: op.role,
    through: op.through === true,
  }));

  const dimensions: DiagramDimension[] = [];
  const notes: string[] = [];

  const uniqueX = [...new Set(holes.map((h) => Math.round(h.x * 10) / 10))].sort((a, b) => a - b);
  const uniqueY = [...new Set(holes.map((h) => Math.round(h.y * 10) / 10))].sort((a, b) => a - b);

  if (uniqueX.length > 0) {
    dimensions.push({ axis: 'x', from: 0, to: uniqueX[0], at: -12, label: `${Math.round(uniqueX[0])}` });
  }
  if (uniqueY.length > 0) {
    dimensions.push({ axis: 'y', from: 0, to: uniqueY[0], at: -12, label: `${Math.round(uniqueY[0])}` });
  }
  if (uniqueY.length > 1) {
    // Шаг между рядами — то, что сборщик отмеряет чаще всего.
    dimensions.push({
      axis: 'y', from: uniqueY[0], to: uniqueY[1], at: -26,
      label: `${Math.round(uniqueY[1] - uniqueY[0])}`,
    });
  }
  if (uniqueX.length > 1) {
    dimensions.push({
      axis: 'x', from: uniqueX[0], to: uniqueX[1], at: -26,
      label: `${Math.round(uniqueX[1] - uniqueX[0])}`,
    });
  }

  switch (kind) {
    case 'HINGE': {
      // §127: чашка, крепёжные отверстия и присадочное расстояние.
      const cup = holes.find((h) => h.role === 'cup');
      if (cup) notes.push(`Чашка Ø${cup.diameter} × ${cup.depth} мм, присадочное расстояние ${Math.round(cup.x)} мм.`);
      notes.push(`Петель на фасаде: ${holes.filter((h) => h.role === 'cup').length}.`);
      break;
    }
    case 'HANDLE': {
      // §128: межцентровое расстояние и отступ от края.
      if (uniqueX.length > 1) notes.push(`Межцентровое расстояние ${Math.round(uniqueX[1] - uniqueX[0])} мм.`);
      else if (uniqueY.length > 1) notes.push(`Межцентровое расстояние ${Math.round(uniqueY[1] - uniqueY[0])} мм.`);
      if (uniqueY.length > 0) notes.push(`Отступ от края ${Math.round(Math.min(uniqueY[0], size.v - uniqueY[0]))} мм.`);
      break;
    }
    case 'DRAWER_SLIDE': {
      // §129: положение, зазор и точки крепления.
      notes.push(`Ось направляющей на высоте ${Math.round(uniqueY[0] ?? 0)} мм.`);
      notes.push(`Точек крепления: ${holes.length}.`);
      const clearance = hardware.parameters?.clearance;
      if (typeof clearance === 'number') notes.push(`Зазор на сторону ${clearance} мм.`);
      break;
    }
    case 'SHELF_PIN': {
      // §130: ряд, шаг и отступы.
      const step = uniqueY.length > 1 ? Math.round(uniqueY[1] - uniqueY[0]) : 32;
      notes.push(`Ряд из ${uniqueY.length} отверстий с шагом ${step} мм.`);
      notes.push(`Отступ ряда от края ${Math.round(uniqueX[0] ?? 0)} мм.`);
      break;
    }
    case 'CONFIRMAT':
    case 'MINIFIX':
    case 'DOWEL':
    case 'CONNECTOR': {
      // §131: точки соединения.
      notes.push(`Точек соединения: ${holes.length}.`);
      for (const hole of holes) {
        notes.push(`${hole.role}: Ø${hole.diameter} ${hole.through ? 'насквозь' : `× ${hole.depth} мм`}.`);
      }
      break;
    }
    default:
      notes.push(`Отверстий: ${holes.length}.`);
      break;
  }

  return {
    itemId: item.id,
    title: `${hardware.name} — ${part.name}`,
    kind,
    face,
    width: size.u,
    height: size.v,
    holes,
    dimensions,
    notes,
  };
}

/**
 * SVG монтажной схемы (§126).
 *
 * Рисуется в миллиметрах: масштабирование остаётся за слоем представления.
 */
export function diagramToSvg(diagram: InstallationDiagram, maxSize = 320): string {
  const pad = 40;
  const scale = Math.min(maxSize / (diagram.width + pad * 2), maxSize / (diagram.height + pad * 2), 1);
  const w = (diagram.width + pad * 2) * scale;
  const h = (diagram.height + pad * 2) * scale;
  const X = (v: number) => (pad + v) * scale;
  // Ось Y на схеме растёт снизу вверх, как у детали.
  const Y = (v: number) => (pad + diagram.height - v) * scale;

  const parts: string[] = [];
  parts.push(`<rect x="${X(0).toFixed(2)}" y="${Y(diagram.height).toFixed(2)}" width="${(diagram.width * scale).toFixed(2)}" height="${(diagram.height * scale).toFixed(2)}" fill="#fbfbfa" stroke="#1a1b1e" stroke-width="1"/>`);

  for (const hole of diagram.holes) {
    const r = Math.max(1.5, (hole.diameter / 2) * scale);
    const color = hole.role === 'cup' ? '#7a8aa8' : hole.through ? '#a33' : '#4b6a45';
    parts.push(`<circle cx="${X(hole.x).toFixed(2)}" cy="${Y(hole.y).toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="${color}" stroke-width="1"/>`);
  }

  for (const dim of diagram.dimensions) {
    if (dim.axis === 'x') {
      const y = Y(0) + Math.abs(dim.at) * scale;
      parts.push(`<line x1="${X(dim.from).toFixed(2)}" y1="${y.toFixed(2)}" x2="${X(dim.to).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#8a919b" stroke-width="0.6"/>`);
      parts.push(`<text x="${((X(dim.from) + X(dim.to)) / 2).toFixed(2)}" y="${(y - 3).toFixed(2)}" font-size="9" fill="#8a919b" text-anchor="middle">${dim.label}</text>`);
    } else {
      const x = X(0) - Math.abs(dim.at) * scale;
      parts.push(`<line x1="${x.toFixed(2)}" y1="${Y(dim.from).toFixed(2)}" x2="${x.toFixed(2)}" y2="${Y(dim.to).toFixed(2)}" stroke="#8a919b" stroke-width="0.6"/>`);
      parts.push(`<text x="${(x - 3).toFixed(2)}" y="${((Y(dim.from) + Y(dim.to)) / 2).toFixed(2)}" font-size="9" fill="#8a919b" text-anchor="end">${dim.label}</text>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}">${parts.join('')}</svg>`;
}

/** Схемы всех единиц проекта (§125). */
export function projectDiagrams(project: Project): InstallationDiagram[] {
  return (project.hardwareInstances ?? [])
    .map((item) => installationDiagram(project, item))
    .filter((d): d is InstallationDiagram => d !== null);
}
