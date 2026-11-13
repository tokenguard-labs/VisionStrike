// Shared leaderboard helpers for the Vercel Blob-backed top 10.
import { head, put } from '@vercel/blob';

const FILE = 'leaderboard.json';

export function hasToken() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function clean(entry) {
  const name = String(entry?.name || 'PLAYER').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12) || 'PLAYER';
  const score = Math.min(1_000_000, Math.max(0, Math.floor(+entry?.score || 0)));
  const wave = Math.min(999, Math.max(0, Math.floor(+entry?.wave || 0)));
  return { name, score, wave };
}

export async function readBoard() {
  if (!hasToken()) return null;                    // caller falls back (e.g. local dev)
  try {
    const meta = await head(FILE);
    const res = await fetch(`${meta.url}?v=${Date.now()}`);   // bust CDN caching
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e?.toString?.().includes('not found')) return [];    // first run: no blob yet
    console.error('blob read failed', e);
    return null;                                             // storage error -> caller decides
  }
}

export async function writeBoard(board) {
  await put(FILE, JSON.stringify(board), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export function top10(board) {
  return [...board].sort((a, b) => b.score - a.score).slice(0, 10);
}
