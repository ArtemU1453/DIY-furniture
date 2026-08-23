# Karkas — конструктор корпусной мебели

Бесплатный онлайн-конструктор мебели (мебель своими руками): проектирование →
3D → деталировка → материалы → кромка → присадка → раскрой → документация.

Полностью локальный, без регистрации, без рекламы и платных функций.
Архитектура описана в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Стек

TypeScript · React · Vite · Three.js / React Three Fiber · Zustand + Immer ·
IndexedDB · Vitest.

## Запуск

```bash
npm install
npm run dev        # режим разработки
npm run build      # production-сборка
npm run preview    # предпросмотр сборки
```

## Проверки

```bash
npm run typecheck  # проверка типов TypeScript
npm run lint       # ESLint (в т.ч. изоляция слоёв core/engines)
npm run test       # модульные тесты (Vitest)
```

## Слои

```
UI (components, features)      — только представление и ввод
  ↓
Store (app/store, Zustand)     — состояние проекта, выбор, история undo/redo
  ↓
Core (core/*)                  — модель, единицы, геометрия, валидация (чистый TS)
  ↓
Engines (engines/*)            — расчёты за интерфейсами (раскрой, мебель, …)
```

Слои `core/` и `engines/` не зависят от React/Three/store — это гарантируется
правилом ESLint.
