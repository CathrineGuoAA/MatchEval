import { Conversation } from '../types';

const DB_NAME = 'evalai_indexed_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_store';
const CONVERSATIONS_KEY = 'evalai_conversations_data';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveConversationsToStorage(conversations: Conversation[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(conversations, CONVERSATIONS_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Remove legacy localStorage key if present to free up browser quota
    try {
      localStorage.removeItem('evalai_conversations');
    } catch {}
  } catch (err) {
    console.warn('IndexedDB save failed, falling back to safe localStorage:', err);
    safeSetLocalStorage('evalai_conversations', JSON.stringify(conversations));
  }
}

export async function loadConversationsFromStorage(): Promise<Conversation[] | null> {
  // 1. Try IndexedDB first
  try {
    const db = await openDB();
    const data = await new Promise<Conversation[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(CONVERSATIONS_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (data && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (err) {
    console.warn('IndexedDB load failed, trying localStorage:', err);
  }

  // 2. Fallback to localStorage for legacy data
  try {
    const stored = localStorage.getItem('evalai_conversations');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        // Automatically migrate to IndexedDB in background
        saveConversationsToStorage(parsed).catch(() => {});
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read conversations from localStorage:', err);
  }

  return null;
}

export function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`localStorage.setItem failed for key "${key}" (QuotaExceeded or disabled):`, err);
  }
}
