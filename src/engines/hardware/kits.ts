/**
 * HardwareKit — комплект фурнитуры (§23–§25/§54/§55).
 *
 * Комплект — способ ПОСЧИТАТЬ, а не отдельная позиция склада. Количество
 * компонентов выводится из числа применений комплекта, поэтому независимого
 * количества нигде не хранится (§85): 10 минификсов = 10 эксцентриков +
 * 10 штоков + 10 футорок, и эта тройка не может разойтись с числом узлов.
 */
import type { Hardware, HardwareKit, Project } from '@/core/model/types';
import type { HardwareId } from '@/core/model/ids';

/** Комплекты проекта. Поле необязательное — старые проекты открываются (§108). */
export function projectKits(project: Project): HardwareKit[] {
  return (project.hardwareKits ?? []).filter((k) => !k.archived);
}

export function findKit(project: Project, id: string): HardwareKit | undefined {
  return (project.hardwareKits ?? []).find((k) => k.id === id);
}

/** Комплект, в который входит позиция (позиция может быть только в одном). */
export function kitOfHardware(project: Project, hardwareId: HardwareId): HardwareKit | undefined {
  return projectKits(project).find((k) => k.components.some((c) => String(c.hardwareId) === String(hardwareId)));
}

/** Строка раскрытого комплекта. */
export interface ExpandedComponent {
  hardwareId: HardwareId;
  name: string;
  article?: string;
  /** Сколько штук на ОДИН комплект. */
  perKit: number;
  /** Итого на все применения комплекта. */
  quantity: number;
}

/**
 * Раскрыть комплект на компоненты (§25/§54): комплект, применённый `kitCount`
 * раз, даёт `perKit × kitCount` каждого компонента.
 */
export function expandKit(
  kit: HardwareKit,
  kitCount: number,
  hardware: Hardware[],
): ExpandedComponent[] {
  const byId = new Map(hardware.map((h) => [String(h.id), h]));
  return kit.components.map((c) => {
    const item = byId.get(String(c.hardwareId));
    return {
      hardwareId: c.hardwareId,
      name: item?.name ?? 'Позиция не найдена',
      article: item?.article,
      perKit: c.quantity,
      quantity: c.quantity * kitCount,
    };
  });
}

/** Встроенный комплект минификса (§23) — из позиций, уже имеющихся в проекте. */
export function minifixKit(components: Array<{ hardwareId: HardwareId; quantity: number }>): HardwareKit {
  return { id: 'kit-minifix', name: 'Минификс (комплект)', article: 'MFX-KIT', components };
}
