/**
 * Обёртка над IndexedDB (через idb). Хранит проекты локально в браузере —
 * без сервера и без регистрации.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '@/core/model/types';

const DB_NAME = 'karkas';
const DB_VERSION = 1;
export const PROJECTS_STORE = 'projects';

interface KarkasDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { updatedAt: string };
  };
}

let dbPromise: Promise<IDBPDatabase<KarkasDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<KarkasDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KarkasDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}
