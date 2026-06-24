import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import dotenv from 'dotenv';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const execPromise = promisify(exec);

// Helper function to check audio codec and transcode if needed (e.g., ALAC -> AAC, CAF -> M4A)
async function checkAndTranscodeAudio(file, log = () => {}) {
  const filePath = file.path;
  const ext = path.extname(filePath).toLowerCase();
  
  // 1. If it's a .caf file, transcode it to .m4a (standard AAC)
  if (ext === '.caf') {
    log('Transcoding .caf to M4A...');
    console.log(`.caf audio detected. Transcoding to M4A...`);
    const newFilename = file.filename.replace(/\.caf$/i, '.m4a');
    const newFilePath = path.join(path.dirname(filePath), newFilename);
    
    try {
      const ffmpegCmd = `ffmpeg -y -i "${filePath}" -c:a aac -b:a 192k "${newFilePath}"`;
      await execPromise(ffmpegCmd);
      
      // Delete original .caf file
      await fs.promises.unlink(filePath);
      
      // Update file object properties
      file.path = newFilePath;
      file.filename = newFilename;
      file.mimetype = 'audio/mp4';
      return { success: true, originalNameExtension: '.m4a' };
    } catch (err) {
      console.error('Error transcoding .caf to .m4a:', err);
    }
  }
  
  // 2. If it's a .m4a file, check if codec is ALAC and transcode to AAC in-place
  if (ext === '.m4a') {
    try {
      const ffprobeCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      const { stdout } = await execPromise(ffprobeCmd);
      const codec = stdout.trim();
      
      if (codec === 'alac') {
        log('Transcoding ALAC to AAC...');
        console.log(`ALAC audio detected inside M4A. Transcoding to AAC...`);
        const tempPath = filePath + '.tmp.m4a';
        const ffmpegCmd = `ffmpeg -y -i "${filePath}" -c:a aac -b:a 192k "${tempPath}"`;
        await execPromise(ffmpegCmd);
        
        // Replace original file with the transcoded one
        await fs.promises.rename(tempPath, filePath);
        console.log(`Transcoding successful. Replaced original ALAC file with AAC.`);
      }
    } catch (err) {
      console.error('Error checking/transcoding ALAC to AAC:', err);
    }
  }

  // 3. If it's a wav, flac, aif, or aiff file, transcode it to mp3 (standard compressed)
  if (['.wav', '.flac', '.aif', '.aiff'].includes(ext)) {
    log(`Transcoding ${ext} to MP3...`);
    console.log(`${ext} audio detected. Transcoding to MP3...`);
    const newFilename = file.filename.replace(new RegExp(`${ext}$`, 'i'), '.mp3');
    const newFilePath = path.join(path.dirname(filePath), newFilename);
    
    try {
      const ffmpegCmd = `ffmpeg -y -i "${filePath}" -codec:a libmp3lame -qscale:a 2 "${newFilePath}"`;
      await execPromise(ffmpegCmd);
      
      // Delete original WAV/FLAC file
      await fs.promises.unlink(filePath);
      
      // Update file object properties
      file.path = newFilePath;
      file.filename = newFilename;
      file.mimetype = 'audio/mpeg';
      return { success: true, originalNameExtension: '.mp3' };
    } catch (err) {
      console.error(`Error transcoding ${ext} to .mp3:`, err);
    }
  }
  
  return null;
}

