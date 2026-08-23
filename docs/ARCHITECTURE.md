# Архитектура онлайн-конструктора корпусной мебели

> **Статус документа:** проект архитектуры (этап проектирования).
> **Реализация ещё не начата** — это техническое задание и план.
> Документ описывает систему целиком, но код по нему будет писаться поэтапно
> (см. раздел **K. План разработки**) только после подтверждения.

Рабочее название проекта: **Karkas** (условно, можно поменять).

---

## Оглавление

- [Главный принцип](#главный-принцип)
- [A. Архитектура системы](#a-архитектура-системы)
- [B. Технологический стек](#b-технологический-стек)
- [C. Структура проекта](#c-структура-проекта)
- [D. Модель данных](#d-модель-данных)
- [E. Архитектура 3D](#e-архитектура-3d)
- [F. Архитектура расчёта мебели (параметрика)](#f-архитектура-расчёта-мебели-параметрика)
- [G. Архитектура раскроя (CuttingEngine)](#g-архитектура-раскроя-cuttingengine)
- [H. Архитектура присадки (machining)](#h-архитектура-присадки-machining)
- [I. Архитектура чертежей (2D)](#i-архитектура-чертежей-2d)
- [J. Формат проекта (JSON)](#j-формат-проекта-json)
- [K. План разработки](#k-план-разработки)
- [L. MVP](#l-mvp)
- [Приложение: тестирование](#приложение-тестирование)

---

## Главный принцип

Мы строим **производственный параметрический конструктор**, а не декоративную
3D-сцену. Есть **одна модель проекта** — источник истины. Все представления
(3D, спецификация, раскрой, чертежи, присадка, документация) — это **проекции**
одной и той же модели.

```
             ┌────────────────────────────────────┐
             │        МОДЕЛЬ ПРОЕКТА (JSON)         │  ← единственный источник истины
             │  Project → Products → Parts → ...    │
             └────────────────┬───────────────────┘
                              │  derive (чистые функции)
      ┌───────────┬───────────┼───────────┬───────────┬───────────┐
      ▼           ▼           ▼           ▼           ▼           ▼
    3D-сцена   Спецификация  Раскрой   Чертежи 2D   Присадка   Документы
   (проекция)  (проекция)  (проекция)  (проекция)  (проекция)  (PDF/CSV/…)
```

Ключевое свойство: **изменение параметра верхнего уровня пересчитывает всё
зависимое**. Меняем ширину шкафа 800 → 900 — параметрический решатель заново
порождает детали, а все проекции (3D, раскрой, спецификация, чертежи)
перестраиваются из новых деталей. Пользователь не редактирует детали и раскрой
вручную «в рассинхроне» — они выводятся.

Три уровня данных, которые нельзя смешивать:

1. **Параметры изделия** (что задаёт пользователь): тип, габариты, число полок,
   тип фасадов, зазоры, тип соединений.
2. **Производственная модель** (что порождает решатель): плоский список `Part`
   с точными размерами, кромкой, присадкой, позицией в сборке.
3. **Проекции** (что видит пользователь): 3D, таблицы, карты, чертежи —
   вычисляются, **не хранятся** (кроме кэша).

---

## A. Архитектура системы

### Слои (строго сверху вниз, зависимости только вниз)

```
┌──────────────────────────────────────────────────────────────────┐
│  UI LAYER  (React + R3F)                                           │
│  Панели, тулбары, 3D-viewport, таблицы, инспектор свойств,         │
│  просмотрщики раскроя/чертежей. Никакой бизнес-логики.             │
├──────────────────────────────────────────────────────────────────┤
│  STATE / APPLICATION LAYER  (Zustand stores + команды)            │
│  Хранит модель проекта, историю (undo/redo), выбор, настройки.    │
│  Команды (Command) — единственный способ мутации модели.          │
├──────────────────────────────────────────────────────────────────┤
│  DOMAIN LAYER  (чистый TypeScript, без React/Three)               │
│  ├─ model/        — типы и инварианты модели                      │
│  ├─ parametric/   — решатель: параметры → Part[]                  │
│  ├─ geometry/     — 2D/3D-геометрия детали (чистая)               │
│  ├─ machining/    — операции присадки                             │
│  ├─ nesting/      — CuttingEngine (раскрой)                       │
│  ├─ bom/          — спецификация, ведомости, масса                │
│  ├─ drawing/      — построение видов и размеров (данные чертежа)  │
│  └─ validation/   — проверки конструкции                          │
├──────────────────────────────────────────────────────────────────┤
│  INFRA LAYER                                                      │
│  ├─ persistence/  — IndexedDB, автобэкап, история версий          │
│  ├─ serialization/— JSON schema, миграции версий формата          │
│  ├─ export/       — PDF, CSV, SVG, DXF, JSON                      │
│  ├─ workers/      — обёртки Web Worker (nesting, export)          │
│  └─ catalog/      — встроенные каталоги материалов/фурнитуры      │
└──────────────────────────────────────────────────────────────────┘
```

**Правило зависимостей:** `domain/` **не импортирует** ничего из React,
Three.js, Zustand или DOM. Это гарантирует тестируемость чистых функций и
возможность запускать их в Web Worker. UI импортирует domain, но не наоборот.

### Поток данных (однонаправленный)

```
Пользователь
   │  (действие в UI)
   ▼
Command  ──►  мутирует Project (черновик через Immer)
   │
   ▼
Reactive derive (мемоизированные селекторы / реактивные вычисления)
   │
   ├─► parametric.solve(product) ──► Part[]        (пересчёт деталей)
   ├─► bom.build(parts)          ──► Спецификация
   ├─► nesting.run(parts) [worker]──► Карты раскроя
   ├─► drawing.build(...)        ──► Данные чертежей
   └─► scene3d.build(parts)      ──► 3D-объекты
   │
   ▼
UI перерисовывается из производных данных
```

### Ключевые архитектурные решения

| Решение | Обоснование |
|---|---|
| **Единая модель + проекции** | Гарантирует синхронность 3D / раскроя / документов. Нельзя рассинхронизировать то, что вычисляется из одного источника. |
| **Команды + история** | Undo/redo, автобэкап, воспроизводимость. Любая мутация — команда с `apply`/`invert`. |
| **Чистый domain-слой** | Тестируемость, запуск в Worker, отсутствие привязки к фреймворку. |
| **Пересчёт через мемоизацию** | Меняется только затронутое. Дёшево при 1000+ деталях. |
| **Плагинные реестры** | Типы изделий, типы присадки, алгоритмы раскроя, экспортёры — регистрируются, а не «зашиты». Расширение без переписывания ядра. |
| **Worker для тяжёлого** | Раскрой и генерация PDF не блокируют UI. |

### Реестры (расширяемость без переписывания ядра)

Ядро не знает о конкретных типах мебели или операциях присадки — оно знает про
**реестры**:

- `ProductTypeRegistry` — генераторы изделий (шкаф, тумба, стол…). Каждый —
  функция `params → Part[]`.
- `MachiningOpRegistry` — типы операций присадки (конфирмат, петля, паз…).
  Каждый описывает, как отрисовать, экспортировать и учесть в присадке.
- `CuttingEngineRegistry` — алгоритмы раскроя (guillotine, maxrects…).
- `ExporterRegistry` — форматы вывода (PDF, DXF, CSV…).
- `HardwareRegistry` / `MaterialCatalog` — каталоги (расширяемые, редактируемые).

---

## B. Технологический стек

Стек **web-first**, полностью бесплатный, работает в браузере, готов стать PWA.
Предложенный в задании стек в основе правильный; ниже — конкретный выбор и
обоснования, включая пару уточнений.

| Область | Выбор | Обоснование |
|---|---|---|
| Язык | **TypeScript** (strict) | Строгая типизация модели — критично для производственной точности. Единый язык domain/UI/worker. |
| UI-фреймворк | **React 18** | Экосистема, R3F, привычность. Конкурентный рендер помогает при больших сценах. |
| Сборка | **Vite** | Быстрый dev-сервер, простая настройка Web Worker и PWA, ESM. |
| 3D | **Three.js + React Three Fiber + drei** | R3F даёт декларативную сцену в React; Three.js — зрелый бесплатный движок. |
| Состояние | **Zustand + Immer** | Лёгкий, вне React-дерева (можно читать в командах/воркерах), Immer даёт иммутабельные черновики для undo/redo. |
| 2D-чертежи | **SVG** (генерация из данных) + **Canvas** только для превью раскроя больших листов | SVG — векторный, легко экспортируется в PDF/DXF, масштабируется, инспектируется. Canvas — для производительности при сотнях деталей на листе. |
| Тяжёлые расчёты | **Web Workers** (через Comlink) | Раскрой, экспорт PDF/DXF — вне главного потока. Comlink убирает ручной месседжинг. |
| Локальное хранилище | **IndexedDB** (через `idb`) | Большие проекты, бинарные текстуры, история версий. localStorage не годится по объёму. |
| Формат проекта | **JSON** (+ zod-схема, версия, миграции) | Переносимость, независимость от фреймворка, человекочитаемость. |
| Валидация формата | **Zod** | Рантайм-валидация импортируемых JSON + вывод TS-типов из схемы. |
| PDF | **pdf-lib** или **jsPDF** (обе MIT, клиентские) | Генерация PDF в браузере без сервера и без платных лицензий. Финальный выбор — на этапе экспорта (см. риски). |
| DXF | **собственный писатель DXF** (ASCII R12) | DXF R12 — простой текстовый формат; свой мини-писатель избегает тяжёлых/платных зависимостей и даёт контроль. |
| CSV | собственный сериализатор | Тривиально, без зависимостей. |
| Тесты | **Vitest** (юнит) + **Playwright** (e2e) | Vitest интегрирован с Vite; domain-слой покрывается юнитами, критичные сценарии — e2e. |
| Линт/формат | **ESLint + Prettier** | Стандарт. |
| PWA | **vite-plugin-pwa** (Workbox) | Offline-first после первой загрузки. |
| ID | **nanoid** | Короткие устойчивые id для деталей/операций. |

**Уточнения относительно предложенного стека:**

1. **Immer** добавлен к Zustand — без него аккуратный undo/redo и
   иммутабельность модели писать вручную дорого.
2. **Zod** добавлен для валидации импортируемого JSON — производственный формат
   должен отвергать битые файлы, а не падать.
3. **Comlink** — тонкая обёртка над Worker, чтобы domain-функции вызывались как
   обычные async-функции. Опционально, но сильно упрощает код.
4. **SVG как основа 2D**, Canvas — точечно для тяжёлых карт раскроя. Причина:
   чертежи нужно экспортировать (SVG→PDF/DXF тривиально), а Canvas — растровый.

**Чего избегаем:** любых коммерческих/закрытых библиотек (например, платных
CAD-ядер, платных PDF SDK, платных nesting-сервисов). Всё перечисленное — MIT/
Apache/BSD и работает офлайн в браузере.

---

## C. Структура проекта

Монорепо не требуется; один Vite-пакет с чётким разделением слоёв. Domain-код
физически отделён от UI и не зависит от него.

```
karkas/
├─ index.html
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
├─ public/
│  ├─ manifest.webmanifest
│  └─ textures/                 # встроенные бесшовные текстуры (ЛДСП и т.п.)
├─ docs/
│  ├─ ARCHITECTURE.md           # этот документ
│  └─ decisions/                # ADR — записи принятых решений
└─ src/
   ├─ main.tsx                  # точка входа React
   ├─ app/
   │  ├─ App.tsx                # каркас интерфейса (layout)
   │  ├─ layout/                # панели, доки, тулбары
   │  └─ routes.tsx             # (на будущее) роутинг режимов
   │
   ├─ domain/                   # ⚠️ чистый TS, без React/Three
   │  ├─ model/
   │  │  ├─ types.ts            # Project, Product, Part, Material...
   │  │  ├─ ids.ts              # брендированные id-типы
   │  │  ├─ units.ts            # единицы, мм, округления
   │  │  ├─ invariants.ts       # инварианты модели
   │  │  └─ defaults.ts         # значения по умолчанию
   │  ├─ parametric/
   │  │  ├─ ProductTypeRegistry.ts
   │  │  ├─ solve.ts            # solveProduct(product) -> Part[]
   │  │  ├─ generators/         # генераторы изделий
   │  │  │  ├─ cabinet.ts       # шкаф/тумба/пенал (базовый корпус)
   │  │  │  ├─ shelf.ts         # стеллаж
   │  │  │  ├─ table.ts         # стол
   │  │  │  └─ custom.ts        # произвольное изделие
   │  │  ├─ features/           # модификаторы: полки, фасады, ящики, задняя стенка
   │  │  └─ constraints.ts      # зазоры, накладной/вкладной фасад и т.п.
   │  ├─ geometry/
   │  │  ├─ box.ts              # габаритный бокс детали
   │  │  ├─ transform.ts        # позиция/поворот, матрицы
   │  │  └─ outline2d.ts        # контур детали для 2D/раскроя
   │  ├─ machining/
   │  │  ├─ MachiningOpRegistry.ts
   │  │  ├─ ops/                # confirmat, dowel, hinge, minifix, groove...
   │  │  └─ resolve.ts          # присадка соединений между деталями
   │  ├─ nesting/
   │  │  ├─ CuttingEngine.ts    # интерфейс
   │  │  ├─ engines/
   │  │  │  ├─ guillotine.ts
   │  │  │  └─ maxrects.ts
   │  │  ├─ group.ts            # группировка по материалу/текстуре
   │  │  └─ types.ts            # CuttingInput/Result/Placement
   │  ├─ bom/
   │  │  ├─ specification.ts    # спецификация деталей
   │  │  ├─ edgeband.ts         # ведомость кромки (пог. м)
   │  │  ├─ hardware.ts         # ведомость фурнитуры
   │  │  ├─ materials.ts        # ведомость материалов (площади, листы)
   │  │  └─ mass.ts             # масса деталей/изделия
   │  ├─ drawing/
   │  │  ├─ views.ts            # проекции: спереди/сбоку/сверху
   │  │  ├─ dimensions.ts       # авторазмеры
   │  │  ├─ partDrawing.ts      # чертёж отдельной детали + присадка
   │  │  └─ scene2d.ts          # абстрактная 2D-сцена (примитивы)
   │  ├─ validation/
   │  │  └─ checks.ts           # коллизии, недопустимые размеры, кромка > толщины
   │  └─ index.ts               # публичный API domain-слоя
   │
   ├─ state/                    # приложение: Zustand + команды
   │  ├─ store.ts               # корневой стор
   │  ├─ projectSlice.ts        # модель проекта
   │  ├─ selectionSlice.ts      # выбор, hover
   │  ├─ settingsSlice.ts       # единицы, тема, язык
   │  ├─ derived/               # мемоизированные селекторы проекций
   │  │  ├─ useParts.ts
   │  │  ├─ useBom.ts
   │  │  └─ useNesting.ts
   │  └─ commands/
   │     ├─ Command.ts          # интерфейс команды
   │     ├─ history.ts          # undo/redo стек
   │     └─ ops/                # конкретные команды (изменить размер, добавить полку…)
   │
   ├─ infra/
   │  ├─ persistence/
   │  │  ├─ db.ts               # IndexedDB (idb)
   │  │  ├─ autosave.ts         # автобэкап
   │  │  └─ versions.ts         # локальная история версий
   │  ├─ serialization/
   │  │  ├─ schema.ts           # zod-схемы формата
   │  │  ├─ migrate.ts          # миграции версий формата
   │  │  └─ projectFile.ts      # save/load/import/export JSON
   │  ├─ export/
   │  │  ├─ ExporterRegistry.ts
   │  │  ├─ pdf/                # спецификация, раскрой, чертежи в PDF
   │  │  ├─ dxf/                # писатель DXF R12
   │  │  ├─ csv/
   │  │  └─ svg/
   │  ├─ workers/
   │  │  ├─ nesting.worker.ts
   │  │  ├─ export.worker.ts
   │  │  └─ client.ts           # Comlink-обёртки
   │  └─ catalog/
   │     ├─ materials.ts        # встроенные материалы (ЛДСП 16/18/22, МДФ…)
   │     └─ hardware.ts         # встроенная фурнитура
   │
   ├─ ui/                       # переиспользуемые UI-компоненты (тупые)
   │  ├─ viewport3d/            # R3F-сцена
   │  │  ├─ Viewport.tsx
   │  │  ├─ PartMesh.tsx
   │  │  ├─ Materials3D.ts      # маппинг material→three material
   │  │  └─ controls/           # орбита, гизмо, выделение
   │  ├─ panels/
   │  │  ├─ LibraryPanel.tsx
   │  │  ├─ PropertiesPanel.tsx
   │  │  ├─ PartsTable.tsx
   │  │  └─ StatusBar.tsx
   │  ├─ nesting/NestingView.tsx
   │  ├─ drawing/DrawingView.tsx
   │  └─ common/                # кнопки, поля, таблицы, модалки
   │
   └─ test/
      ├─ fixtures/              # эталонные проекты
      └─ setup.ts
```

**Правило:** файл `domain/**` не должен содержать `import ... from 'react' | 'three' | 'zustand'`. Проверяется ESLint-правилом (`no-restricted-imports`) и в CI.

---

## D. Модель данных

Основные типы. Модель спроектирована как **переносимая** (сериализуется в JSON
без потерь) и **расширяемая** (везде есть `metadata` и/или `params`-словари).

### Идентификаторы и базовые типы

```ts
// Брендированные id — нельзя перепутать PartId с MaterialId
type Id<Brand extends string> = string & { readonly __brand: Brand };
type ProjectId  = Id<'Project'>;
type ProductId  = Id<'Product'>;
type PartId     = Id<'Part'>;
type MaterialId = Id<'Material'>;
type EdgeId     = Id<'Edge'>;
type HardwareId = Id<'Hardware'>;
type OpId       = Id<'MachiningOp'>;

/** Все линейные размеры — в миллиметрах (единица хранения). */
type Mm = number;

type Vec3 = { x: Mm; y: Mm; z: Mm };
/** Поворот детали — кратно 90° в производственной модели (ортогональная сборка). */
type Rotation = { x: number; y: number; z: number }; // градусы

type GrainDirection = 'length' | 'width' | 'none';
type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back';
```

### Проект (корень)

```ts
interface Project {
  version: string;                 // версия формата, напр. "1.0"
  id: ProjectId;
  meta: {
    name: string;
    createdAt: string;             // ISO
    updatedAt: string;
    author?: string;
    notes?: string;
  };
  settings: ProjectSettings;
  materials: Material[];
  edges: EdgeMaterial[];           // типы кромки
  hardware: HardwareItem[];        // фурнитура (каталог проекта)
  products: Product[];             // изделия в проекте
  // parts НЕ хранятся: выводятся из products решателем.
  // Для «произвольных» деталей вне генератора см. Product.customParts.
}

interface ProjectSettings {
  units: 'mm';                     // хранение всегда мм; отображение — настройка
  displayUnits: 'mm' | 'cm' | 'in';
  kerf: Mm;                        // ширина пропила по умолчанию
  defaultBoardMaterial: MaterialId;
  sheetTrim: Mm;                   // обрезка листа с краёв по умолчанию
  costEnabled: boolean;            // включён ли учёт стоимости (опция)
  locale: string;
}
```

### Изделие → Корпус → Параметры

```ts
interface Product {
  id: ProductId;
  name: string;
  type: string;                    // ключ в ProductTypeRegistry: 'cabinet' | 'shelf' | 'table' | 'custom' | ...
  transform: { position: Vec3; rotation: Rotation }; // размещение изделия в сцене
  params: ProductParams;           // параметры конкретного типа (валидируются генератором)
  overrides?: PartOverride[];      // точечные ручные правки сгенерированных деталей
  customParts?: Part[];            // произвольные детали, добавленные вручную
  metadata?: Record<string, unknown>;
}

/**
 * Параметры зависят от типа изделия. Базовые поля общие для корпусной мебели;
 * генератор конкретного типа знает свой набор.
 */
interface ProductParams {
  width: Mm;
  height: Mm;
  depth: Mm;
  bodyMaterial: MaterialId;        // материал корпуса по умолчанию
  backMaterial?: MaterialId;       // материал задней стенки (ДВП/ЛДСП)
  panelThickness: Mm;              // толщина корпусных плит
  jointType: JointType;            // тип соединения корпуса
  // тип-специфичные поля — в extras (валидируются схемой генератора)
  extras?: Record<string, number | string | boolean>;
  // примеры extras: shelves, backInset, facadeType, gapTop, gapBetween,
  // drawersCount, legsHeight, doorCount ...
}

type JointType = 'confirmat' | 'dowel' | 'minifix' | 'butt';
```

Пример `extras` для шкафа: `{ shelves: 3, doors: 2, facadeType: 'overlay', facadeGap: 3, backType: 'groove' }`.

### Деталь (Part) — центральная сущность

```ts
interface Part {
  id: PartId;
  productId: ProductId;
  parentId?: PartId;               // вложенность (напр. фасад ящика)
  name: string;                    // «Боковина левая», «Полка» ...
  role: PartRole;                  // семантика: side|top|bottom|shelf|back|facade|... (для генератора/чертежа)

  // Габариты заготовки (плоскость раскроя). length ≥ width по соглашению.
  size: { length: Mm; width: Mm; thickness: Mm };

  material: MaterialId;
  grain: GrainDirection;           // направление текстуры детали
  quantity: number;                // одинаковых деталей (для спецификации)

  // Кромка по 4 сторонам (ссылки на EdgeMaterial или null = без кромки)
  edges: {
    left:   EdgeId | null;
    right:  EdgeId | null;
    top:    EdgeId | null;
    bottom: EdgeId | null;
  };

  // Положение детали в 3D-сборке (производственная позиция, не декоративная)
  transform: {
    position: Vec3;                // мм, локальные координаты изделия
    rotation: Rotation;            // ориентация плоскости детали
  };

  machining: MachiningOp[];        // операции присадки на этой детали
  metadata?: Record<string, unknown>;

  // Признаки происхождения: сгенерирована решателем или добавлена вручную
  generated: boolean;
}

type PartRole =
  | 'side' | 'top' | 'bottom' | 'shelf' | 'back' | 'divider'
  | 'facade' | 'drawer-front' | 'drawer-side' | 'drawer-back' | 'drawer-bottom'
  | 'plinth' | 'leg' | 'custom';

/** Точечное переопределение поля сгенерированной детали (переживает пересчёт). */
interface PartOverride {
  target: { role: PartRole; index?: number };   // какую деталь
  patch: Partial<Pick<Part, 'name' | 'material' | 'edges' | 'grain'>>;
}
```

### Материалы

```ts
interface Material {
  id: MaterialId;
  name: string;                    // «ЛДСП Egger H1145 18мм» (пользовательское)
  kind: MaterialKind;              // ldsp | mdf | plywood | edge-glued | solid | glass | other
  thickness: Mm;
  sheet: { length: Mm; width: Mm }; // размер листа/плиты
  density?: number;                // кг/м³ (для массы)
  grain: GrainDirection;           // есть ли у материала направление текстуры
  allowRotate: boolean;            // можно ли поворачивать деталь при раскрое
  kerf?: Mm;                       // пропил (иначе берётся из settings)
  appearance: {
    color: string;                 // hex
    textureId?: string;            // ссылка на встроенную/загруженную текстуру
  };
  cost?: {                         // ОПЦИОНАЛЬНО
    perSheet?: number;
    perSquareMeter?: number;
    currency?: string;
  };
  metadata?: Record<string, unknown>;
}

type MaterialKind = 'ldsp' | 'mdf' | 'plywood' | 'edge-glued' | 'solid' | 'glass' | 'other';
```

### Кромка

```ts
interface EdgeMaterial {
  id: EdgeId;
  name: string;                    // «Кромка ПВХ 2мм H1145»
  thickness: Mm;                   // 0.4 / 1 / 2 мм ...
  width?: Mm;                      // ширина ленты (для расхода)
  color: string;
  cost?: { perMeter?: number; currency?: string }; // ОПЦИОНАЛЬНО
  metadata?: Record<string, unknown>;
}
```

Кромка влияет на деталировку: генератор присадки/раскроя учитывает, что
номинальный размер детали может уменьшаться на толщину кромки (припуск на
облицовку), а ведомость кромки суммирует погонные метры по сторонам.

### Фурнитура

```ts
interface HardwareItem {
  id: HardwareId;
  name: string;                    // «Петля Blum 110°», «Направляющая 450мм»
  category: HardwareCategory;      // hinge | slide | leg | handle | connector | shelf-support | ...
  quantity: number;
  cost?: { perUnit?: number; currency?: string };
  // связанные операции присадки создаются автоматически (напр. петля → 2 отверстия)
  metadata?: Record<string, unknown>;
}

type HardwareCategory =
  | 'hinge' | 'slide' | 'leg' | 'handle' | 'connector'
  | 'shelf-support' | 'rod' | 'other';
```

### Присадка (см. раздел H — там детальнее)

```ts
interface MachiningOp {
  id: OpId;
  type: string;                    // ключ в MachiningOpRegistry: 'hole'|'confirmat'|'dowel'|'hinge'|'groove'|...
  // координаты относительно детали (плоскость детали: x вдоль length, y вдоль width)
  x: Mm;
  y: Mm;
  z?: Mm;                          // для сквозных/несквозных по толщине
  diameter?: Mm;
  depth?: Mm;
  angle?: number;                  // градусы (наклонное сверление)
  side: Side;                      // с какой стороны/грани заходит инструмент
  through?: boolean;               // сквозное
  params?: Record<string, number | string | boolean>; // спец-параметры типа операции
  link?: { toPartId?: PartId; toOpId?: OpId; hardwareId?: HardwareId }; // связь (парное отверстие/крепёж)
}
```

Все размерные величины — `Mm`, целочисленное отображение округляется по
настройкам. Хранение — всегда мм, чтобы избежать ошибок конвертации.

---

## E. Архитектура 3D

**Принцип:** 3D — это **проекция производственной модели**, а не отдельная
модель. Один и тот же `Part` порождает mesh для сцены, контур для раскроя и вид
для чертежа.

### Из Part в 3D

```
Part (size, transform, material, machining)
      │
      ▼
geometry/box.ts         →  габаритный параллелепипед (length × thickness × width)
      │                     (толщина — вдоль оси, заданной ролью/поворотом)
      ▼
ui/viewport3d/PartMesh   →  <mesh> с BoxGeometry + материал из Materials3D
      │                     + позиция/поворот из Part.transform
      ▼
Materials3D.ts           →  three MeshStandardMaterial:
                            color/texture из Material.appearance,
                            учёт направления текстуры (UV-ориентация по grain)
```

Присадка (`machining`) отображается на mesh **опционально** как накладные
маркеры (кружки отверстий, линии пазов) — отдельным слоем, чтобы не
пересобирать геометрию плиты. Для реалистичного вида можно на поздних этапах
применять CSG-вырезы, но это не нужно для производства и по умолчанию выключено
(производительность при 1000+ деталей).

### Оптимизация сцены

- **Инстансинг**: одинаковые детали (`quantity > 1`, одинаковый материал) —
  через `InstancedMesh`.
- **Общие материалы**: один three-material на `MaterialId` (кэш), не по детали.
- **Ленивое построение**: mesh собирается из мемоизированного `Part[]`; при
  изменении параметра пересобираются только затронутые изделия.
- **Слои**: корпус / фасады / присадка / размеры — раздельные группы, включаются/
  выключаются без пересборки.
- **LOD для присадки**: маркеры отверстий рисуются только вблизи/по флагу.
- **Frustum culling** — штатный three; для очень больших сцен — упрощённая
  геометрия дальних изделий.

### Взаимодействие

- Выбор детали в 3D ↔ выделение в таблице/инспекторе (общий `selectionSlice`).
- Гизмо перемещения работает только для «произвольных» деталей/изделий; размеры
  корпусных деталей меняются **через параметры**, а не таскание вершин (иначе
  ломается связь с производством).

**Явно НЕ делаем:** свободную скульптинг-геометрию, произвольные меши без
соответствия `Part`. Всё в сцене имеет производственный прообраз.

---

## F. Архитектура расчёта мебели (параметрика)

Сердце системы: **параметры изделия → список деталей**. Чистая функция без
побочных эффектов.

### Контракт решателя

```ts
// domain/parametric/solve.ts
function solveProduct(product: Product, ctx: SolveContext): Part[];

interface SolveContext {
  materials: Map<MaterialId, Material>;
  edges: Map<EdgeId, EdgeMaterial>;
  settings: ProjectSettings;
}
```

### Как работает генератор (на примере корпуса — `cabinet`)

```
params: { width:800, height:2000, depth:600, panelThickness:16,
          jointType:'confirmat', extras:{ shelves:3, doors:2, ... } }

1. Скелет корпуса по jointType:
   - боковины: 2 шт, size = { length: height, width: depth, thickness: 16 }
   - крышка/дно: длина = width − 2*16 (при «вкладной» схеме),
                 либо = width (при «накладной»); ширина = depth
   - задняя стенка: по типу (в паз / внахлёст / вкладная),
                    размер = f(width, height, backInset)
2. Наполнение (features/):
   - полки: shelves шт, длина = внутренняя ширина, ширина = depth − задняя стенка
   - фасады: по facadeType (накладной/вкладной) и зазорам,
             размер = f(width, height, gaps, doorCount)
3. Кромкование: назначить кромку по правилам роли (напр. видимые торцы полок)
4. Присадка: resolveMachining(parts, jointType) — соединения между деталями
             (конфирматы боковина↔дно, петли на фасад↔боковину и т.д.)
5. Позиционирование: transform каждой детали в координатах изделия
6. Наложить product.overrides и добавить product.customParts
→ Part[]
```

Каждый шаг — маленькая чистая функция. Генератор изделия **композирует**
модификаторы (`features/`), а не является монолитом. Новый тип мебели = новый
генератор в `ProductTypeRegistry`, переиспользующий общие модификаторы.

### Реактивность и пересчёт

```
изменение params → команда → projectSlice обновлён
      │
      ▼ (мемоизация по product.id + hash(params, materials))
solveProduct → Part[]  ── пересчитывается ТОЛЬКО для изменённого изделия
      │
      ▼
инвалидация зависимых проекций (BOM, nesting, drawing, 3D) этого изделия
```

Пример из задания: `width 800 → 900`:
- боковины: не меняются (их размер = height×depth) → **не пересобираются в 3D**;
- крышка/дно/полки: `length` пересчитывается → пересобираются;
- фасады: пересчитываются;
- присадка соединений: пересчитывается на затронутых деталях;
- BOM, раскрой, чертежи, спецификация — инвалидируются и пересчитываются.

### Правила и ограничения (constraints)

`domain/parametric/constraints.ts` и `validation/checks.ts`:
- зазоры фасадов, минимальные/максимальные габариты;
- кромка не толще детали;
- полка не шире внутреннего проёма;
- предупреждения (не блокирующие) складываются в модель диагностики для
  отображения в статус-баре.

---

## G. Архитектура раскроя (CuttingEngine)

Раскрой — **заменяемый вычислительный модуль**. UI знает только интерфейс, не
алгоритм. Запускается в Web Worker.

### Интерфейсы

```ts
// domain/nesting/types.ts

interface CuttingInput {
  pieces: CuttingPiece[];          // детали к раскрою (развёрнутые по quantity)
  stock: StockSheet[];             // доступные листы/остатки
  kerf: Mm;                        // ширина пропила
  options: CuttingOptions;
}

interface CuttingPiece {
  pieceId: string;                 // = PartId (+ индекс копии)
  partId: PartId;
  length: Mm;
  width: Mm;
  grain: GrainDirection;           // ограничение ориентации
  allowRotate: boolean;            // производный флаг (material.allowRotate && grain==='none')
  materialId: MaterialId;          // раскрой группируется по материалу
}

interface StockSheet {
  materialId: MaterialId;
  length: Mm;
  width: Mm;
  trim: Mm;                        // технологический отступ от края
  count?: number;                  // сколько листов доступно (undefined = неограниченно)
  isRemnant?: boolean;             // это остаток
}

interface CuttingOptions {
  algorithm: string;               // ключ в CuttingEngineRegistry
  respectGrain: boolean;
  minRemnant?: Mm;                 // порог сохранения остатка
  seed?: number;                   // детерминизм
}

interface CuttingResult {
  sheets: SheetLayout[];
  summary: {
    sheetsUsed: number;
    usedAreaMm2: number;
    wasteAreaMm2: number;
    utilization: number;           // 0..1 процент использования
  };
  remnants: FreeRect[];            // полезные остатки
  unplaced: CuttingPiece[];        // что не поместилось (диагностика)
}

interface SheetLayout {
  materialId: MaterialId;
  index: number;                   // № листа
  size: { length: Mm; width: Mm };
  placements: Placement[];
  freeRects: FreeRect[];
}

interface Placement {
  pieceId: string;
  partId: PartId;
  x: Mm; y: Mm;                    // координаты левого-нижнего угла на листе
  length: Mm; width: Mm;           // фактические (с учётом поворота)
  rotated: boolean;                // деталь повёрнута на 90°
}

interface FreeRect { x: Mm; y: Mm; length: Mm; width: Mm; }
```

### Движок (заменяемый)

```ts
// domain/nesting/CuttingEngine.ts
interface CuttingEngine {
  readonly id: string;             // 'guillotine' | 'maxrects' | ...
  readonly name: string;
  run(input: CuttingInput, onProgress?: (p: number) => void): CuttingResult;
}

// Реестр — можно зарегистрировать более эффективный алгоритм позже
const CuttingEngineRegistry = new Map<string, CuttingEngine>();
```

Стартовые реализации:
- **guillotine** — гильотинный рез (соответствует реальному форматно-раскроечному
  станку: сквозные резы). Базовый, предсказуемый.
- **maxrects** — плотнее по площади (для материалов без ограничения сквозного
  реза, напр. фрезеровка). Опция.

**Ключевое:** UI (`NestingView`) вызывает `nesting.run()` через worker-клиент и
рисует `CuttingResult`. Смена алгоритма = смена `options.algorithm`. Ни строки
UI-кода не привязано к внутренностям алгоритма.

### Группировка

`domain/nesting/group.ts` разбивает `Part[]` по `materialId` (и опц. по цвету/
текстуре), разворачивает `quantity`, вычисляет `allowRotate` из
`material.allowRotate` и `part.grain`, затем на каждую группу запускает движок.

---

## H. Архитектура присадки (machining)

Присадка — **универсальная расширяемая система операций**. Каждая деталь несёт
список `MachiningOp`. Типы операций регистрируются, а не зашиваются.

### Реестр операций

```ts
// domain/machining/MachiningOpRegistry.ts
interface MachiningOpDef<P = Record<string, unknown>> {
  type: string;                    // 'hole' | 'confirmat' | 'dowel' | 'hinge' | 'groove' | 'minifix' | ...
  label: string;
  defaults: () => Partial<MachiningOp>;
  /** валидация параметров операции */
  validate?: (op: MachiningOp, part: Part) => string[];
  /** как нарисовать в 2D-чертеже детали */
  draw2d: (op: MachiningOp) => Scene2DPrimitive[];
  /** как показать маркер в 3D (опционально) */
  marker3d?: (op: MachiningOp) => Marker3D;
  /** вклад в экспорт (напр. точки сверловки для DXF/станка) */
  toToolpath?: (op: MachiningOp, part: Part) => Toolpath[];
}

const MachiningOpRegistry = new Map<string, MachiningOpDef>();
```

Базовые типы (регистрируются на старте): `hole` (простое отверстие), `confirmat`,
`dowel` (шкант), `minifix`/`eccentric` (эксцентрик), `hinge` (петля — чашка +
ответка), `slide` (направляющая — ряд отверстий), `groove` (паз под ДВП/дно
ящика), `shelf-hole` (под полкодержатель), `custom` (произвольное).

### Как рождается присадка

Два источника:

1. **Автоматически из соединений** — `domain/machining/resolve.ts`:
   по `jointType` изделия и геометрии соседних деталей генерируются парные
   операции (напр. конфирмат: сквозное в дне + глухое в торце боковины со
   `link.toPartId`). Пересчитывается при изменении параметров.
2. **Автоматически из фурнитуры** — петля добавляет чашку на фасад и ответку на
   боковину; направляющая — ряды отверстий. Через `HardwareRegistry`.
3. **Вручную** — пользователь добавляет операции в инспекторе детали.

### Система координат

Координаты операции — **в плоскости детали**: `x` вдоль `length`, `y` вдоль
`width`, `side` задаёт грань/пласть захода инструмента, `z`/`depth` — по толщине.
Это делает присадку независимой от положения детали в сборке: одна и та же
деталь одинаково присаживается независимо от того, куда её повернули в 3D. При
пересчёте размеров операции, привязанные параметрически (напр. «отступ 32 мм от
края»), пересчитываются; абсолютные — сохраняются.

**Расширяемость:** новый тип крепежа = новый `MachiningOpDef` в реестре +
опц. правило в `resolve`/`hardware`. Ядро, чертежи и экспорт не переписываются —
они вызывают `draw2d` / `toToolpath` через реестр.

---

## I. Архитектура чертежей (2D)

Отдельная подсистема, строящая **данные чертежа** (не пиксели) из
производственной модели. Рендер — в SVG; экспорт — SVG/PDF/DXF из тех же данных.

### Абстрактная 2D-сцена

```ts
// domain/drawing/scene2d.ts — независимо от рендера
type Scene2DPrimitive =
  | { kind: 'line'; a: Pt; b: Pt; style?: LineStyle }
  | { kind: 'rect'; x: Mm; y: Mm; w: Mm; h: Mm; style?: LineStyle }
  | { kind: 'circle'; c: Pt; r: Mm; style?: LineStyle }
  | { kind: 'path'; pts: Pt[]; closed?: boolean; style?: LineStyle }
  | { kind: 'text'; at: Pt; value: string; style?: TextStyle }
  | { kind: 'dimension'; a: Pt; b: Pt; offset: Mm; value?: string };

interface Drawing2D {
  title: string;
  bounds: { w: Mm; h: Mm };
  primitives: Scene2DPrimitive[];
  scale?: number;
}
type Pt = { x: Mm; y: Mm };
```

Один и тот же `Drawing2D` рендерится:
- **на экране** — компонентом `DrawingView` (SVG);
- **в PDF** — экспортёром (примитивы → pdf-lib);
- **в DXF** — писателем DXF (линии/окружности/текст → сущности R12);
- **в SVG-файл** — напрямую.

### Что строит подсистема

```ts
// domain/drawing/views.ts
buildFrontView(product, parts): Drawing2D   // вид спереди
buildSideView(product, parts): Drawing2D    // вид сбоку
buildTopView(product, parts): Drawing2D     // вид сверху

// domain/drawing/partDrawing.ts
buildPartDrawing(part): Drawing2D           // деталь: контур + кромка + присадка + размеры + № детали
```

- **Виды** — ортогональные проекции сборки: берём `Part.transform`, проецируем
  габаритные боксы на плоскость, убираем невидимое (простая z-сортировка на
  старте), навешиваем авторазмеры (`dimensions.ts`).
- **Чертёж детали** — контур заготовки, обозначение кромки по сторонам (цвет/
  толщина в легенде), все операции присадки через `MachiningOpDef.draw2d`,
  размерные линии до отверстий, номер детали и материал.
- **Присадочный чертёж** — тот же чертёж детали с акцентом на координаты
  отверстий (таблица «отверстие → x, y, ⌀, глубина»).

Авторазмеры — это данные (`kind:'dimension'`), а не текст; при пересчёте детали
размеры обновляются автоматически.

---

## J. Формат проекта (JSON)

Формат **переносимый, версионированный, не привязан к React/Three**. Валидируется
Zod-схемой при импорте; несовместимые версии проходят цепочку миграций.

```jsonc
{
  "version": "1.0",
  "id": "prj_xxx",
  "meta": {
    "name": "Шкаф в прихожую",
    "createdAt": "2026-08-23T10:00:00Z",
    "updatedAt": "2026-08-23T10:30:00Z",
    "author": null,
    "notes": ""
  },
  "settings": {
    "units": "mm",
    "displayUnits": "mm",
    "kerf": 4,
    "defaultBoardMaterial": "mat_ldsp16",
    "sheetTrim": 10,
    "costEnabled": false,
    "locale": "ru"
  },
  "materials": [
    {
      "id": "mat_ldsp16",
      "name": "ЛДСП 16 мм Белый",
      "kind": "ldsp",
      "thickness": 16,
      "sheet": { "length": 2800, "width": 2070 },
      "density": 650,
      "grain": "none",
      "allowRotate": true,
      "kerf": 4,
      "appearance": { "color": "#f2f0ec", "textureId": null },
      "cost": null
    }
  ],
  "edges": [
    {
      "id": "edge_2mm_white",
      "name": "Кромка ПВХ 2 мм Белая",
      "thickness": 2,
      "width": 23,
      "color": "#f2f0ec",
      "cost": null
    }
  ],
  "hardware": [
    { "id": "hw_confirmat", "name": "Конфирмат 7x50", "category": "connector", "quantity": 24, "cost": null }
  ],
  "products": [
    {
      "id": "prd_1",
      "name": "Корпус шкафа",
      "type": "cabinet",
      "transform": { "position": { "x": 0, "y": 0, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 } },
      "params": {
        "width": 800,
        "height": 2000,
        "depth": 600,
        "bodyMaterial": "mat_ldsp16",
        "backMaterial": "mat_hdf3",
        "panelThickness": 16,
        "jointType": "confirmat",
        "extras": { "shelves": 3, "doors": 2, "facadeType": "overlay", "facadeGap": 3, "backType": "groove" }
      },
      "overrides": [],
      "customParts": [],
      "metadata": {}
    }
  ]
}
```

**Что НЕ хранится в файле** (выводится при загрузке): `parts`, спецификация,
раскрой, 3D-геометрия, чертежи. Это гарантирует, что файл не может
рассинхронизироваться с моделью. (Кэш раскроя может опционально сохраняться как
`derivedCache` с хэшем входа — но только как ускорение, не как истина.)

**Персистентность и история:**
- `infra/persistence/db.ts` (IndexedDB): хранит проекты, автобэкапы, снимки
  версий, загруженные текстуры (blob).
- `infra/persistence/autosave.ts`: дебаунс-сохранение текущего проекта.
- `infra/persistence/versions.ts`: история изменений (снимки/патчи команд).
- Операции: **Новый / Сохранить / Сохранить как / Импорт JSON / Экспорт JSON**,
  автобэкап, история. Всё локально, без сервера, без регистрации.

**Миграции:** `serialization/migrate.ts` — карта `from → to` функций. При
загрузке файла версии `< current` последовательно применяются миграции. Это
обязательное требование к производственному формату (проекты живут годами).

---

## K. План разработки

Поэтапно, каждый этап — самостоятельно проверяемый инкремент. Порядок такой,
чтобы **производственное ядро появилось раньше красоты**.

> Легенда полей: **Цель · Создаём · Файлы · Результат · Готовность · Тесты**

### Этап 0. Каркас проекта и дисциплина слоёв
- **Цель:** пустой, но правильно устроенный проект.
- **Создаём:** Vite+React+TS, ESLint (правило запрета импортов three/react в `domain/`), Vitest, Prettier, структуру каталогов из раздела C, CI.
- **Файлы:** `vite.config.ts`, `tsconfig.json`, `.eslintrc`, каркас `src/**`.
- **Результат:** `npm run dev` открывает пустой каркас; `npm test` зелёный.
- **Готовность:** CI гоняет lint+test; правило слоёв срабатывает.
- **Тесты:** smoke-тест сборки; тест ESLint-правила слоёв.

### Этап 1. Модель данных и инварианты
- **Цель:** типы модели как единый источник истины.
- **Создаём:** `domain/model/*` (типы, id, units, defaults, invariants).
- **Результат:** можно собрать `Project` в памяти, типобезопасно.
- **Готовность:** типы компилируются в strict; функции-хелперы юнит-покрыты.
- **Тесты:** конструирование дефолтного проекта, инварианты (кромка≤толщина и т.п.).

### Этап 2. Zod-схема, сериализация, миграции
- **Цель:** переносимый JSON-формат.
- **Создаём:** `infra/serialization/{schema,migrate,projectFile}.ts`.
- **Результат:** save/load/import/export JSON round-trip без потерь.
- **Готовность:** round-trip идемпотентен; битый JSON отвергается с ошибкой.
- **Тесты:** round-trip фикстур; отказ на невалидном файле; фиктивная миграция 0.9→1.0.

### Этап 3. Стор, команды, undo/redo
- **Цель:** управляемая мутация модели.
- **Создаём:** `state/store.ts`, `commands/{Command,history}`, базовые команды (изменить параметр, добавить/удалить изделие).
- **Результат:** изменения через команды, работает undo/redo.
- **Готовность:** любая мутация обратима; история корректна.
- **Тесты:** apply/invert для каждой команды; последовательность undo/redo.

### Этап 4. Параметрический решатель — корпус (cabinet)
- **Цель:** параметры → детали.
- **Создаём:** `parametric/{ProductTypeRegistry,solve}`, `generators/cabinet`, `features/{shelves,back}`.
- **Результат:** `solveProduct` для шкафа даёт корректные боковины/дно/крышку/полки/зад.
- **Готовность:** размеры деталей математически верны для нескольких схем соединений.
- **Тесты:** табличные тесты «параметры → ожидаемые размеры деталей»; пересчёт 800→900.

### Этап 5. Каталоги материалов и кромки
- **Цель:** реальные материалы/кромка.
- **Создаём:** `infra/catalog/materials`, встроенные ЛДСП/МДФ/ДВП, редактор материалов/кромки.
- **Результат:** деталь ссылается на материал; кромка назначается по сторонам.
- **Готовность:** назначение материала/кромки отражается в модели.
- **Тесты:** валидация материала; расчёт припуска на кромку.

### Этап 6. Спецификация и ведомости (BOM)
- **Цель:** производственные таблицы.
- **Создаём:** `bom/{specification,edgeband,materials,mass,hardware}`.
- **Результат:** таблица деталей (№, размеры, материал, кромка Л/П/В/Н), пог. м кромки, площади, масса.
- **Готовность:** цифры сходятся с ручной проверкой на эталоне.
- **Тесты:** спецификация и суммы кромки/площади/массы на фикстурах.

### Этап 7. 3D-viewport (проекция модели)
- **Цель:** увидеть детали в 3D.
- **Создаём:** `ui/viewport3d/*`, `Materials3D`, инстансинг, выбор.
- **Результат:** корпус отображается из `Part[]`, деталь выбирается.
- **Готовность:** при изменении параметра сцена перестраивается; выбор синхронен с таблицей.
- **Тесты:** маппинг Part→mesh (юнит для геометрии/трансформа); e2e-smoke сцены.

### Этап 8. Каркас UI (layout, панели, статус-бар)
- **Цель:** рабочий экран из задания.
- **Создаём:** `app/layout`, `panels/{Library,Properties,PartsTable,StatusBar}`.
- **Результат:** библиотека / 3D / свойства / статус связаны со стором.
- **Готовность:** редактирование параметра в инспекторе меняет 3D и таблицу.
- **Тесты:** e2e: изменить ширину → обновились 3D и спецификация.

### Этап 9. Присадка — модель и авто-соединения
- **Цель:** технологические операции.
- **Создаём:** `machining/{MachiningOpRegistry,resolve}`, ops (confirmat, dowel, minifix, groove, shelf-hole).
- **Результат:** соединения корпуса порождают присадку; операции в модели детали.
- **Готовность:** координаты операций верны; пересчёт при изменении размеров.
- **Тесты:** генерация конфирматов боковина↔дно; связи `link.toPartId`.

### Этап 10. Присадка от фурнитуры + ручное редактирование
- **Цель:** петли/направляющие/ручной ввод.
- **Создаём:** `catalog/hardware`, правила hinge/slide, UI добавления операций.
- **Результат:** петля добавляет чашку+ответку; направляющая — ряды отверстий; ручные операции.
- **Готовность:** ведомость фурнитуры и присадка согласованы.
- **Тесты:** петля → корректные 2 операции; ручная операция сохраняется.

### Этап 11. Раскрой — движок и worker
- **Цель:** карты раскроя.
- **Создаём:** `nesting/{types,CuttingEngine,group}`, `engines/guillotine`, `workers/nesting.worker`, Comlink-клиент.
- **Результат:** `CuttingResult` из `Part[]`, без блокировки UI.
- **Готовность:** детерминизм при seed; отсутствие пересечений; корректный kerf; учёт grain.
- **Тесты:** отсутствие наложений/выходов за лист; утилизация в разумных пределах; респект текстуры.

### Этап 12. Просмотрщик раскроя
- **Цель:** визуальная карта.
- **Создаём:** `ui/nesting/NestingView` (Canvas), список листов, остатки, % использования.
- **Результат:** пользователь видит раскладку, № деталей, отход, остатки.
- **Готовность:** карта соответствует `CuttingResult`; клик по детали ↔ выделение.
- **Тесты:** e2e: получить раскрой для проекта и увидеть ≥1 лист.

### Этап 13. Второй алгоритм раскроя (maxrects)
- **Цель:** доказать заменяемость движка.
- **Создаём:** `engines/maxrects`, регистрация, переключатель в UI.
- **Результат:** смена алгоритма без изменений UI-логики.
- **Готовность:** оба движка проходят один и тот же контракт-тест.
- **Тесты:** общий набор контракт-тестов для всех движков реестра.

### Этап 14. 2D-чертежи — виды и деталь
- **Цель:** чертежи из модели.
- **Создаём:** `drawing/{scene2d,views,dimensions,partDrawing}`, `ui/drawing/DrawingView` (SVG).
- **Результат:** вид спереди/сбоку/сверху, чертёж детали с кромкой/присадкой/размерами.
- **Готовность:** размеры авто-обновляются при пересчёте.
- **Тесты:** снапшот-тесты `Drawing2D` для эталонной детали/вида.

### Этап 15. Экспорт: JSON/CSV/SVG
- **Цель:** базовый бесплатный экспорт.
- **Создаём:** `export/{ExporterRegistry,csv,svg}`, экспорт проекта JSON.
- **Результат:** спецификация → CSV; чертёж → SVG; проект → JSON.
- **Готовность:** файлы открываются во внешних программах.
- **Тесты:** валидность CSV/SVG; round-trip JSON.

### Этап 16. Экспорт PDF (спецификация, раскрой, чертежи)
- **Цель:** печатная документация.
- **Создаём:** `export/pdf/*`, `workers/export.worker`.
- **Результат:** PDF спецификации, карт раскроя, чертежей деталей/присадки.
- **Готовность:** многостраничный PDF генерируется в worker без фриза UI.
- **Тесты:** PDF создаётся; число страниц соответствует данным; smoke на больших проектах.

### Этап 17. Экспорт DXF (архитектура + деталь/раскрой)
- **Цель:** передача на станок/во внешний CAD.
- **Создаём:** `export/dxf/*` (писатель R12), маппинг `Drawing2D`/`Toolpath`→DXF.
- **Результат:** DXF контуров деталей и/или раскроя, сверловка как точки/окружности.
- **Готовность:** DXF открывается в стороннем просмотрщике/CAD.
- **Тесты:** структурная валидация DXF; геометрия совпадает с `Drawing2D`.

### Этап 18. Персистентность, автобэкап, история версий
- **Цель:** надёжная локальная работа без регистрации.
- **Создаём:** `persistence/{db,autosave,versions}`, UI списка проектов/версий.
- **Результат:** проекты хранятся в IndexedDB, автобэкап, восстановление версий.
- **Готовность:** перезагрузка браузера не теряет работу; версии восстанавливаются.
- **Тесты:** сохранение/загрузка из IndexedDB (fake-idb); восстановление снимка.

### Этап 19. Производительность (100/500/1000+ деталей)
- **Цель:** масштаб.
- **Создаём:** мемоизация селекторов, инстансинг, батч-пересчёт, вынос раскроя/экспорта в worker, профилирование.
- **Результат:** плавный UI на 1000+ деталей; раскрой/экспорт не блокируют.
- **Готовность:** заданные бенчмарки укладываются в бюджеты (напр. пересчёт < N мс).
- **Тесты:** бенчмарк-тесты на синтетических проектах 100/500/1000 деталей.

### Этап 20. PWA / offline
- **Цель:** работа без сети после первой загрузки.
- **Создаём:** `vite-plugin-pwa`, service worker, manifest, кэш ассетов/текстур.
- **Результат:** 3D/расчёты/раскрой/чертежи/сохранение работают офлайн.
- **Готовность:** приложение открывается и функционирует без сети.
- **Тесты:** e2e offline-сценарий; аудит установимости PWA.

### Этап 21+ (бэклог, за MVP)
Новые типы изделий (стол, стеллаж, кухонный модуль, кровать) как генераторы;
ящики/раздвижные системы; импорт из внешних форматов; расширенное скрытие
невидимых линий на видах; сборочные схемы с позициями крепежа; печатные шаблоны;
расширение каталогов.

---

## L. MVP

**Минимальная первая рабочая версия** = этапы **0–8 + 11–12 + 15 (JSON)**,
плюс минимальный кусочек присадки не требуется для MVP-спецификации, но соединения
можно отложить. Точный состав MVP:

> Создать простой корпус → задать размеры → получить реальные детали → увидеть
> их в 3D → получить спецификацию → получить простой раскрой → сохранить проект.

MVP включает:
1. **Один тип изделия** — корпусной шкаф (`cabinet`) с параметрами
   `width/height/depth/panelThickness/shelves/back`.
2. **Параметрический решатель** — из параметров реальные детали (боковины, дно,
   крышка, полки, задняя стенка) с верными размерами.
3. **3D** — детали как проекция модели; изменение размера перестраивает сцену.
4. **Спецификация** — таблица деталей (№, размеры, материал, кромка).
5. **Раскрой** — гильотинный движок в worker + визуальная карта, % использования.
6. **Материалы/кромка** — минимальный встроенный каталог (ЛДСП 16 мм + кромка).
7. **Проект** — новый/сохранить/загрузить, экспорт/импорт JSON, автобэкап в
   IndexedDB.

MVP сознательно **не включает**: PDF/DXF, чертежи 2D, авто-присадку и фурнитуру,
второй алгоритм раскроя, PWA — всё это идёт следующими этапами по плану K.

Критерий готовности MVP: пользователь без регистрации открывает сайт, за
несколько кликов делает шкаф 800×2000×600 с 3 полками, видит его в 3D и в
таблице деталей, получает карту раскроя на листах 2800×2070 и сохраняет проект в
JSON — и всё это работает локально в браузере, бесплатно.

---

## Приложение: тестирование

Стратегия «пирамида», ядро покрывается плотно, т.к. цена ошибки —
неправильная деталь на производстве.

- **Юнит (Vitest), основной объём** — весь `domain/`:
  - решатель: табличные тесты «параметры → размеры деталей», пересчёт при
    изменении габаритов;
  - раскрой: контракт-тесты для **всех** движков реестра (нет наложений, всё в
    пределах листа, kerf учтён, grain соблюдён, детерминизм по seed);
  - присадка: корректность координат и парных связей;
  - BOM: суммы кромки/площади/массы;
  - чертежи: снапшоты `Drawing2D`;
  - сериализация: round-trip + миграции + отказ на битом файле.
- **Контрактные тесты реестров** — один набор тестов, прогоняемый по каждому
  зарегистрированному движку раскроя/экспортёру/типу присадки. Гарантирует
  заменяемость.
- **Компонентные** — ключевые панели (инспектор, таблица) со стором.
- **E2E (Playwright)** — сценарий MVP целиком; offline-сценарий (после PWA);
  экспорт-сценарии (файл создаётся и валиден).
- **Бенчмарки** — проекты 100/500/1000 деталей: бюджет времени пересчёта,
  раскроя, экспорта; проверка неблокирования UI.
- **CI** — lint (включая правило изоляции `domain/`), typecheck, unit, критичные
  e2e на каждый PR.

---

### Открытые вопросы к обсуждению перед реализацией

1. **Название/бренд** проекта (в документе — условное «Karkas»).
2. **Приоритет типов изделий** после шкафа: стол, стеллаж, кухня или кровать?
3. **PDF-библиотека**: `pdf-lib` (точнее с графикой/кириллицей, нужен встроенный
   шрифт) vs `jsPDF` — уточним на этапе 16.
4. **Гильотина vs maxrects по умолчанию** — исходить из реального оборудования
   пользователей (форматно-раскроечный станок ⇒ гильотина).
5. **Единицы отображения** — только мм или сразу мм/см/дюймы.

> Реализацию **не начинаю** — жду подтверждения архитектуры и ответов по
> открытым вопросам, затем иду по плану с **Этапа 0**.
