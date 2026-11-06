const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');
const { csrf } = require('./middleware');

const ALLOWED = /\.(pdf|docx?|pptx?|xlsx?|mp3|m4a|wav|ogg|mp4|webm|png|jpe?g|gif|webp|txt)$/i;

const storage = multer.diskStorage({
  destination: path.join(DATA_DIR, 'uploads'),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
});

const uploader = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.test(file.originalname)),
});

// upload d'un fichier + vérification CSRF après analyse du formulaire
const single = field => [uploader.single(field), csrf];

module.exports = { single };
