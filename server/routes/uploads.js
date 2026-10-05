'use strict';
/** 图片上传：菜品封面、步骤配图、进度过程照片 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../lib/db');
const { MAX_IMAGE_BYTES } = require('../lib/domain');
const { fail, ok, requireMember } = require('../lib/helpers');

const router = express.Router();

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // 随机文件名，避免用户输入进入路径
    const name = crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.bin');
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

router.post('/uploads', requireMember, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 400, '图片过大，请压缩后上传');
      if (err.message === 'UNSUPPORTED_TYPE') return fail(res, 400, '仅支持 JPG / PNG / WebP / GIF 图片');
      return fail(res, 400, '图片上传失败，请重试');
    }
    if (!req.file) return fail(res, 400, '请选择要上传的图片');
    return ok(res, {
      url: `/uploads/${path.basename(req.file.filename)}`,
      size: req.file.size,
    });
  });
});

module.exports = router;
