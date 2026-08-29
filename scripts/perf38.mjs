import { chromium } from 'playwright-core';
import { launchOptions } from './browser.mjs';
const URL = process.argv[2];
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
const warnings = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); if (m.type()==='warning') warnings.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));

// Сырые байты: usedJSHeapSize округляется браузером, поэтому одинаковые
// мегабайты сами по себе ещё не доказывают отсутствие утечки.
const heap = async () => {
  await page.evaluate(() => { if (globalThis.gc) globalThis.gc(); });
  await page.waitForTimeout(400);
  return page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
};
const nodes = () => page.evaluate(() => document.getElementsByTagName('*').length);
const tab = (n) => page.locator('.center-tabs button', { hasText: n }).first();
const openTab = async (n, sel) => { const s = Date.now(); await tab(n).click(); if (sel) await page.waitForSelector(sel, { timeout: 20000 }).catch(()=>{}); else await page.waitForTimeout(150); return Date.now()-s; };

// initial load
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.center-tabs button');
const initialLoad = Date.now() - t0;
await page.waitForTimeout(1500);
const heapStart = await heap();
const nodesStart = await nodes();

// project load: большой проект через мастер
await page.locator('[data-testid="empty-project"] button', { hasText: 'Мастер шкафа' }).click();
await page.waitForTimeout(400);
const tCreate = Date.now();
for (let i = 0; i < 6; i++) {
  await page.locator('[data-testid="cabinet-new"]').first().click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="wizard-width"]').fill('2400');
  await page.locator('[data-testid="wizard-height"]').fill('2400');
  await page.locator('[data-testid="wizard-create"]').click();
  await page.waitForTimeout(600);
}
const projectBuild = Date.now() - tCreate;

const sections = {};
sections['2D'] = await openTab('2D-редактор', '.center-body svg');
sections['3D'] = await openTab('3D', 'canvas');
sections['Раскрой'] = await openTab('Раскрой');
sections['BOM (Производство)'] = await openTab('Производство', 'table');
sections['Цех'] = await openTab('Цех');
sections['Детали'] = await openTab('Детали', 'table');
const partRows = await page.locator('table tbody tr').count();

// Documents generation
await tab('Документы').click();
await page.waitForTimeout(600);
const gen = page.locator('button', { hasText: 'Сформировать' }).first();
let documentsMs = 0;
if (await gen.count()) { const s = Date.now(); await gen.click(); await page.waitForTimeout(200); await page.waitForSelector('.center-body svg', { timeout: 30000 }).catch(()=>{}); documentsMs = Date.now()-s; }

// Память при переключении разделов. Сравниваются одинаковые состояния:
// вкладка «Детали» на том же проекте в начале и после пяти полных циклов.
await tab('Детали').click(); await page.waitForTimeout(400);
const nodesDetailsFirst = await nodes();
for (let i = 0; i < 5; i++) {
  for (const n of ['3D', 'Раскрой', 'Документы', 'Производство', 'Детали']) { await tab(n).click(); await page.waitForTimeout(250); }
}
await tab('Детали').click(); await page.waitForTimeout(400);
const nodesDetailsAfterCycles = await nodes();
const heapAfterSwitching = await heap();
const nodesAfterSwitching = await nodes();

// Закрытие/повторное открытие проектов
for (let i = 0; i < 3; i++) {
  await page.locator('.top-bar button', { hasText: 'Новый' }).click();
  await page.waitForTimeout(250);
  await page.locator('.modal-root button', { hasText: 'Создать' }).click();
  await page.waitForTimeout(600);
}
const heapAfterProjects = await heap();
const nodesAfterProjects = await nodes();

console.log(JSON.stringify({ initialLoadMs: initialLoad, projectBuildMs: projectBuild, partRows, sections, documentsMs,
  heapStartBytes: heapStart, heapAfterSwitchingBytes: heapAfterSwitching, heapAfterProjectsBytes: heapAfterProjects,
  nodesStart, nodesAfterSwitching, nodesAfterProjects, nodesDetailsFirst, nodesDetailsAfterCycles,
  errors, warnings: warnings.slice(0,5) }, null, 1));
await browser.close();
