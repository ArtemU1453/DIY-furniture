/**
 * Поиск и фильтры по библиотеке (§33/§34).
 *
 * Поиск идёт по имени, категории, коду/артикулу и производителю; регистр и
 * лишние пробелы не мешают. Фильтры отделены от поиска, чтобы их можно было
 * комбинировать: категория + толщина + текстура + «только активные».
 */
import type { EdgeMaterial, Hardware, HardwareCategory, Material, MaterialCategory } from '@/core/model/types';
import { materialCategory, grainOptionOf, type GrainOption } from '@/core/library/types';
import { MATERIAL_CATEGORY_LABELS, HARDWARE_CATEGORY_LABELS } from '@/i18n/catalog';

const norm = (s: string): string => s.trim().toLowerCase();

/** Совпадает ли строка с запросом (пустой запрос совпадает со всем). */
function hit(value: string | undefined, q: string): boolean {
  return value != null && norm(value).includes(q);
}

export interface MaterialFilters {
  /** Свободный текст: имя, категория, код, производитель. */
  query?: string;
  category?: MaterialCategory | 'all';
  thickness?: number | 'all';
  grain?: GrainOption | 'all';
  /** Показывать ли архивные (§34: «Активные»). */
  includeArchived?: boolean;
}

export function searchMaterials(materials: Material[], filters: MaterialFilters = {}): Material[] {
  const q = norm(filters.query ?? '');
  return materials.filter((m) => {
    if (!filters.includeArchived && m.archived) return false;
    if (filters.category && filters.category !== 'all' && materialCategory(m) !== filters.category) return false;
    if (filters.thickness && filters.thickness !== 'all' && m.thickness !== filters.thickness) return false;
    if (filters.grain && filters.grain !== 'all' && grainOptionOf(m.grain) !== filters.grain) return false;
    if (!q) return true;
    return hit(m.name, q)
      || hit(MATERIAL_CATEGORY_LABELS[materialCategory(m)], q)
      || hit(materialCategory(m), q)
      || hit(String(m.thickness), q)
      || hit(m.metadata?.code as string | undefined, q)
      || hit(m.metadata?.manufacturer as string | undefined, q);
  });
}

/** Толщины, встречающиеся в наборе — для выпадающего фильтра. */
export function materialThicknesses(materials: Material[]): number[] {
  return [...new Set(materials.map((m) => m.thickness))].sort((a, b) => a - b);
}

export interface HardwareFilters {
  query?: string;
  category?: HardwareCategory | 'all';
  includeArchived?: boolean;
}

export function searchHardware(hardware: Hardware[], filters: HardwareFilters = {}): Hardware[] {
  const q = norm(filters.query ?? '');
  return hardware.filter((h) => {
    if (!filters.includeArchived && h.archived) return false;
    if (filters.category && filters.category !== 'all' && h.category !== filters.category) return false;
    if (!q) return true;
    return hit(h.name, q)
      || hit(HARDWARE_CATEGORY_LABELS[h.category], q)
      || hit(h.category, q)
      || hit(h.article, q)
      || hit(h.model, q)
      || hit(h.manufacturer, q);
  });
}

export interface EdgeFilters {
  query?: string;
  thickness?: number | 'all';
  includeArchived?: boolean;
}

export function searchEdges(edges: EdgeMaterial[], filters: EdgeFilters = {}): EdgeMaterial[] {
  const q = norm(filters.query ?? '');
  return edges.filter((e) => {
    if (!filters.includeArchived && e.archived) return false;
    if (filters.thickness && filters.thickness !== 'all' && e.thickness !== filters.thickness) return false;
    if (!q) return true;
    return hit(e.name, q) || hit(e.material, q) || hit(e.code, q) || hit(e.manufacturer, q)
      || hit(String(e.thickness), q);
  });
}
