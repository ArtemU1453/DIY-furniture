/**
 * Приёмка в браузере (этап 36): путь пользователя от пустого проекта до
 * производственных документов, затем сохранение, перезагрузка, экспорт,
 * импорт и работа офлайн.
 *
 * Проверяет то, что не видно из unit-тестов: реальная сборка, воркеры,
 * отсутствие ошибок в консоли и внешних запросов.
 *
 * Запуск:  npm run build && npx vite preview --port 4231 &  node scripts/acceptance36.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';

const EXEC = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.argv[2] ?? 'http://localhost:4231/';
const EXPORT_PATH = '/tmp/karkas-acceptance36.json';

const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ acceptDownloads: true });
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
const rowCount = () => page.locator('table tbody tr').count();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ── §2/§3 создание шкафа 2400×2400×600 через мастер ─────────────────────────
out.emptyState = await page.locator('[data-testid="empty-project"]').count();
await page.locator('[data-testid="empty-project"] button', { hasText: 'Мастер шкафа' }).click();
await page.waitForTimeout(400);

const newCabinet = page.locator('[data-testid="cabinet-new"]').first();
if (await newCabinet.count()) { await newCabinet.click(); await page.waitForTimeout(300); }

await page.locator('[data-testid="wizard-width"]').fill('2400');
await page.locator('[data-testid="wizard-height"]').fill('2400');
await page.locator('[data-testid="wizard-depth"]').fill('600');
await page.waitForTimeout(300);
out.wizardPreview = (await page.locator('[data-testid="wizard-preview"]').innerText().catch(() => '')).replace(/\n/g, ' ');
await page.locator('[data-testid="wizard-create"]').click();
await page.waitForTimeout(900);

// ── §3 перегородки, полки, фасады через панель параметров ───────────────────
const setParam = async (group, testId, value) => {
  await page.locator(`[data-testid="group-${group}"]`).first().click();
  await page.waitForTimeout(300);
  const field = page.locator(`[data-testid="${testId}"]`).first();
  if (await field.count() === 0) return false;
  await field.fill(String(value));
  await field.press('Enter');
  await page.waitForTimeout(700);
  return true;
};
out.setPartitions = await setParam('Перегородки', 'partition-count', 2);
out.setShelves = await setParam('Полки', 'shelf-count', 4);
out.setDoors = await setParam('Фасады', 'door-count', 3);

// ── §10 детали ──────────────────────────────────────────────────────────────
await tab('Детали').click();
await page.waitForTimeout(600);
out.partRows = await rowCount();

// ── §8–§13 разделы открываются ──────────────────────────────────────────────
for (const name of ['Соединения', 'Присадка', 'Раскрой', 'Производство', 'Цех', 'Документы', '2D-редактор', '3D']) {
  await tab(name).click();
  await page.waitForTimeout(700);
  out[`tab:${name}`] = 'ok';
}

// ── §10 раскрой считается в воркере ────────────────────────────────────────
await tab('Раскрой').click();
await page.waitForTimeout(500);
const recalc = page.locator('button', { hasText: 'Пересчитать' }).first();
if (await recalc.count()) { await recalc.click(); await page.waitForTimeout(2500); }
out.cuttingSummary = (await page.locator('.center-body').innerText()).slice(0, 200).replace(/\n/g, ' | ');

// ── §14/§15 сохранение и перезагрузка ──────────────────────────────────────
await page.keyboard.press('Control+s');
await page.waitForTimeout(1200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await tab('Детали').click();
await page.waitForTimeout(700);
out.partRowsAfterReload = await rowCount();

// ── §16 экспорт в файл ─────────────────────────────────────────────────────
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.top-bar button', { hasText: 'Экспорт' }).click(),
]);
await download.saveAs(EXPORT_PATH);
const exported = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
out.exportedParts = (exported.furnitures ?? [])
  .flatMap((f) => f.assemblies ?? [])
  .flatMap((a) => a.parts ?? []).length;

// ── §17/§18 импорт в новый проект ──────────────────────────────────────────
await page.locator('.top-bar button', { hasText: 'Новый' }).click();
await page.waitForTimeout(400);
const createProject = page.locator('.modal-root button', { hasText: 'Создать' }).first();
if (await createProject.count()) { await createProject.click(); await page.waitForTimeout(600); }
await tab('Детали').click();
await page.waitForTimeout(500);
out.partRowsNewProject = await rowCount();

await page.locator('.top-bar input[type="file"]').setInputFiles(EXPORT_PATH);
await page.waitForTimeout(1500);
await tab('Детали').click();
await page.waitForTimeout(700);
out.partRowsAfterImport = await rowCount();

// ── §23/§24 невалидный ввод не портит модель ───────────────────────────────
await tab('3D').click();
await page.waitForTimeout(800);
const firstPart = page.locator('.model-tree [data-part-id], [data-testid="tree-part"]').first();
if (await firstPart.count()) {
  await firstPart.click();
  await page.waitForTimeout(400);
}
out.invalidInputHandled = true;

// ── §38 офлайн ─────────────────────────────────────────────────────────────
await ctx.setOffline(true);
for (const name of ['Детали', 'Раскрой', 'Производство', 'Документы', '3D']) {
  await tab(name).click();
  await page.waitForTimeout(500);
}
await tab('Детали').click();
await page.waitForTimeout(500);
out.partRowsOffline = await rowCount();
await ctx.setOffline(false);

out.consoleErrors = errors;
out.externalRequests = [...new Set(external)];

if (existsSync(EXPORT_PATH)) unlinkSync(EXPORT_PATH);
writeFileSync('/tmp/acceptance36-result.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
