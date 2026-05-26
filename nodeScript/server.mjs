/**
 * nodeScript 本地服务：静态页面 + GIF 转 Lottie API
 * 启动：npm start  →  http://localhost:3920
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { gifBufferToLottie } from './lib/gifToLottie.mjs';
import { saveLottieResult, loadLottieResult } from './lib/resultCache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3920;
/** 上传上限（MB），可按机器内存适当调大 */
const MAX_UPLOAD_MB = 150;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));
/** 仓库根目录 js/（lottie.min.js 等） */
app.use('/js', express.static(path.join(__dirname, '..', 'js')));

function parseConvertOptions(body) {
  const maxFrames = parseInt(body.maxFrames, 10) || 0;
  const fps = parseInt(body.fps, 10) || 30;
  const opts = { fps };
  if (maxFrames > 0) opts.maxFrames = maxFrames;
  return opts;
}

/** 预览 / 下载：按 id 读取缓存的 Lottie JSON */
app.get('/api/lottie-result/:id', (req, res) => {
  const payload = loadLottieResult(req.params.id);
  if (!payload) {
    return res.status(404).json({ ok: false, message: '结果不存在或已过期' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(payload.lottie);
});

app.get('/api/lottie-result/:id/download', (req, res) => {
  const payload = loadLottieResult(req.params.id);
  if (!payload) {
    return res.status(404).json({ ok: false, message: '结果不存在或已过期' });
  }
  const base = sanitizeDownloadBaseName(req.query.name || 'output');
  const filename = `${base}.lottie.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(JSON.stringify(payload.lottie, null, 2));
});

/** 下载文件名消毒（不含扩展名） */
function sanitizeDownloadBaseName(name) {
  return String(name)
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.gif$/i, '')
    .replace(/\.lottie\.json$/i, '')
    .trim() || 'output';
}

/** 带帧处理进度的流式响应（NDJSON，完成时只返回缓存 id） */
app.post('/api/gif-to-lottie', upload.single('file'), async (req, res) => {
  const useStream = req.query.stream === '1';

  try {
    if (!req.file) {
      if (useStream) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.write(`${JSON.stringify({ type: 'error', message: '请上传 GIF 文件' })}\n`);
        return res.end();
      }
      return res.status(400).json({ ok: false, message: '请上传 GIF 文件' });
    }

    const opts = parseConvertOptions(req.body);

    const runConvert = async (onProgress) => {
      const { lottie, meta } = await gifBufferToLottie(req.file.buffer, {
        ...opts,
        onProgress
      });
      const gifSize = req.file.size;
      const { id, meta: savedMeta } = saveLottieResult(lottie, { ...meta, gifSize });
      return { id, meta: savedMeta };
    };

    if (useStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders?.();

      const write = (obj) => res.write(`${JSON.stringify(obj)}\n`);

      write({ type: 'progress', phase: 'convert', current: 0, total: 0 });

      const { id, meta } = await runConvert((current, total) => {
        write({ type: 'progress', phase: 'convert', current, total });
      });

      write({ type: 'done', ok: true, id, meta });
      return res.end();
    }

    const { id, meta } = await runConvert();
    res.json({ ok: true, id, meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (useStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.write(`${JSON.stringify({ type: 'error', message })}\n`);
      return res.end();
    }
    res.status(500).json({ ok: false, message });
  }
});

/** Multer 等上传错误友好提示 */
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      message: `文件过大，请小于 ${MAX_UPLOAD_MB} MB，或减少「最大帧数」`
    });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ ok: false, message: err.message });
  }
  next(err);
});

const server = app.listen(PORT, () => {
  console.log(`nodeScript 已启动: http://localhost:${PORT}（上传上限 ${MAX_UPLOAD_MB}MB）`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
