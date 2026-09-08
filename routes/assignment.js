const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getFamilyChildIds, getItemsForDate, dayjs } = require('../services/homework-helpers');

const router = express.Router();

// GET /today - today's flattened items for the family's child(ren)
router.get('/today', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const today = dayjs().format('YYYY-MM-DD');
    const childIds = getFamilyChildIds(db, req.user.id);
    const items = getItemsForDate(db, childIds, today);
    res.json({ success: true, data: { date: today, items } });
  } catch (err) {
    console.error('[Assignment] today error:', err.message);
    res.status(500).json({ success: false, message: '获取今日作业失败' });
  }
});

// GET /item/:id - single assignment item detail
router.get('/item/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ai.id AS id, ai.content AS content, ai.item_type AS item_type,
                ai.correct_answer AS correct_answer, t.subject AS subject
         FROM assignment_items ai
         JOIN daily_assignments da ON ai.assignment_id = da.id
         LEFT JOIN homework_templates t ON da.template_id = t.id
         WHERE ai.id = ?`
      )
      .get(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: '作业项目不存在' });
    res.json({
      success: true,
      data: {
        id: row.id,
        content: row.content,
        item_type: row.item_type,
        subject: row.subject || 'other',
      },
    });
  } catch (err) {
    console.error('[Assignment] item error:', err.message);
    res.status(500).json({ success: false, message: '获取作业项目失败' });
  }
});

// POST /create - create today's assignment (from a template and/or manual items)
// child_id optional; defaults to the first child in the family (or the current user)
router.post('/create', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { template_id, items, date, child_id } = req.body;

    const assignmentDate = date || dayjs().format('YYYY-MM-DD');
    let targetChild = child_id;
    if (!targetChild) {
      const ids = getFamilyChildIds(db, req.user.id);
      targetChild = ids[0];
    }

    const tx = db.transaction(() => {
      const r = db
        .prepare('INSERT INTO daily_assignments (user_id, template_id, date) VALUES (?, ?, ?)')
        .run(targetChild, template_id || null, assignmentDate);
      const aid = r.lastInsertRowid;
      const ins = db.prepare(
        'INSERT INTO assignment_items (assignment_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
      );
      if (template_id) {
        const tItems = db
          .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
          .all(template_id);
        tItems.forEach((it) =>
          ins.run(aid, it.content, it.item_type, it.correct_answer, it.sort_order)
        );
      }
      if (Array.isArray(items)) {
        items.forEach((it, i) =>
          ins.run(aid, it.content || '', it.item_type || 'text', it.correct_answer || '', it.sort_order != null ? it.sort_order : i)
        );
      }
      return aid;
    });
    const aid = tx();
    const a = db.prepare('SELECT * FROM daily_assignments WHERE id = ?').get(aid);
    const aItems = db
      .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
      .all(aid);
    res.json({ success: true, data: { ...a, items: aItems } });
  } catch (err) {
    console.error('[Assignment] create error:', err.message);
    res.status(500).json({ success: false, message: '创建作业失败' });
  }
});

module.exports = router;
