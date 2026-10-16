import type { ReportData } from './types';

// Imported data stays on this computer, in the browser's local storage for this file.
const KEY = 'transit-monthly-dashboard:v1';

export function loadSaved(): ReportData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ReportData;
    return Array.isArray(data?.system) && data.system.length ? data : null;
  } catch {
    return null;
  }
}

export function save(data: ReportData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