// Extract peaks (0-1 float array) and duration using ffmpeg & ffprobe
async function extractPeaksAndDuration(filePath, log = () => {}) {
  try {
    // 1. Get audio duration with ffprobe
    log("Extracting waveform data...");
    const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const { stdout } = await execPromise(ffprobeCmd);
    const duration = parseFloat(stdout.trim());
    
    // 2. Extract PCM stream using ffmpeg to calculate peak data
    const peaks = await new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-v', 'error',
        '-i', filePath,
        '-f', 's16le',
        '-ac', '1',
        '-ar', '8000',
        '-'
      ]);

      const chunks = [];
      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        const buffer = Buffer.concat(chunks);
        const sampleCount = Math.floor(buffer.length / 2);
        
        if (sampleCount === 0) {
          resolve([]);
          return;
        }

        const samples = new Float32Array(sampleCount);
        let maxVal = 0;
        for (let i = 0; i < sampleCount; i++) {
          const val = buffer.readInt16LE(i * 2) / 32768.0;
          samples[i] = val;
          const absVal = Math.abs(val);
          if (absVal > maxVal) {
            maxVal = absVal;
          }
        }

        const targetPoints = 200;
        const step = Math.max(1, Math.floor(sampleCount / targetPoints));
        const peakData = [];

        for (let i = 0; i < sampleCount; i += step) {
          let windowMax = 0;
          const end = Math.min(i + step, sampleCount);
          for (let j = i; j < end; j++) {
            const abs = Math.abs(samples[j]);
            if (abs > windowMax) {
              windowMax = abs;
            }
          }
          peakData.push(maxVal > 0 ? parseFloat((windowMax / maxVal).toFixed(4)) : 0);
        }
        resolve(peakData);
      });

      ffmpeg.on('error', (err) => {
        console.error('ffmpeg process error:', err);
        resolve(null);
      });
    });

    return {
      peaks: peaks || [],
      duration: isNaN(duration) ? 0 : duration
    };
  } catch (err) {
    console.error('Error in extractPeaksAndDuration:', err);
    return null;
  }
}

// Resize image to max 800px width and convert to WebP using sharp
async function processImage(file, log = () => {}) {
  const filePath = file.path;
  const ext = path.extname(filePath).toLowerCase();
  
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) {
    let sourceFilePath = filePath;
    if (ext === '.heic' || ext === '.heif') {
      const jpgPath = filePath + '.jpg';
      try {
        const inputBuffer = await fs.promises.readFile(filePath);
        const outputBuffer = await heicConvert({
          buffer: inputBuffer,
          format: 'JPEG',
          quality: 1
        });
        await fs.promises.writeFile(jpgPath, outputBuffer);
        sourceFilePath = jpgPath;
      } catch (err) {
        console.error('Error converting HEIC to JPG with heic-convert:', err);
        // Fallback or skip if conversion fails
      }
    }

    const newFilename = file.filename.substring(0, file.filename.length - ext.length) + '.webp';
    const newFilePath = path.join(path.dirname(filePath), newFilename);
    
    try {
      await sharp(sourceFilePath)
        .rotate()
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(newFilePath);
      
      // Delete original image file(s)
      await fs.promises.unlink(filePath).catch(() => {});
      if (sourceFilePath !== filePath) {
        await fs.promises.unlink(sourceFilePath).catch(() => {});
      }
      
      // Update file object properties
      file.path = newFilePath;
      file.filename = newFilename;
      file.mimetype = 'image/webp';
      
      return { success: true, originalNameExtension: '.webp' };
    } catch (err) {
      console.error('Error processing image with sharp:', err);
    }
  }
  return null;
}

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOAD_DIR 
  ? (path.isAbsolute(process.env.UPLOAD_DIR) ? process.env.UPLOAD_DIR : path.resolve(__dirname, process.env.UPLOAD_DIR))
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());

// Serve uploads folder statically
app.use('/uploads', express.static(uploadsDir));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000 * 1024 * 1024 } // Limit: 1000MB (1GB)
});

// --- REST API REST API Routes ---

