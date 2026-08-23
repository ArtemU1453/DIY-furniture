/**
 * Интерфейс движка чертежей: строит данные чертежа из модели.
 * В этом каркасе — построение только габаритной рамки (bounds). Полноценные
 * виды/размеры/присадка добавляются на следующих этапах через этот интерфейс.
 */
import type { Drawing, Project } from '@/core/model/types';
import { newDrawingId } from '@/core/model/ids';
import { allParts } from '@/core/model/selectors';

export type DrawingKind = Drawing['kind'];

export interface DrawingEngine {
  readonly id: string;
  readonly name: string;
  build(kind: DrawingKind, project: Project): Drawing;
}

const registry = new Map<string, DrawingEngine>();

export function registerDrawingEngine(engine: DrawingEngine): void {
  registry.set(engine.id, engine);
}

export function listDrawingEngines(): DrawingEngine[] {
  return [...registry.values()];
}

/** Базовый движок: возвращает габаритную рамку по всем деталям. */
export class BoundsDrawingEngine implements DrawingEngine {
  readonly id = 'bounds';
  readonly name = 'Габаритная рамка';

  build(kind: DrawingKind, project: Project): Drawing {
    const parts = allParts(project);
    let width = 0;
    let height = 0;
    for (const p of parts) {
      width = Math.max(width, p.width);
      height = Math.max(height, p.height);
    }
    return {
      id: newDrawingId(),
      title: `Чертёж: ${kind}`,
      kind,
      bounds: { width, height },
    };
  }
}
