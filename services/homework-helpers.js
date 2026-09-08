const dayjs = require('dayjs');
const { getDb } = require('../db/init');

// All user ids in the same family as `userId`
function getFamilyUserIds(db, userId) {
  const cur = db.prepare('SELECT family_code FROM users WHERE id = ?').get(userId);
  if (!cur || !cur.family_code) return [userId];
  return db
    .prepare('SELECT id FROM users WHERE family_code = ?')
    .all(cur.family_code)
    .map((u) => u.id);
}

// Child ids in the family; falls back to the user themselves when no child exists yet
function getFamilyChildIds(db, userId) {
  const cur = db.prepare('SELECT family_code, role FROM users WHERE id = ?').get(userId);
  if (!cur || !cur.family_code) return [userId];
  const children = db
    .prepare("SELECT id FROM users WHERE family_code = ? AND role = 'child'")
    .all(cur.family_code);
  if (children.length === 0) return [userId];
  return children.map((c) => c.id);
}

// Flatten a day's assignment items into the shape the mini-program expects:
// { id, content, item_type, subject, status, score, submission_id }
function getItemsForDate(db, childIds, date) {
  const placeholders = childIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ai.id AS id, ai.content AS content, ai.item_type AS item_type, ai.sort_order AS sort_order,
              t.subject AS subject,
              s.id AS submission_id, s.status AS sub_status, s.score AS sub_score, s.is_correct AS sub_correct
       FROM daily_assignments da
       JOIN assignment_items ai ON ai.assignment_id = da.id
       LEFT JOIN homework_templates t ON da.template_id = t.id
       LEFT JOIN submissions s ON s.id = (
         SELECT id FROM submissions WHERE item_id = ai.id ORDER BY submitted_at DESC LIMIT 1
       )
       WHERE da.user_id IN (${placeholders}) AND da.date = ?
       ORDER BY da.id ASC, ai.sort_order ASC`
    )
    .all(...childIds, date);

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    item_type: r.item_type,
    subject: r.subject || 'other',
    status: r.sub_status || 'pending',
    score: r.sub_score != null ? r.sub_score : null,
    is_correct: r.sub_correct,
    submission_id: r.submission_id,
  }));
}

module.exports = { getFamilyUserIds, getFamilyChildIds, getItemsForDate, dayjs, getDb };
