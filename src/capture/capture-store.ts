import type { StoredCapture } from '../shared/capture';

const DATABASE_NAME = 'pixelscope-captures';
const STORE_NAME = 'captures';
const DATABASE_VERSION = 1;
export const CAPTURE_TTL_MS = 60 * 60 * 1000;

export async function saveCapture(capture: StoredCapture): Promise<void> {
  const database = await openDatabase();
  await transactionDone(database, 'readwrite', (store) => store.put(capture));
  database.close();
}

export async function getCapture(id: string): Promise<StoredCapture | null> {
  const database = await openDatabase();
  const value = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id) as IDBRequest<unknown>);
  database.close();
  return isStoredCapture(value) ? value : null;
}

export async function deleteCapture(id: string): Promise<void> {
  const database = await openDatabase();
  await transactionDone(database, 'readwrite', (store) => store.delete(id));
  database.close();
}

export async function deleteExpiredCaptures(now = Date.now()): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const values = await requestResult(store.getAll() as IDBRequest<unknown>);
  const captures = Array.isArray(values) ? values.filter(isStoredCapture) : [];
  for (const capture of captures) if (now - capture.createdAt >= CAPTURE_TTL_MS) store.delete(capture.id);
  await transactionComplete(transaction);
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('캡처 저장소를 열 수 없습니다.'));
  });
}

async function transactionDone(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  const transaction = database.transaction(STORE_NAME, mode);
  operation(transaction.objectStore(STORE_NAME));
  await transactionComplete(transaction);
}
function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('캡처 저장 작업에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('캡처 저장 작업이 중단됐습니다.'));
  });
}
function requestResult(request: IDBRequest<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('캡처 저장소 요청에 실패했습니다.'));
  });
}

function isStoredCapture(value: unknown): value is StoredCapture {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'id') === 'string' && Reflect.get(value, 'blob') instanceof Blob &&
    typeof Reflect.get(value, 'width') === 'number' && typeof Reflect.get(value, 'height') === 'number' &&
    typeof Reflect.get(value, 'title') === 'string' && typeof Reflect.get(value, 'createdAt') === 'number';
}