// Check if admin password exists
app.get('/api/admin/has-password', async (req, res) => {
  try {
    const db = await getDb();
    const pwRow = await db.get('SELECT value FROM settings WHERE key = ?', 'adminPassword');
    const loginRow = await db.get('SELECT value FROM settings WHERE key = ?', 'requireAdminLogin');
    res.json({ 
      hasPassword: !!(pwRow && pwRow.value),
      requireAdminLogin: loginRow ? loginRow.value === 'true' : false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle requiring password on entry
app.post('/api/admin/set-require-login', async (req, res) => {
  try {
    const db = await getDb();
    const { requireAdminLogin } = req.body;
    await db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      'requireAdminLogin',
      requireAdminLogin ? 'true' : 'false'
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify admin password
app.post('/api/admin/verify-password', async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body;
    const row = await db.get('SELECT value FROM settings WHERE key = ?', 'adminPassword');
    if (!row || !row.value) {
      return res.json({ success: true });
    }
    if (row.value === password) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Incorrect password' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set or change admin password
app.post('/api/admin/set-password', async (req, res) => {
  try {
    const db = await getDb();
    const { oldPassword, newPassword } = req.body;
    const row = await db.get('SELECT value FROM settings WHERE key = ?', 'adminPassword');
    
    if (row && row.value) {
      if (row.value !== oldPassword) {
        return res.json({ success: false, error: 'Incorrect current password' });
      }
    }
    
    if (!newPassword || newPassword.trim() === '') {
      await db.run('DELETE FROM settings WHERE key = ?', 'adminPassword');
      await db.run('DELETE FROM settings WHERE key = ?', 'requireAdminLogin');
    } else {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'adminPassword', newPassword);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to get directory size recursively
async function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        size += await getDirSize(filePath);
      } else {
        const stats = await fs.promises.stat(filePath);
        size += stats.size;
      }
    }
  } catch (err) {
    // Ignore error if directory doesn't exist
  }
  return size;
}

// Get storage size of database and uploads
app.get('/api/admin/storage-size', async (req, res) => {
  try {
    const dbPath = process.env.DATABASE_PATH
      ? (path.isAbsolute(process.env.DATABASE_PATH) ? process.env.DATABASE_PATH : path.resolve(__dirname, process.env.DATABASE_PATH))
      : path.join(__dirname, 'database.sqlite');

    let dbSize = 0;
    if (fs.existsSync(dbPath)) {
      const dbStats = await fs.promises.stat(dbPath);
      dbSize = dbStats.size;
    }

    const uploadsSize = await getDirSize(uploadsDir);

    res.json({ dbSize, uploadsSize });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Home settings
app.get('/api/settings', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT value FROM settings WHERE key = ?', 'homeSettings');
    res.json(JSON.parse(row.value));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Home settings
app.post('/api/settings', async (req, res) => {
  try {
    const db = await getDb();
    const newSettings = req.body;
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'homeSettings', JSON.stringify(newSettings));
    res.json({ success: true, settings: newSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pads', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT p.*,
             COUNT(m.id) AS memoCount,
             COALESCE(SUM(CASE WHEN m.audioUrl IS NOT NULL AND m.audioUrl != '' THEN 1 ELSE 0 END), 0) AS soundCount,
             COALESCE(SUM(CASE WHEN m.imageUrl IS NOT NULL AND m.imageUrl != '' THEN 1 ELSE 0 END), 0) AS sceneCount
      FROM pads p
      LEFT JOIN memos m ON p.id = m.padId
      GROUP BY p.id
    `);

    const parseCustomDate = (dateStr) => {
      if (!dateStr) return 0;
      const normalized = dateStr.replace(/\./g, '-');
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    const memosData = await db.all('SELECT padId, author, date, id FROM memos');
    const lastMemoByPad = {};
    for (const m of memosData) {
      const parsedDate = parseCustomDate(m.date);
      if (!lastMemoByPad[m.padId]) {
        lastMemoByPad[m.padId] = { ...m, parsedDate };
      } else {
        if (parsedDate > lastMemoByPad[m.padId].parsedDate || (parsedDate === lastMemoByPad[m.padId].parsedDate && m.id > lastMemoByPad[m.padId].id)) {
          lastMemoByPad[m.padId] = { ...m, parsedDate };
        }
      }
    }

    for (const row of rows) {
      const lastMemo = lastMemoByPad[row.id];
      if (lastMemo) {
        row.lastAuthor = lastMemo.author;
        row.lastDate = lastMemo.date;
      } else {
        row.lastAuthor = null;
        row.lastDate = row.date;
      }
    }

    rows.sort((a, b) => parseCustomDate(b.lastDate || b.date) - parseCustomDate(a.lastDate || a.date));

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single pad with all its memos
app.get('/api/pads/:padId', async (req, res) => {
  try {
    const db = await getDb();
    const { padId } = req.params;
    const pad = await db.get('SELECT * FROM pads WHERE id = ?', padId);
    
    // Even if pad doesn't exist in 'pads' table, check if there's a legacy createdAt_ in localStorage equivalent
    // In our system, if pad is requested, we retrieve it.
    if (!pad) {
      return res.status(404).json({ error: 'Pad not found' });
    }
    
    const memos = await db.all('SELECT * FROM memos WHERE padId = ?', padId);

    const parsedMemos = memos.map(m => {
      let waveformPeaks = null;
      if (m.waveformPeaks) {
        try {
          waveformPeaks = JSON.parse(m.waveformPeaks);
        } catch (e) {
          console.error('Failed to parse waveformPeaks:', e);
        }
      }
      return {
        ...m,
        waveformPeaks
      };
    });

    const comments = await db.all('SELECT * FROM comments WHERE padId = ?', padId);

    res.json({ pad, memos: parsedMemos, comments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new pad (Admin)
app.post('/api/pads', async (req, res) => {
  try {
    const db = await getDb();
    const { id, title, date, canvasBgColor, outerBgColor, titleColor, isPrivate } = req.body;
    await db.run(
      'INSERT INTO pads (id, title, date, canvasBgColor, outerBgColor, titleColor, isPrivate) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, title, date, canvasBgColor, outerBgColor, titleColor, isPrivate ? 1 : 0
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update pad colors/metadata
app.put('/api/pads/:padId', async (req, res) => {
  try {
    const db = await getDb();
    const { padId } = req.params;
    const { title, canvasBgColor, outerBgColor, titleColor, isPrivate } = req.body;
    await db.run(
      'UPDATE pads SET title = ?, canvasBgColor = ?, outerBgColor = ?, titleColor = ?, isPrivate = ? WHERE id = ?',
      title, canvasBgColor, outerBgColor, titleColor, isPrivate ? 1 : 0, padId
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete pad and memos
app.delete('/api/pads/:padId', async (req, res) => {
  try {
    const db = await getDb();
    const { padId } = req.params;
    
    // Get all memos under the pad before deleting records
    const memos = await db.all('SELECT audioUrl, imageUrl FROM memos WHERE padId = ?', padId);

    await db.run('DELETE FROM pads WHERE id = ?', padId);
    await db.run('DELETE FROM memos WHERE padId = ?', padId);
    await db.run('DELETE FROM comments WHERE padId = ?', padId);

    // Delete physical files
    for (const memo of memos) {
      if (memo.audioUrl && memo.audioUrl.startsWith('/uploads/')) {
        const audioFilePath = path.join(__dirname, memo.audioUrl.replace(/^\//, ''));
        if (fs.existsSync(audioFilePath)) {
          fs.promises.unlink(audioFilePath).catch(err => console.error('Failed to delete physical audio file on pad delete:', err));
        }
      }
      if (memo.imageUrl && memo.imageUrl.startsWith('/uploads/')) {
        const imageFilePath = path.join(__dirname, memo.imageUrl.replace(/^\//, ''));
        if (fs.existsSync(imageFilePath)) {
          fs.promises.unlink(imageFilePath).catch(err => console.error('Failed to delete physical image file on pad delete:', err));
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const socketId = req.body.socketId;
  console.log('Upload received. socketId:', socketId);
  const log = (msg) => {
    console.log('log called with:', msg, 'socketId:', socketId, 'io exists:', typeof io !== 'undefined');
    if (socketId && typeof io !== 'undefined') {
      console.log('emitting socket event to', socketId, ':', msg);
      io.to(socketId).emit('upload:log', msg);
    }
  };
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Convert filename encoding from latin1 to utf-8 to support Korean/Unicode characters properly
  let originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  
  // Transcode audio or process image if necessary
  let isAudio = false;
  let isImage = false;
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (req.file.mimetype.startsWith('audio/') || ['.m4a', '.caf', '.mp3', '.wav', '.ogg', '.aac', '.flac'].includes(ext)) {
      isAudio = true;
      log('Checking audio format...');
      const transcodeResult = await checkAndTranscodeAudio(req.file, log);
      if (transcodeResult && transcodeResult.originalNameExtension) {
        // Update original filename extension to match transcoded file
        const originalExt = path.extname(originalName);
        originalName = originalName.substring(0, originalName.length - originalExt.length) + transcodeResult.originalNameExtension;
      }
    } else if (req.file.mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) {
      isImage = true;
      log('Checking image format...');
      const imageResult = await processImage(req.file, log);
      if (imageResult && imageResult.originalNameExtension) {
        // Update original filename extension to match webp image
        const originalExt = path.extname(originalName);
        originalName = originalName.substring(0, originalName.length - originalExt.length) + imageResult.originalNameExtension;
      }
      log("Saving to disk...");
    }
  } catch (err) {
    console.error('Failed to process/transcode uploaded file:', err);
  }

  // Return the relative URL of the file
  const fileUrl = `/uploads/${req.file.filename}`;

  // Extract audio peaks and duration if it's audio
  let waveformPeaks = null;
  if (isAudio) {
    try {
      waveformPeaks = await extractPeaksAndDuration(req.file.path, log);
      log("Saving to disk...");
    } catch (err) {
      console.error('Failed to extract audio peaks on upload:', err);
    }
  }

  res.json({ fileUrl, originalName, waveformPeaks });
});

// Serve static built frontend files in production (standalone execution support)
const distDir = path.join(__dirname, '../dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// --- Socket.IO Real-time Logic ---

// Keep track of active sockets, their users, and editing locks
const socketUsers = {}; // socket.id -> { padId, user: { name, color } }
const activeLocks = {}; // padId -> { memoId -> { socketId, username } }

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join a board room
  socket.on('join-room', ({ padId, user }) => {
    socket.join(padId);
    socketUsers[socket.id] = { padId, user };
    console.log(`User ${user.name} joined room: ${padId}`);

    // Update any locks held by this socket to the new username
    if (activeLocks[padId]) {
      Object.entries(activeLocks[padId]).forEach(([memoId, lockInfo]) => {
        if (lockInfo.socketId === socket.id) {
          lockInfo.username = user.name;
          socket.to(padId).emit('memo:locked', { id: Number(memoId), username: user.name });
        }
      });
    }

    // Send currently active locks in this room to the newly joined user
    if (activeLocks[padId]) {
      const locks = {};
      Object.entries(activeLocks[padId]).forEach(([memoId, info]) => {
        locks[memoId] = info.username;
      });
      socket.emit('locks-sync', locks);
    }
  });

  // Handle memo dragging (broadcast real-time position)
  socket.on('memo:move', async ({ padId, id, x, y }) => {
    socket.to(padId).emit('memo:moved', { id, x, y });
    
    // Also save to DB in the background
    try {
      const db = await getDb();
      await db.run('UPDATE memos SET x = ?, y = ? WHERE id = ? AND padId = ?', x, y, id, padId);
    } catch (e) {
      console.error('Failed to update memo coords in DB:', e);
    }
  });

  // Handle memo editing start (lock memo)
  socket.on('memo:edit-start', ({ padId, id, username }) => {
    if (!activeLocks[padId]) activeLocks[padId] = {};
    activeLocks[padId][id] = { socketId: socket.id, username };
    
    socket.to(padId).emit('memo:locked', { id, username });
  });

  // Handle memo editing end (unlock memo)
  socket.on('memo:edit-end', ({ padId, id }) => {
    if (activeLocks[padId] && activeLocks[padId][id]) {
      delete activeLocks[padId][id];
    }
    socket.to(padId).emit('memo:unlocked', { id });
  });

  // Handle memo publishing
  socket.on('memo:publish', async ({ padId, memo }) => {
    try {
      const db = await getDb();
      
      // Upsert memo in SQLite
      const existing = await db.get('SELECT id FROM memos WHERE id = ?', memo.id);
      if (existing) {
        await db.run(`
          UPDATE memos SET 
            title = ?, author = ?, content = ?, color = ?, date = ?, 
            x = ?, y = ?, z = ?, parentId = ?, titleColor = ?, 
            contentColor = ?, waveformColor = ?, audioUrl = ?, 
            audioFileName = ?, imageUrl = ?, imageFileName = ?,
            waveformPeaks = ?
          WHERE id = ? AND padId = ?
        `, 
        memo.title, memo.author, memo.content, memo.color, memo.date,
        memo.x, memo.y, memo.z, memo.parentId || null, memo.titleColor || null,
        memo.contentColor || null, memo.waveformColor || null, memo.audioUrl || null,
        memo.audioFileName || null, memo.imageUrl || null, memo.imageFileName || null,
        memo.waveformPeaks ? JSON.stringify(memo.waveformPeaks) : null,
        memo.id, padId);
      } else {
        await db.run(`
          INSERT INTO memos (
            id, padId, title, author, content, color, date, 
            x, y, z, parentId, titleColor, contentColor, 
            waveformColor, audioUrl, audioFileName, imageUrl, imageFileName,
            waveformPeaks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        memo.id, padId, memo.title, memo.author, memo.content, memo.color, memo.date,
        memo.x, memo.y, memo.z, memo.parentId || null, memo.titleColor || null,
        memo.contentColor || null, memo.waveformColor || null, memo.audioUrl || null,
        memo.audioFileName || null, memo.imageUrl || null, memo.imageFileName || null,
        memo.waveformPeaks ? JSON.stringify(memo.waveformPeaks) : null);
      }

      // Unlock memo since editing finished
      if (activeLocks[padId] && activeLocks[padId][memo.id]) {
        delete activeLocks[padId][memo.id];
      }

      // Broadcast published memo to others in the room
      socket.to(padId).emit('memo:published', memo);
    } catch (e) {
      console.error('Failed to save published memo:', e);
    }
  });

  // Handle memo deleting
  socket.on('memo:delete', async ({ padId, id }) => {
    try {
      const db = await getDb();
      
      // Get the memo's audio and image paths before deleting it from DB
      const memo = await db.get('SELECT audioUrl, imageUrl FROM memos WHERE id = ? AND padId = ?', id, padId);

      await db.run('DELETE FROM memos WHERE id = ? AND padId = ?', id, padId);
      await db.run('DELETE FROM comments WHERE memoId = ? AND padId = ?', id, padId);

      // Delete physical files
      if (memo) {
        if (memo.audioUrl && memo.audioUrl.startsWith('/uploads/')) {
          const audioFilePath = path.join(__dirname, memo.audioUrl.replace(/^\//, ''));
          if (fs.existsSync(audioFilePath)) {
            fs.promises.unlink(audioFilePath).catch(err => console.error('Failed to delete physical audio file on memo delete:', err));
          }
        }
        if (memo.imageUrl && memo.imageUrl.startsWith('/uploads/')) {
          const imageFilePath = path.join(__dirname, memo.imageUrl.replace(/^\//, ''));
          if (fs.existsSync(imageFilePath)) {
            fs.promises.unlink(imageFilePath).catch(err => console.error('Failed to delete physical image file on memo delete:', err));
          }
        }
      }
      
      if (activeLocks[padId] && activeLocks[padId][id]) {
        delete activeLocks[padId][id];
      }
      
      socket.to(padId).emit('memo:deleted', { id });
    } catch (e) {
      console.error('Failed to delete memo from DB:', e);
    }
  });

  // Handle comment creation
  socket.on('comment:create', async ({ padId, comment }) => {
    try {
      const db = await getDb();
      await db.run(
        'INSERT INTO comments (id, memoId, padId, author, content, date) VALUES (?, ?, ?, ?, ?, ?)',
        comment.id, comment.memoId, padId, comment.author, comment.content, comment.date
      );
      socket.to(padId).emit('comment:created', comment);
    } catch (e) {
      console.error('Failed to save comment:', e);
    }
  });

  // Handle comment deletion
  socket.on('comment:delete', async ({ padId, id }) => {
    try {
      const db = await getDb();
      await db.run('DELETE FROM comments WHERE id = ? AND padId = ?', id, padId);
      socket.to(padId).emit('comment:deleted', { id });
    } catch (e) {
      console.error('Failed to delete comment:', e);
    }
  });

  // Handle user mouse cursor positions
  socket.on('cursor:move', ({ padId, user, x, y }) => {
    socket.to(padId).emit('cursor:moved', { socketId: socket.id, user, x, y });
  });

  // Handle user leaving pad/cursor hide
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const userInfo = socketUsers[socket.id];
    if (userInfo) {
      const { padId, user } = userInfo;
      socket.to(padId).emit('cursor:removed', { socketId: socket.id });
      
      // Clean up locks created by this socket
      if (activeLocks[padId]) {
        Object.entries(activeLocks[padId]).forEach(([memoId, lockInfo]) => {
          if (lockInfo.socketId === socket.id) {
            delete activeLocks[padId][memoId];
            socket.to(padId).emit('memo:unlocked', { id: memoId });
          }
        });
      }
      delete socketUsers[socket.id];
    }
  });
});

async function migrateExistingAudioPeaks() {
  try {
    const db = await getDb();
    const memosWithAudio = await db.all(`
      SELECT id, audioUrl, audioFileName, waveformPeaks 
      FROM memos 
      WHERE audioUrl LIKE '/uploads/%' 
        AND (waveformPeaks IS NULL OR waveformPeaks = '' OR waveformPeaks = 'null')
    `);

    if (memosWithAudio.length === 0) {
      return;
    }

    console.log(`[Migration] Found ${memosWithAudio.length} memos with audio and no peak cache. Generating peak data...`);

    for (const memo of memosWithAudio) {
      const relativePath = memo.audioUrl.replace(/^\//, '');
      const filePath = path.join(__dirname, relativePath);

      if (fs.existsSync(filePath)) {
        console.log(`[Migration] Extracting peaks for Memo #${memo.id} (${memo.audioFileName})...`);
        const result = await extractPeaksAndDuration(filePath);
        if (result) {
          await db.run(
            'UPDATE memos SET waveformPeaks = ? WHERE id = ?',
            JSON.stringify(result),
            memo.id
          );
          console.log(`[Migration] Updated peaks for Memo #${memo.id}`);
        }
      } else {
        console.warn(`[Migration] Audio file for Memo #${memo.id} does not exist at ${filePath}`);
      }
    }
    console.log('[Migration] Finished generating peak data.');
  } catch (err) {
    console.error('[Migration] Failed to migrate audio peaks:', err);
  }
}

async function migrateExistingImages() {
  try {
    const db = await getDb();
    const memosWithImages = await db.all(`
      SELECT id, imageUrl, imageFileName 
      FROM memos 
      WHERE imageUrl LIKE '/uploads/%' 
        AND imageUrl NOT LIKE '%.webp'
    `);

    if (memosWithImages.length === 0) {
      return;
    }

    console.log(`[Migration] Found ${memosWithImages.length} memos with non-WebP images. Resizing and converting to WebP...`);

    for (const memo of memosWithImages) {
      const relativePath = memo.imageUrl.replace(/^\//, '');
      const filePath = path.join(__dirname, relativePath);

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          const newFilename = path.basename(filePath).replace(new RegExp(`${ext}$`, 'i'), '.webp');
          const newRelativePath = path.dirname(relativePath) + '/' + newFilename;
          const newFilePath = path.join(__dirname, newRelativePath);

          console.log(`[Migration] Processing image for Memo #${memo.id} (${memo.imageFileName})...`);
          
          try {
            await sharp(filePath)
              .resize({ width: 800, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toFile(newFilePath);

            // Delete original file
            await fs.promises.unlink(filePath);

            // Update DB references
            const newDbUrl = '/' + newRelativePath;
            const originalNameWithoutExt = memo.imageFileName 
              ? memo.imageFileName.substring(0, memo.imageFileName.length - ext.length)
              : 'image';
            const newDbFileName = originalNameWithoutExt + '.webp';

            await db.run(
              'UPDATE memos SET imageUrl = ?, imageFileName = ? WHERE id = ?',
              newDbUrl,
              newDbFileName,
              memo.id
            );
            console.log(`[Migration] Successfully converted Memo #${memo.id} image to WebP.`);
          } catch (processErr) {
            console.error(`[Migration] Failed to process image for Memo #${memo.id}:`, processErr);
          }
        }
      } else {
        console.warn(`[Migration] Image file for Memo #${memo.id} does not exist at ${filePath}`);
      }
    }
    console.log('[Migration] Finished migrating images.');
  } catch (err) {
    console.error('[Migration] Failed to migrate legacy images:', err);
  }
}

async function cleanupBlobUrls() {
  try {
    const db = await getDb();
    const result = await db.run(`
      UPDATE memos 
      SET audioUrl = null, audioFileName = null, waveformPeaks = null
      WHERE audioUrl LIKE 'blob:%'
    `);
    if (result.changes > 0) {
      console.log(`[Migration] Cleaned up ${result.changes} legacy broken blob URLs.`);
    }
  } catch (err) {
    console.error('[Migration] Failed to clean up blob URLs:', err);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  cleanupBlobUrls();
  migrateExistingAudioPeaks();
  migrateExistingImages();
});
