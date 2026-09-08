const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { gradeSubmission } = require('../services/ai-grading');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const monthDir = new Date().toISOString().slice(0, 7);
    const fullDir = path.join(__dirname, '..', config.uploadDir, monthDir);
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
    cb(null, fullDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const random = Math.random().toString(36).substring(2, 8);
    cb(null, `${Date.now()}_${random}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    if (extname || mimetype) cb(null, true);
    else cb(new Error('只允许上传图片文件'));
  },
});

// Normalize image entries: accept ["url"] or [{url:"..."}]
function normalizeImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === 'string' ? x : x && x.url ? x.url : null))
    .filter(Boolean);
}

async function performGrading(submissionId) {
  const db = getDb();
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  if (!submission) return;
  const item = db.prepare('SELECT * FROM assignment_items WHERE id = ?').get(submission.item_id);
  if (!item) {
    db.prepare("UPDATE submissions SET status = 'failed', feedback = ? WHERE id = ?").run(
      '作业项目不存在',
      submissionId
    );
    return;
  }
  try {
    const imageUrls = JSON.parse(submission.image_urls || '[]');
    if (imageUrls.length === 0) throw new Error('没有上传图片');
    const imagePath = path.join(__dirname, '..', imageUrls[0]);
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const result = await gradeSubmission(imageBase64, {
      content: item.content,
      item_type: item.item_type,
      correct_answer: item.correct_answer,
    });
    db.prepare(
      "UPDATE submissions SET status = 'graded', ai_result = ?, is_correct = ?, score = ?, feedback = ?, graded_at = datetime('now') WHERE id = ?"
    ).run(
      JSON.stringify(result),
      result.items.every((i) => i.is_correct) ? 1 : 0,
      result.score,
      result.comment,
      submissionId
    );
    console.log('[Grading] Submission graded:', submissionId);
  } catch (err) {
    console.error('[Grading] failed', submissionId, ':', err.message);
    db.prepare("UPDATE submissions SET status = 'failed', feedback = ? WHERE id = ?").run(
      '批改失败，请重试: ' + err.message,
      submissionId
    );
  }
}

// POST /upload - upload one image, returns { url }
router.post('/upload', authMiddleware, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择图片' });
    const monthDir = new Date().toISOString().slice(0, 7);
    const url = `/uploads/${monthDir}/${req.file.filename}`;
    res.json({ success: true, data: { url } });
  } catch (err) {
    console.error('[Submit] upload error:', err.message);
    res.status(500).json({ success: false, message: '上传失败' });
  }
});

// GET /result/:itemId - latest grading result for this item (client contract)
router.get('/result/:itemId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const submission = db
      .prepare(
        'SELECT * FROM submissions WHERE item_id = ? AND child_id = ? ORDER BY submitted_at DESC LIMIT 1'
      )
      .get(req.params.itemId, req.user.id);
    if (!submission) return res.status(404).json({ success: false, message: '未找到提交记录' });

    const item = db
      .prepare(
        `SELECT ai.content AS content, t.subject AS subject
         FROM assignment_items ai
         JOIN daily_assignments da ON ai.assignment_id = da.id
         LEFT JOIN homework_templates t ON da.template_id = t.id
         WHERE ai.id = ?`
      )
      .get(submission.item_id);

    let aiResult = null;
    if (submission.ai_result) {
      try {
        aiResult = JSON.parse(submission.ai_result);
        // Client result page reads ai_result.details; server stores items. Alias for compat.
        if (aiResult && Array.isArray(aiResult.items) && aiResult.details == null) {
          aiResult.details = aiResult.items;
        }
      } catch (e) {
        aiResult = null;
      }
    }

    res.json({
      success: true,
      data: {
        id: submission.id,
        status: submission.status,
        is_correct: submission.is_correct,
        score: submission.score,
        feedback: submission.feedback,
        content: item ? item.content : '',
        subject: item ? item.subject || 'other' : 'other',
        ai_result: aiResult,
        images: JSON.parse(submission.image_urls || '[]'),
        submitted_at: submission.submitted_at,
        graded_at: submission.graded_at,
      },
    });
  } catch (err) {
    console.error('[Submit] result error:', err.message);
    res.status(500).json({ success: false, message: '获取批改结果失败' });
  }
});

// POST /:itemId - submit homework item (accepts { images } or { image_urls })
router.post('/:itemId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { itemId } = req.params;
    const images = normalizeImages(req.body.images || req.body.image_urls);
    if (images.length === 0) return res.status(400).json({ success: false, message: '请上传图片' });

    const item = db.prepare('SELECT * FROM assignment_items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ success: false, message: '作业项目不存在' });

    const r = db
      .prepare('INSERT INTO submissions (item_id, child_id, image_urls, status) VALUES (?, ?, ?, ?)')
      .run(itemId, req.user.id, JSON.stringify(images), 'pending');
    const submissionId = r.lastInsertRowid;

    db.prepare("UPDATE daily_assignments SET status = 'in_progress' WHERE id = ? AND status = 'pending'").run(
      item.assignment_id
    );

    performGrading(submissionId).catch((err) => console.error('[Submit] async grading:', err.message));

    res.json({ success: true, data: { submission_id: submissionId, status: 'pending' } });
  } catch (err) {
    console.error('[Submit] submit error:', err.message);
    res.status(500).json({ success: false, message: '提交失败' });
  }
});

module.exports = router;
