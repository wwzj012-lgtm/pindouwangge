import { db, doc, setDoc, collection, getDocs, query, where, deleteDoc } from '../lib/firebase';

export interface ExportedPatternRecord {
  id: string;
  userId: string;
  title: string;
  width: number;
  height: number;
  totalBeads: number;
  thumbnailUrl: string; // Base64 thumbnail string
  createdAt: number; // ms timestamp
  expireAt: number; // ms timestamp (30 days from creation)
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days in milliseconds

/**
 * Generate a compressed compact thumbnail Data URL from a pattern canvas (max 320px)
 */
export function generateThumbnailDataUrl(canvas: HTMLCanvasElement, maxDim: number = 320): string {
  try {
    const thumbnailCanvas = document.createElement('canvas');
    const scale = Math.min(maxDim / canvas.width, maxDim / canvas.height, 1);
    thumbnailCanvas.width = Math.max(100, Math.round(canvas.width * scale));
    thumbnailCanvas.height = Math.max(100, Math.round(canvas.height * scale));

    const ctx = thumbnailCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a'; // slate-900 canvas backdrop
      ctx.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
      ctx.drawImage(canvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
    }
    return thumbnailCanvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('Failed to generate canvas thumbnail, returning empty fallback:', err);
    return canvas.toDataURL('image/png');
  }
}

/**
 * Save an exported pattern record for the user (Ordinary user: 7 days, VIP user: 30 days)
 */
export async function saveExportedPatternRecord(params: {
  userId: string;
  title: string;
  width: number;
  height: number;
  totalBeads: number;
  canvas: HTMLCanvasElement;
  isVip?: boolean;
}): Promise<ExportedPatternRecord | null> {
  if (!params.userId) return null;

  const recordId = `pat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const retentionDays = params.isVip ? 30 : 7;
  const expireAt = now + retentionDays * 24 * 60 * 60 * 1000;
  const thumbnailUrl = generateThumbnailDataUrl(params.canvas);

  const record: ExportedPatternRecord = {
    id: recordId,
    userId: params.userId,
    title: params.title || '未命名图纸',
    width: params.width || 29,
    height: params.height || 29,
    totalBeads: params.totalBeads || 0,
    thumbnailUrl,
    createdAt: now,
    expireAt,
  };

  // 1. Cache to LocalStorage immediately
  try {
    const localKey = `dzxg_patterns_${params.userId}`;
    const rawLocal = localStorage.getItem(localKey);
    let localList: ExportedPatternRecord[] = rawLocal ? JSON.parse(rawLocal) : [];
    // Filter out expired items (> 30 days old)
    localList = localList.filter(p => p.expireAt > now);
    localList.unshift(record);
    // Limit local storage cache to 50 latest records
    if (localList.length > 50) localList = localList.slice(0, 50);
    localStorage.setItem(localKey, JSON.stringify(localList));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }

  // 2. Try Server API Proxy
  try {
    const res = await fetch('/api/user-patterns/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (res.ok) {
      return record;
    }
  } catch (apiErr) {
    console.warn('Server pattern save endpoint failed, trying direct Firestore:', apiErr);
  }

  // 3. Fallback to Direct Firestore SDK
  try {
    const patternRef = doc(db, 'patterns', recordId);
    await setDoc(patternRef, record);
  } catch (fsErr) {
    console.warn('Firestore pattern save failed:', fsErr);
  }

  return record;
}

/**
 * Get all exported pattern records for a user (filters out items > 30 days old)
 */
export async function getUserExportedPatterns(userId: string): Promise<ExportedPatternRecord[]> {
  if (!userId) return [];

  const now = Date.now();
  let records: ExportedPatternRecord[] = [];

  // 1. Read from LocalStorage cache
  try {
    const localKey = `dzxg_patterns_${userId}`;
    const rawLocal = localStorage.getItem(localKey);
    if (rawLocal) {
      const parsed: ExportedPatternRecord[] = JSON.parse(rawLocal);
      records = parsed.filter(p => p.expireAt > now);
    }
  } catch (e) {
    console.warn('Failed to read local patterns cache:', e);
  }

  // 2. Try Server API Proxy
  try {
    const res = await fetch(`/api/user-patterns?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const serverRecords = await res.json() as ExportedPatternRecord[];
      if (Array.isArray(serverRecords) && serverRecords.length > 0) {
        // Merge server records with local
        const recordMap = new Map<string, ExportedPatternRecord>();
        [...records, ...serverRecords].forEach(r => {
          if (r.expireAt > now) {
            recordMap.set(r.id, r);
          }
        });
        const merged = Array.from(recordMap.values()).sort((a, b) => b.createdAt - a.createdAt);
        try {
          localStorage.setItem(`dzxg_patterns_${userId}`, JSON.stringify(merged));
        } catch (e) {}
        return merged;
      }
    }
  } catch (apiErr) {
    console.warn('Server pattern get endpoint failed, trying direct Firestore SDK:', apiErr);
  }

  // 3. Fallback to Direct Firestore SDK
  try {
    const patternsRef = collection(db, 'patterns');
    const q = query(patternsRef, where('userId', '==', userId));
    const snap = await getDocs(q);
    const fsRecords = snap.docs.map(d => d.data() as ExportedPatternRecord).filter(p => p.expireAt > now);

    const recordMap = new Map<string, ExportedPatternRecord>();
    [...records, ...fsRecords].forEach(r => {
      if (r.expireAt > now) {
        recordMap.set(r.id, r);
      }
    });
    const merged = Array.from(recordMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    try {
      localStorage.setItem(`dzxg_patterns_${userId}`, JSON.stringify(merged));
    } catch (e) {}
    return merged;
  } catch (fsErr) {
    console.warn('Firestore pattern fetch failed:', fsErr);
  }

  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Delete a user exported pattern record
 */
export async function deleteExportedPatternRecord(id: string, userId: string): Promise<boolean> {
  if (!id || !userId) return false;

  // 1. Remove from LocalStorage
  try {
    const localKey = `dzxg_patterns_${userId}`;
    const rawLocal = localStorage.getItem(localKey);
    if (rawLocal) {
      const list: ExportedPatternRecord[] = JSON.parse(rawLocal);
      const updated = list.filter(p => p.id !== id);
      localStorage.setItem(localKey, JSON.stringify(updated));
    }
  } catch (e) {}

  // 2. Call Server API Proxy
  try {
    await fetch('/api/user-patterns/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userId }),
    });
  } catch (apiErr) {
    console.warn('Server pattern delete endpoint failed:', apiErr);
  }

  // 3. Direct Firestore SDK
  try {
    await deleteDoc(doc(db, 'patterns', id));
  } catch (fsErr) {
    console.warn('Firestore pattern delete failed:', fsErr);
  }

  return true;
}
