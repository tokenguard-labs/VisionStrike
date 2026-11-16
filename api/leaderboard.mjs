// GET /api/leaderboard -> { board: [...top10], online: bool }
import { hasToken, readBoard, top10 } from './_lib.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!hasToken()) {
    return res.status(200).json({ board: [], online: false });   // frontend uses localStorage
  }
  const board = await readBoard();
  if (board === null) return res.status(503).json({ error: 'Leaderboard storage unavailable' });
  return res.status(200).json({ board: top10(board), online: true });
}
