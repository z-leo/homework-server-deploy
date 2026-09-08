const { dayjs } = require('./homework-helpers');

// Compute family-wide stats for the given child ids.
function computeStats(db, childIds) {
  const ph = childIds.map(() => '?').join(',');
  const args = childIds;

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM submissions WHERE child_id IN (${ph})`)
    .get(...args).c;
  const graded = db
    .prepare(`SELECT COUNT(*) AS c FROM submissions WHERE child_id IN (${ph}) AND status = 'graded'`)
    .get(...args).c;
  const correct = db
    .prepare(`SELECT COUNT(*) AS c FROM submissions WHERE child_id IN (${ph}) AND is_correct = 1`)
    .get(...args).c;
  const avg = db
    .prepare(
      `SELECT AVG(score) AS a FROM submissions WHERE child_id IN (${ph}) AND status = 'graded' AND score IS NOT NULL`
    )
    .get(...args).a;

  const accuracyRate = graded > 0 ? correct / graded : 0;

  // Distinct dates that have at least one graded submission
  const rows = db
    .prepare(
      `SELECT DISTINCT da.date AS date
       FROM submissions s
       JOIN assignment_items ai ON s.item_id = ai.id
       JOIN daily_assignments da ON ai.assignment_id = da.id
       WHERE s.child_id IN (${ph}) AND s.status = 'graded'`
    )
    .all(...args)
    .map((r) => r.date)
    .sort();

  let currentStreak = 0;
  let longestStreak = 0;
  if (rows.length > 0) {
    let run = 1;
    longestStreak = 1;
    for (let i = 1; i < rows.length; i++) {
      if (dayjs(rows[i]).diff(dayjs(rows[i - 1]), 'day') === 1) {
        run++;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 1;
      }
    }
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const last = rows[rows.length - 1];
    if (last === today || last === yesterday) {
      currentStreak = 1;
      for (let i = rows.length - 2; i >= 0; i--) {
        if (dayjs(rows[i + 1]).diff(dayjs(rows[i]), 'day') === 1) currentStreak++;
        else break;
      }
    }
  }

  return {
    total_submissions: total,
    graded_submissions: graded,
    correct_submissions: correct,
    accuracy_rate: Math.round(accuracyRate * 100) / 100,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    average_score: avg ? Math.round(avg * 10) / 10 : 0,
  };
}

module.exports = { computeStats };
