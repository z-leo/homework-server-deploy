const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getFamilyUserIds } = require('../services/homework-helpers');

const router = express.Router();

// GET / - list active templates (with items)
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const ids = getFamilyUserIds(db, req.user.id);
    const ph = ids.map(() => '?').join(',');
    const templates = db
      .prepare(
        `SELECT * FROM homework_templates WHERE user_id IN (${ph}) AND is_active = 1 ORDER BY created_at DESC`
      )
      .all(...ids);
    const result = templates.map((t) => {
      const items = db
        .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
        .all(t.id);
      return { ...t, items };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Templates] list error:', err.message);
    res.status(500).json({ success: false, message: '获取模板列表失败' });
  }
});

// GET /:id - single template (with items)
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: '模板不存在' });
    const items = db
      .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
      .all(t.id);
    res.json({ success: true, data: { ...t, items } });
  } catch (err) {
    console.error('[Templates] get error:', err.message);
    res.status(500).json({ success: false, message: '获取模板失败' });
  }
});

// POST / - create template with items
router.post('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { name, subject, icon, color, items } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '模板名称不能为空' });

    const tx = db.transaction(() => {
      const r = db
        .prepare(
          'INSERT INTO homework_templates (user_id, name, subject, icon, color) VALUES (?, ?, ?, ?, ?)'
        )
        .run(req.user.id, name, subject || 'other', icon || '📌', color || '#98D8C8');
      const tid = r.lastInsertRowid;
      if (Array.isArray(items)) {
        const ins = db.prepare(
          'INSERT INTO template_items (template_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        items.forEach((it, i) =>
          ins.run(tid, it.content || '', it.item_type || 'text', it.correct_answer || '', it.sort_order != null ? it.sort_order : i)
        );
      }
      return tid;
    });
    const tid = tx();
    const t = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(tid);
    const tItems = db
      .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
      .all(tid);
    res.json({ success: true, data: { ...t, items: tItems } });
  } catch (err) {
    console.error('[Templates] create error:', err.message);
    res.status(500).json({ success: false, message: '创建模板失败' });
  }
});

// PUT /:id - update template + items
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, subject, icon, color, items } = req.body;
    const t = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(id);
    if (!t) return res.status(404).json({ success: false, message: '模板不存在' });

    const tx = db.transaction(() => {
      db.prepare(
        'UPDATE homework_templates SET name = COALESCE(?, name), subject = COALESCE(?, subject), icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?'
      ).run(name, subject, icon, color, id);
      if (Array.isArray(items)) {
        db.prepare('DELETE FROM template_items WHERE template_id = ?').run(id);
        const ins = db.prepare(
          'INSERT INTO template_items (template_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        items.forEach((it, i) =>
          ins.run(id, it.content || '', it.item_type || 'text', it.correct_answer || '', it.sort_order != null ? it.sort_order : i)
        );
      }
    });
    tx();
    const updated = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(id);
    const updatedItems = db
      .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
      .all(id);
    res.json({ success: true, data: { ...updated, items: updatedItems } });
  } catch (err) {
    console.error('[Templates] update error:', err.message);
    res.status(500).json({ success: false, message: '更新模板失败' });
  }
});

// DELETE /:id - soft delete
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: '模板不存在' });
    db.prepare('UPDATE homework_templates SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, data: { message: '模板已删除' } });
  } catch (err) {
    console.error('[Templates] delete error:', err.message);
    res.status(500).json({ success: false, message: '删除模板失败' });
  }
});

module.exports = router;
