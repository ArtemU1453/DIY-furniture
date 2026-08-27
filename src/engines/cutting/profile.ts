/**
 * Технологический профиль реза (§17/§18).
 *
 * Второй профиль НЕ заводится: это вычисленный вид поверх уже существующих
 * данных — Material.kerf, ProjectSettings.kerf и CuttingSettings. Приоритет
 * пропила: настройки раскроя → материал → настройки проекта. Ширина диска
 * (bladeWidth) не заменяет пропил, а поднимает его до себя: физически рез не
 * может быть уже диска.
 */
import type { CuttingProfile, Material, Mm, Project, SheetMaterial, TrimSettings } from '@/core/model/types';

/** Обрезка листа с учётом припуска формата (§4/§19). */
export function trimFor(settings: TrimSettings, sheet?: SheetMaterial): TrimSettings {
  const extra = sheet?.edgeAllowance ?? 0;
  if (extra <= 0) return { ...settings };
  return {
    left: settings.left + extra,
    right: settings.right + extra,
    top: settings.top + extra,
    bottom: settings.bottom + extra,
  };
}

/**
 * Разрешить профиль для материала. `sheet` — выбранный формат листа, его
 * припуск по краю добавляется к обрезке.
 */
export function resolveCuttingProfile(
  project: Project,
  material?: Material,
  sheet?: SheetMaterial,
): CuttingProfile {
  const s = project.cutting.settings;
  const baseKerf = s.kerfOverride ?? material?.kerf ?? project.settings.kerf;
  const blade = s.bladeWidth;
  return {
    // Рез не бывает уже пильного диска (§17).
    kerf: blade != null && blade > baseKerf ? blade : baseKerf,
    trimming: trimFor(s.trim, sheet),
    minGap: Math.max(0, s.minGap ?? 0),
    bladeWidth: blade,
  };
}

/**
 * Расстояние между телами соседних деталей (§38/§39): пропил плюс
 * технологический зазор. Именно это значение алгоритм резервирует вокруг
 * размещённой детали.
 */
export function spacingOf(profile: { kerf: Mm; minGap?: Mm }): Mm {
  return profile.kerf + Math.max(0, profile.minGap ?? 0);
}

/** Полезная область листа за вычетом обрезки (§20). */
export function usableArea(
  sheet: { length: Mm; width: Mm },
  trim: TrimSettings,
): { usableWidth: Mm; usableHeight: Mm; areaMm2: number } {
  const usableWidth = Math.max(0, sheet.length - trim.left - trim.right);
  const usableHeight = Math.max(0, sheet.width - trim.top - trim.bottom);
  return { usableWidth, usableHeight, areaMm2: usableWidth * usableHeight };
}

/** Сигнатура профиля для снимка плана (§94). */
export function profileSignature(profile: CuttingProfile): string {
  const t = profile.trimming;
  return [
    `kerf:${profile.kerf}`,
    `gap:${profile.minGap}`,
    `blade:${profile.bladeWidth ?? ''}`,
    `trim:${t.left},${t.right},${t.top},${t.bottom}`,
  ].join('|');
}
