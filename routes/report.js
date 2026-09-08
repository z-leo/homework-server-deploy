const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getFamilyChildIds, getItemsForDate, dayjs } = require('../services/homework-helpers');
const { computeStats } = require('../services/stats');

const router = express.Router();

// GET /daily?date=YYYY-MM-DD
router.get('/daily', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const date = req.query.date || dayjs().format('YYYY-MM-DD');
    const childIds = getFamilyChildIds(db, req.user.id);
    const items = getItemsForDate(db, childIds, date);

    // Aggregate AI summary from that day's reports
    const ph = childIds.map(() => '?').join(',');
    const reports = db
      .prepare(
        `SELECT dr.* FROM daily_reports dr
         JOIN daily_assignments da ON dr.assignment_id = da.id
         WHERE da.user_id IN (${ph}) AND da.date = ?`
      )
      .all(...childIds, date);

    const aiSummary = reports.map((r) => r.ai_summary).filter(Boolean).join('\n');
    const graded = items.filter((i) => i.status === 'graded' && i.score != null);
    const score = graded.length
      ? Math.round(graded.reduce((s, i) => s + i.score, 0) / graded.length)
      : 0;
    const stats = computeStats(db, childIds);

    res.json({
      success: true,
      data: {
        date,
        score,
        items,
        ai_summary: aiSummary,
        streak: stats.current_streak,
      },
    });
  } catch (err) {
    console.error('[Report] daily error:', err.message);
    res.status(500).json({ success: false, message: '获取日报失败' });
  }
});

// GET /monthly?year=YYYY&month=M
router.get('/monthly', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success: false, message: '缺少 year/month 参数' });
    const m = String(month).padStart(2, '0');
    const monthStr = `${year}-${m}`;
    const startDate = `${monthStr}-01`;
    const endDate = dayjs(startDate).endOf('month').format('YYYY-MM-DD');

    const childIds = getFamilyChildIds(db, req.user.id);
    const ph = childIds.map(() => '?').join(',');

    const reports = db
      .prepare(
        `SELECT dr.*, da.date AS date FROM daily_reports dr
         JOIN daily_assignments da ON dr.assignment_id = da.id
         WHERE da.user_id IN (${ph}) AND da.date >= ? AND da.date <= ?
         ORDER BY da.date ASC`
      )
      .all(...childIds, startDate, endDate);

    const daily = reports.map((r) => ({
      date: r.date,
      completion_rate: r.completion_rate,
      accuracy_rate: r.accuracy_rate,
      score: Math.round((r.accuracy_rate || 0) * 100),
    }));

    const activeDays = daily.filter((d) => d.completion_rate > 0).length;
    const avgScore = daily.length
      ? Math.round(daily.reduce((s, d) => s + d.score, 0) / daily.length)
      : 0;
    const totalSubmissions = reports.reduce((s, r) => s + (r.completed_items || 0), 0);

    res.json({
      success: true,
      data: {
        total_days: daily.length,
        active_days: activeDays,
        avg_score: avgScore,
        total_submissions: totalSubmissions,
        daily,
      },
    });
  } catch (err) {
    console.error('[Report] monthly error:', err.message);
    res.status(500).json({ success: false, message: '获取月报失败' });
  }
});

module.exports = router;
