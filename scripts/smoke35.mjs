/**
 * Сквозная проверка приложения в браузере (этап 35).
 *
 * Проходит РЕАЛЬНЫЙ путь пользователя: пустой проект → мастер шкафа → детали →
 * соединения → присадка → раскрой → производство → документы, затем
 * перезагрузка (восстановление автосохранения) и работа офлайн. Проверяет
 * отсутствие ошибок в консоли и внешних сетевых запросов.
 *
 * Запуск:  npm run build && npx vite preview --port 4227 &  node scripts/smoke35.mjs
 */
import { chromium } from 'playwright-core';
import { launchOptions } from './browser.mjs';

const URL = process.argv[2] ?? 'http://localhost:4227/';

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
const external = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(URL) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});

const out = {};
const tab = (name) => page.locator('.center-tabs button', { hasText: name }).first();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1. Пустой проект: понятный следующий шаг.
out.emptyState = await page.locator('[data-testid="empty-project"]').count();

// 2. Создание шкафа мастером (единый генератор).
await page.locator('[data-testid="empty-project"] button', { hasText: 'Мастер шкафа' }).click();
await page.waitForTimeout(500);
const createBtn = page.locator('button').filter({ hasText: /^Создать/ }).first();
out.wizardCreateButton = await createBtn.count();
await createBtn.click();
await page.waitForTimeout(800);

// 3. Детали посчитаны.
await tab('Детали').click();
await page.waitForTimeout(500);
out.partRows = await page.locator('table tbody tr').count();

// 4. Сквозной путь по разделам.
for (const name of ['Соединения', 'Присадка', 'Раскрой', 'Производство', 'Документы', '3D']) {
  await tab(name).click();
  await page.waitForTimeout(600);
  out[`tab:${name}`] = 'ok';
}

// 5. Раскрой считается.
await tab('Раскрой').click();
await page.waitForTimeout(400);
const recalc = page.locator('button', { hasText: 'Пересчитать' }).first();
if (await recalc.count()) { await recalc.click(); await page.waitForTimeout(1200); }
out.cuttingText = (await page.locator('.center-body').innerText()).slice(0, 120).replace(/\n/g, ' | ');

// 6. Автосохранение и перезагрузка: проект должен вернуться.
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await tab('Детали').click();
await page.waitForTimeout(600);
out.partRowsAfterReload = await page.locator('table tbody tr').count();

// 7. Офлайн: приложение локальное.
await ctx.setOffline(true);
await tab('3D').click();
await page.waitForTimeout(500);
await tab('Детали').click();
await page.waitForTimeout(500);
out.partRowsOffline = await page.locator('table tbody tr').count();
await ctx.setOffline(false);

out.consoleErrors = errors;
out.externalRequests = [...new Set(external)];
console.log(JSON.stringify(out, null, 2));
await browser.close();
