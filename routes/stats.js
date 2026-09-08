const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getFamilyChildIds } = require('../services/homework-helpers');
const { computeStats } = require('../services/stats');

const router = express.Router();

// GET /streak -> { streak }
router.get('/streak', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const childIds = getFamilyChildIds(db, req.user.id);
    const s = computeStats(db, childIds);
    res.json({ success: true, data: { streak: s.current_streak, longest_streak: s.longest_streak } });
  } catch (err) {
    console.error('[Stats] streak error:', err.message);
    res.status(500).json({ success: false, message: '获取连续打卡失败' });
  }
});

// GET /summary -> { streak, total_submissions, accuracy_rate, longest_streak, average_score }
router.get('/summary', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const childIds = getFamilyChildIds(db, req.user.id);
    const s = computeStats(db, childIds);
    res.json({
      success: true,
      data: {
        streak: s.current_streak,
        total_submissions: s.total_submissions,
        graded_submissions: s.graded_submissions,
        accuracy_rate: s.accuracy_rate,
        longest_streak: s.longest_streak,
        average_score: s.average_score,
      },
    });
  } catch (err) {
    console.error('[Stats] summary error:', err.message);
    res.status(500).json({ success: false, message: '获取统计信息失败' });
  }
});

module.exports = router;
