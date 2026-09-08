const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /generate-code { code? } - parent sets/generates the family code
router.post('/generate-code', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ success: false, message: '只有家长才能生成家庭码' });
    }
    const db = getDb();
    let code = (req.body && req.body.code ? String(req.body.code) : '').trim().toUpperCase();
    if (!code) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      code = '';
      for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    db.prepare('UPDATE users SET family_code = ? WHERE id = ?').run(code, req.user.id);
    res.json({ success: true, data: { message: '家庭码已生成', familyCode: code } });
  } catch (err) {
    console.error('[Family] generate-code error:', err.message);
    res.status(500).json({ success: false, message: '生成家庭码失败' });
  }
});

// POST /join { code } - join a family by its code
router.post('/join', authMiddleware, (req, res) => {
  try {
    const code = (req.body && req.body.code ? String(req.body.code) : '').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: '请输入家庭码' });
    const db = getDb();
    const parent = db
      .prepare("SELECT id FROM users WHERE family_code = ? AND role = 'parent'")
      .get(code);
    if (!parent) return res.status(404).json({ success: false, message: '家庭码无效或不存在' });
    db.prepare('UPDATE users SET family_code = ? WHERE id = ?').run(code, req.user.id);
    res.json({ success: true, data: { message: '加入家庭成功' } });
  } catch (err) {
    console.error('[Family] join error:', err.message);
    res.status(500).json({ success: false, message: '加入家庭失败' });
  }
});

module.exports = router;
