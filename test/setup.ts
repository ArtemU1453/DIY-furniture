import 'fake-indexeddb/auto';
import { bootstrapEngines } from '@/engines';

// Регистрируем движки по умолчанию (в т.ч. раскрой) для тестов.
bootstrapEngines();
