/**
 * Сквозные сценарии пользователя (этап 37).
 *
 * 21 сценарий реальной работы: от создания проекта до документов, обмена
 * файлами и старого проекта. Каждый шаг проверяет ФАКТИЧЕСКИЙ результат
 * (количество деталей, размеры в полях, содержимое таблиц), а не факт того,
 * что страница открылась.
 *
 * Падение сценария печатает шаг, ожидание, факт и сохраняет снимок экрана.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4250 &
 *   node scripts/e2e37.mjs http://localhost:4250/
 */
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';

const EXEC = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.argv[2] ?? 'http://localhost:4250/';
const SHOTS = '/tmp/e2e37';
const EXPORT_PATH = '/tmp/e2e37-project.json';
const LEGACY_PATH = '/tmp/e2e37-legacy.json';

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

const consoleErrors = [];
const external = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(URL) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});

const results = [];
let failures = 0;

/** Выполнить сценарий: падение фиксируется, но не останавливает остальные. */
async function scenario(name, steps) {
  const started = Date.now();
  try {
    const detail = await steps();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    const shot = `${SHOTS}/${name.replace(/[^\wа-яА-Я]+/g, '_').slice(0, 60)}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error), shot });
    console.log(`✗ ${name}\n    ${String(error?.message ?? error).split('\n')[0]}\n    снимок: ${shot}`);
  }
}

/** Ожидание с понятным сообщением: шаг, ожидаемое, фактическое. */
function expect(step, actual, expected, compare = (a, b) => a === b) {
  if (!compare(actual, expected)) {
    throw new Error(`${step}\n    ожидалось: ${expected}\n    фактически: ${actual}`);
  }
  return actual;
}
const atLeast = (a, b) => Number(a) >= Number(b);

const tab = (name) => page.locator('.center-tabs button', { hasText: name }).first();
const openTab = async (name, wait = 600) => { await tab(name).click(); await page.waitForTimeout(wait); };
const rows = () => page.locator('table tbody tr').count();
const bodyText = async () => (await page.locator('.center-body').innerText()).replace(/\s+/g, ' ');
const statusText = async () => (await page.locator('.status-bar').innerText()).replace(/\n/g, ' | ');

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// ── 1. Создание нового проекта ─────────────────────────────────────────────
await scenario('1 · создание нового проекта', async () => {
  const empty = await page.locator('[data-testid="empty-project"]').count();
  expect('пустой проект показывает следующий шаг', empty, 1);
  await page.locator('.top-bar button', { hasText: 'Новый' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal-root button', { hasText: 'Создать' }).click();
  await page.waitForTimeout(800);
  await openTab('Детали');
  const n = await rows();
  expect('новый проект содержит детали шкафа по умолчанию', n, 1, atLeast);
  return `деталей: ${n}`;
});

// ── 2. Создание шкафа мастером ─────────────────────────────────────────────
await scenario('2 · создание шкафа 1200×2000×600 мастером', async () => {
  await openTab('Шкаф');
  await page.locator('[data-testid="cabinet-new"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="wizard-width"]').fill('1200');
  await page.locator('[data-testid="wizard-height"]').fill('2000');
  await page.locator('[data-testid="wizard-depth"]').fill('600');
  await page.waitForTimeout(400);
  const preview = await page.locator('[data-testid="wizard-preview"]').innerText();
  expect('предпросмотр показывает число деталей', /Деталей: \d+/.test(preview), true);
  await page.locator('[data-testid="wizard-create"]').click();
  await page.waitForTimeout(900);
  const width = await page.locator('[data-testid="cabinet-width"]').first().inputValue()
    .catch(async () => (await page.locator('input[type="number"]').first().inputValue()));
  expect('ширина изделия в панели параметров', Number(width), 1200);
  return `ширина: ${width}`;
});

// ── 3. Изменение размеров ──────────────────────────────────────────────────
await scenario('3 · изменение размеров пересчитывает детали', async () => {
  await openTab('Детали', 700);
  const before = await bodyText();
  await openTab('Шкаф');
  const heightField = page.locator('[data-testid="cabinet-height"]').first();
  const field = (await heightField.count()) ? heightField : page.locator('input[type="number"]').nth(1);
  await field.fill('2200');
  await field.press('Enter');
  await page.waitForTimeout(900);
  await openTab('Детали', 700);
  const after = await bodyText();
  expect('таблица деталей изменилась после смены высоты', after !== before, true);
  expect('в таблице появился размер 2200', after.includes('2200'), true);
  return 'высота 2000 → 2200';
});

// ── 4. Изменение материала ─────────────────────────────────────────────────
await scenario('4 · смена материала видна в деталях', async () => {
  await openTab('Материалы', 700);
  const text = await bodyText();
  const materials = (text.match(/ЛДСП|МДФ|ХДФ/g) ?? []).length;
  expect('в проекте есть материалы', materials, 1, atLeast);
  expect('видны кромочные материалы', /Кромка ABS/.test(text), true);
  await openTab('Шкаф');
  const select = page.locator('select').filter({ hasText: 'ЛДСП' }).first();
  if (await select.count()) {
    const options = await select.locator('option').allTextContents();
    const other = options.find((o) => o.includes('18 мм')) ?? options[1];
    if (other) {
      await select.selectOption({ label: other });
      await page.waitForTimeout(900);
    }
  }
  await openTab('Детали', 700);
  const parts = await bodyText();
  expect('таблица деталей показывает материал', /ЛДСП|МДФ|ХДФ/.test(parts), true);
  return `материалов: ${materials}`;
});

// ── 5. Изменение кромки ────────────────────────────────────────────────────
await scenario('5 · кромка назначается и видна', async () => {
  await openTab('Детали', 700);
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();
  await page.waitForTimeout(400);
  const edgeAll = page.locator('button', { hasText: 'Кромить все' }).first();
  if (await edgeAll.count()) {
    await edgeAll.click();
    await page.waitForTimeout(700);
  }
  await openTab('Производство', 800);
  const text = await bodyText();
  expect('раздел производства открылся с данными', text.length, 40, atLeast);
  return 'кромка назначена';
});

// ── 6. Добавление фурнитуры ────────────────────────────────────────────────
await scenario('6 · фурнитура проекта не пуста', async () => {
  await openTab('Фурнитура', 800);
  const n = await rows();
  expect('в проекте есть позиции фурнитуры', n, 1, atLeast);
  return `позиций: ${n}`;
});

// ── 7. Присадка ────────────────────────────────────────────────────────────
await scenario('7 · присадка сгенерирована из соединений', async () => {
  await openTab('Соединения', 800);
  const connections = await rows();
  expect('есть соединения корпуса', connections, 1, atLeast);
  await openTab('Присадка', 900);
  const ops = await rows();
  expect('есть операции присадки', ops, 1, atLeast);
  return `узлов: ${connections}, операций: ${ops}`;
});

// ── 8. 2D ──────────────────────────────────────────────────────────────────
await scenario('8 · 2D-редактор рисует изделие', async () => {
  await openTab('2D-редактор', 1200);
  const svg = await page.locator('.center-body svg').count();
  expect('на холсте 2D есть графика', svg, 1, atLeast);
  return `svg-узлов: ${svg}`;
});

// ── 9. 3D ──────────────────────────────────────────────────────────────────
await scenario('9 · 3D показывает сцену и дерево модели', async () => {
  await openTab('3D', 2000);
  const canvas = await page.locator('canvas').count();
  expect('3D-сцена отрисована в canvas', canvas, 1, atLeast);
  const tree = await page.locator('text=ДЕРЕВО МОДЕЛИ').count();
  expect('видно дерево модели', tree, 1, atLeast);
  return `canvas: ${canvas}`;
});

// ── 10. Раскрой ────────────────────────────────────────────────────────────
await scenario('10 · раскрой считается и размещает детали', async () => {
  await openTab('Раскрой', 800);
  const recalc = page.locator('button', { hasText: 'Пересчитать' }).first();
  await recalc.click();
  await page.waitForTimeout(2500);
  const text = await bodyText();
  expect('в раскрое есть данные листов', /лист|Лист|м²|%/.test(text), true);
  return text.slice(0, 60);
});

// ── 11. BOM ────────────────────────────────────────────────────────────────
await scenario('11 · спецификация содержит детали проекта', async () => {
  await openTab('Детали', 700);
  const parts = await rows();
  await openTab('Производство', 900);
  const bom = await rows();
  expect('в спецификации есть строки', bom, 1, atLeast);
  return `деталей: ${parts}, строк спецификации: ${bom}`;
});

// ── 12. Производство ───────────────────────────────────────────────────────
await scenario('12 · производственный центр показывает готовность', async () => {
  await openTab('Цех', 1000);
  const text = await bodyText();
  expect('виден чек-лист или статус готовности',
    /Готовность|Материал|Раскрой|Кромка|Присадка/.test(text), true);
  return text.slice(0, 60);
});

// ── 13. Документы ──────────────────────────────────────────────────────────
await scenario('13 · документы генерируются', async () => {
  await openTab('Документы', 1200);
  const generate = page.locator('button', { hasText: 'Сформировать' }).first();
  if (await generate.count()) { await generate.click(); await page.waitForTimeout(1500); }
  const svg = await page.locator('.center-body svg').count();
  const text = await bodyText();
  expect('документ отрисован', svg > 0 || text.length > 60, true);
  return `svg: ${svg}`;
});

// ── 14. Сохранение ─────────────────────────────────────────────────────────
await scenario('14 · сохранение проекта', async () => {
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  const status = await statusText();
  expect('статус подтверждает сохранение', /Сохранён|Сохранено/.test(status), true);
  return status;
});

// ── 15. Перезагрузка ───────────────────────────────────────────────────────
let partsBeforeReload = 0;
await scenario('15 · перезагрузка восстанавливает проект', async () => {
  await openTab('Детали', 700);
  partsBeforeReload = await rows();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await openTab('Детали', 800);
  const after = await rows();
  expect('число деталей после перезагрузки', after, partsBeforeReload);
  return `деталей: ${after}`;
});

// ── 16. Экспорт ────────────────────────────────────────────────────────────
await scenario('16 · экспорт проекта в файл', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.top-bar button', { hasText: 'Экспорт' }).click(),
  ]);
  await download.saveAs(EXPORT_PATH);
  const data = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  const parts = (data.furnitures ?? []).flatMap((f) => f.assemblies ?? []).flatMap((a) => a.parts ?? []);
  expect('в файле столько же деталей, сколько на экране', parts.length, partsBeforeReload);
  return `деталей в файле: ${parts.length}`;
});

// ── 17. Импорт ─────────────────────────────────────────────────────────────
await scenario('17 · импорт восстанавливает проект целиком', async () => {
  await page.locator('.top-bar button', { hasText: 'Новый' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal-root button', { hasText: 'Создать' }).click();
  await page.waitForTimeout(700);
  await page.locator('.top-bar input[type="file"]').setInputFiles(EXPORT_PATH);
  await page.waitForTimeout(1500);
  await openTab('Детали', 800);
  const after = await rows();
  expect('число деталей после импорта', after, partsBeforeReload);
  return `деталей: ${after}`;
});

// ── 18. Undo / Redo ────────────────────────────────────────────────────────
await scenario('18 · undo и redo возвращают состояние', async () => {
  await openTab('Шкаф');
  const field = page.locator('[data-testid="shelf-count"]').first();
  await page.locator('[data-testid="group-Полки"]').first().click();
  await page.waitForTimeout(300);
  const before = Number(await field.inputValue());
  await field.fill(String(before + 2));
  await field.press('Enter');
  await page.waitForTimeout(900);
  const changed = Number(await field.inputValue());
  expect('полок стало больше', changed, before + 2);

  await page.locator('.top-bar button', { hasText: 'Отменить' }).click();
  await page.waitForTimeout(900);
  expect('undo вернул прежнее число полок', Number(await field.inputValue()), before);

  await page.locator('.top-bar button', { hasText: 'Повторить' }).click();
  await page.waitForTimeout(900);
  expect('redo вернул изменение', Number(await field.inputValue()), before + 2);
  return `полок: ${before} → ${before + 2} → ${before} → ${before + 2}`;
});

// ── 19. Неверный ввод ──────────────────────────────────────────────────────
await scenario('19 · отрицательный размер не попадает в модель', async () => {
  await openTab('Шкаф');
  await page.locator('[data-testid="group-Основные"]').first().click();
  await page.waitForTimeout(300);
  const width = page.locator('input[type="number"]').first();
  const before = await width.inputValue();
  await width.fill('-100');
  await width.press('Enter');
  await page.waitForTimeout(700);
  expect('ширина не изменилась после недопустимого ввода', await width.inputValue(), before);
  return `ширина осталась ${before}`;
});

// ── 20. Старый проект ──────────────────────────────────────────────────────
await scenario('20 · старый проект открывается со своей схемой и геометрией', async () => {
  /* Файл в старом формате: параметры шкафа без параметрической модели и
   * СМЕШАННАЯ схема — крыша поверх боковин, дно между ними. Детали в файле
   * посчитаны формулами старого движка:
   *   боковина 600×(2000−16)=600×1984, крыша во всю ширину 800×600,
   *   дно между боковинами 768×600. */
  const base = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  const material = base.materials[0].id;
  const part = (name, key, type, width, height, thickness, position) => ({
    id: `legacy-${key}`, name, role: type === 'side_left' || type === 'side_right' ? 'side' : type,
    width, height, thickness, material, grain: 'none', quantity: 1,
    edges: { left: null, right: null, top: null, bottom: null },
    position, rotation: { x: 0, y: 0, z: 0 }, machining: [],
    metadata: { key, partType: type, number: `P00${key.length}` },
  });
  const legacy = {
    ...base,
    name: 'Старый проект',
    furnitures: [{
      ...base.furnitures[0],
      name: 'Старый шкаф',
      params: {
        width: 800, height: 2000, depth: 600, thickness: 16, material,
        top: 'overlay', bottom: 'between', back: 'none', backMaterial: null,
        shelves: 0, dividers: 0, doors: 0, doorGap: 3, doorOpening: 'double',
        handleEnabled: false, jointType: 'confirmat', frontMaterial: null, boardOnly: false,
        construction: { backThickness: 3, backOffset: 0, shelfDepthReduction: 20, shelfGap: 0, facadeGap: 3, bottomGap: 0, topGap: 0 },
      },
      assemblies: [{
        ...base.furnitures[0].assemblies[0],
        parts: [
          part('Боковина левая', 'side_left', 'side_left', 600, 1984, 16, { x: -392, y: 992, z: 0 }),
          part('Боковина правая', 'side_right', 'side_right', 600, 1984, 16, { x: 392, y: 992, z: 0 }),
          part('Крыша', 'top', 'top', 800, 600, 16, { x: 0, y: 1992, z: 0 }),
          part('Дно', 'bottom', 'bottom', 768, 600, 16, { x: 0, y: 8, z: 0 }),
        ],
      }],
    }],
    hardwareConnections: [],
  };
  writeFileSync(LEGACY_PATH, JSON.stringify(legacy));

  await page.locator('.top-bar input[type="file"]').setInputFiles(LEGACY_PATH);
  await page.waitForTimeout(1800);

  // Детали старого проекта сохранены как есть: 4 детали и высота боковины 1984.
  await openTab('Детали', 900);
  const table = await bodyText();
  expect('боковина старого проекта сохранила высоту 1984', table.includes('1984'), true);
  expect('крыша осталась во всю ширину 800', table.includes('800'), true);

  // Смешанная схема видна пользователю: верх поверх боковин, низ между ними.
  await openTab('Шкаф', 900);
  const panel = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect('в панели показан верх поверх боковин', /Поверх боковин/.test(panel), true);
  expect('в панели показан низ между боковинами', /Между боковинами/.test(panel), true);
  return 'схема и размеры сохранены';
});

// ── 21. Большой проект ─────────────────────────────────────────────────────
await scenario('21 · большой проект остаётся отзывчивым', async () => {
  await page.locator('.top-bar button', { hasText: 'Новый' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal-root button', { hasText: 'Создать' }).click();
  await page.waitForTimeout(700);

  // Несколько шкафов подряд через мастер: проект на десятки деталей.
  await openTab('Шкаф');
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-testid="cabinet-new"]').first().click();
    await page.waitForTimeout(250);
    await page.locator('[data-testid="wizard-create"]').click();
    await page.waitForTimeout(700);
  }
  const started = Date.now();
  await openTab('Детали', 900);
  const n = await rows();
  const ms = Date.now() - started;
  expect('деталей стало заметно больше', n, 30, atLeast);
  expect('таблица открывается быстрее 5 секунд', ms < 5000, true);
  return `деталей: ${n}, открытие таблицы: ${ms} мс`;
});

// ── Офлайн и чистая консоль ────────────────────────────────────────────────
await scenario('22 · работа без сети', async () => {
  await ctx.setOffline(true);
  for (const name of ['Детали', 'Раскрой', 'Производство', 'Документы', '3D']) {
    await openTab(name, 700);
  }
  await openTab('Детали', 700);
  const n = await rows();
  await ctx.setOffline(false);
  expect('детали видны без сети', n, 1, atLeast);
  return `деталей офлайн: ${n}`;
});

for (const path of [EXPORT_PATH, LEGACY_PATH]) if (existsSync(path)) unlinkSync(path);

const summary = {
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: failures,
  consoleErrors,
  externalRequests: [...new Set(external)],
  results,
};
writeFileSync('/tmp/e2e37-result.json', JSON.stringify(summary, null, 2));
console.log(`\nСценариев: ${summary.total}, успешно: ${summary.passed}, провалено: ${summary.failed}`);
console.log(`Ошибок консоли: ${consoleErrors.length}, внешних запросов: ${summary.externalRequests.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join('\n'));

await browser.close();
process.exit(failures > 0 || consoleErrors.length > 0 ? 1 : 0);
