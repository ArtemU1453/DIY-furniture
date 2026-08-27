/**
 * Пресеты раскроя (§82–§84) — именованные наборы технологических параметров.
 *
 * Пресет не хранит результат и не является вторым источником настроек: он
 * только записывает свои значения в существующий CuttingSettings.
 */
import type { CuttingPreset, CuttingSettings } from '@/core/model/types';

const TRIM_10 = { left: 10, right: 10, top: 10, bottom: 10 };

/** Встроенные пресеты (§83). Их нельзя удалить, только скопировать. */
export const BUILT_IN_PRESETS: CuttingPreset[] = [
  {
    id: 'preset-standard',
    name: 'Стандартный раскрой',
    description: 'Пропил 3.2 мм, обрезка 10 мм по кругу, текстура учитывается.',
    kerf: 3.2,
    minGap: 0,
    trim: { ...TRIM_10 },
    respectGrain: true,
    useRemnants: false,
    algorithm: 'maxrects',
    optimizationMode: 'BALANCED',
    builtIn: true,
  },
  {
    id: 'preset-economy',
    name: 'Экономия материала',
    description: 'Максимальное использование листа, остатки идут в работу.',
    kerf: 3.2,
    minGap: 0,
    trim: { ...TRIM_10 },
    respectGrain: true,
    useRemnants: true,
    algorithm: 'maxrects',
    optimizationMode: 'MAX_UTILIZATION',
    builtIn: true,
  },
  {
    id: 'preset-guillotine',
    name: 'Форматно-раскроечный станок',
    description: 'Сквозные резы, увеличенный зазор между деталями.',
    kerf: 4,
    minGap: 1,
    bladeWidth: 4,
    trim: { ...TRIM_10 },
    respectGrain: true,
    useRemnants: false,
    algorithm: 'guillotine',
    optimizationMode: 'BALANCED',
    builtIn: true,
  },
  {
    id: 'preset-fast',
    name: 'Быстрый расчёт',
    description: 'Один проход по крупным партиям — для предварительной оценки.',
    kerf: 3.2,
    minGap: 0,
    trim: { ...TRIM_10 },
    respectGrain: true,
    useRemnants: false,
    algorithm: 'skyline',
    optimizationMode: 'FAST',
    builtIn: true,
  },
];

/** Все пресеты: встроенные плюс пользовательские (§84). */
export function allPresets(settings: CuttingSettings): CuttingPreset[] {
  return [...BUILT_IN_PRESETS, ...(settings.presets ?? [])];
}

export function findPreset(settings: CuttingSettings, id: string): CuttingPreset | undefined {
  return allPresets(settings).find((p) => p.id === id);
}

/** Значения пресета, накладываемые на настройки раскроя (§82). */
export function presetPatch(preset: CuttingPreset): Partial<CuttingSettings> {
  return {
    kerfOverride: preset.kerf,
    minGap: preset.minGap,
    bladeWidth: preset.bladeWidth,
    trim: { ...preset.trim },
    respectGrain: preset.respectGrain,
    useRemnants: preset.useRemnants,
    algorithm: preset.algorithm,
    optimizationMode: preset.optimizationMode,
    activePresetId: preset.id,
  };
}

/** Применить пресет к настройкам (чистая функция, без мутации). */
export function applyPreset(settings: CuttingSettings, preset: CuttingPreset): CuttingSettings {
  return { ...settings, ...presetPatch(preset) };
}

/** Снять текущие настройки в пользовательский пресет (§84). */
export function presetFromSettings(settings: CuttingSettings, id: string, name: string): CuttingPreset {
  return {
    id,
    name,
    kerf: settings.kerfOverride ?? 3.2,
    minGap: settings.minGap ?? 0,
    bladeWidth: settings.bladeWidth,
    trim: { ...settings.trim },
    respectGrain: settings.respectGrain,
    useRemnants: settings.useRemnants,
    algorithm: settings.algorithm,
    optimizationMode: settings.optimizationMode,
  };
}

/** Совпадают ли настройки со значениями пресета (для подсветки в UI). */
export function matchesPreset(settings: CuttingSettings, preset: CuttingPreset): boolean {
  const t = settings.trim;
  return (
    (settings.kerfOverride ?? null) === preset.kerf &&
    (settings.minGap ?? 0) === preset.minGap &&
    t.left === preset.trim.left && t.right === preset.trim.right &&
    t.top === preset.trim.top && t.bottom === preset.trim.bottom &&
    settings.respectGrain === preset.respectGrain &&
    settings.useRemnants === preset.useRemnants &&
    settings.algorithm === preset.algorithm &&
    settings.optimizationMode === preset.optimizationMode
  );
}
