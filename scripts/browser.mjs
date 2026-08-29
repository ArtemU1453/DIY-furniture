/**
 * Где взять браузер для сквозных сценариев.
 *
 * Скрипты запускаются в двух местах, и браузер в них лежит по-разному:
 *   - у разработчика — в готовой сборке Playwright (переменная
 *     PLAYWRIGHT_BROWSERS_PATH, ревизия может не совпасть с ожидаемой,
 *     поэтому путь задаётся явно);
 *   - в CI — тем, что ставит `npx playwright-core install --only-shell
 *     chromium`; там Playwright находит браузер сам.
 *
 * Порядок: явный CHROMIUM_PATH → локальная сборка, если она есть → пусть
 * ищет Playwright. Скрипты из-за этого не раздваиваются: сценарии одни и те
 * же, различается только источник браузера.
 */
import { existsSync } from 'node:fs';

const LOCAL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

export function launchOptions() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return { executablePath: explicit };
  if (existsSync(LOCAL)) return { executablePath: LOCAL };
  return {};
}
