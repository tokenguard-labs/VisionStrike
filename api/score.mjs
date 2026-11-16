// POST /api/score  body: { name, score, wave } -> writes the updated top 10 to Vercel Blob
import { hasToken, clean, readBoard, writeBoard, top10 } from './_lib.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hasToken()) return res.status(200).json({ ok: false, online: false });  // offline: local only

  const entry = clean(req.body || {});
  if (entry.score <= 0) return res.status(200).json({ ok: true, online: true });  // nothing to record

  const board = await readBoard();
  if (board === null) return res.status(503).json({ error: 'Leaderboard storage unavailable' });

  board.push(entry);
  await writeBoard(top10(board));
  return res.status(200).json({ ok: true, online: true });
}
