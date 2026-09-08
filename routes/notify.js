const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const serverConfig = require('../config');
const { sendNotification } = require('../services/notification');

const router = express.Router();

// POST /test { serverChanKey } - save the key and send a test push
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    let key = req.body && req.body.serverChanKey ? String(req.body.serverChanKey).trim() : '';
    if (!key) {
      const row = db.prepare("SELECT value FROM app_config WHERE key = 'serverChanKey'").get();
      key = row ? row.value : '';
    }
    if (!key) return res.status(400).json({ success: false, message: '请先配置 Server酱 Key' });

    // Persist the key
    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run('serverChanKey', key);

    const original = serverConfig.serverChanKey;
    serverConfig.serverChanKey = key;
    let result;
    try {
      result = await sendNotification(
        '作业小助手 - 测试通知',
        '## 测试通知\n\n恭喜！Server酱通知配置成功。\n\n当孩子作业批改完成后，您将收到每日作业报告推送。\n\n---\n来自「作业小助手」'
      );
    } finally {
      serverConfig.serverChanKey = original;
    }

    if (result && result.success) {
      res.json({ success: true, data: { message: '测试通知已发送' } });
    } else {
      res.status(502).json({ success: false, message: '推送失败: ' + (result && result.message) });
    }
  } catch (err) {
    console.error('[Notify] test error:', err.message);
    res.status(500).json({ success: false, message: '测试通知失败' });
  }
});

module.exports = router;
