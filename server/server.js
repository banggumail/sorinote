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
import { exec } from 'child_process';
import { promisify } from 'util';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const execPromise = promisify(exec);

// Helper function to check audio codec and transcode if needed (e.g., ALAC -> AAC, CAF -> M4A)
async function checkAndTranscodeAudio(file) {
  const filePath = file.path;
  const ext = path.extname(filePath).toLowerCase();
  
  // 1. If it's a .caf file, transcode it to .m4a (standard AAC)
  if (ext === '.caf') {
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
  limits: { fileSize: 20 * 1024 * 1024 } // Limit: 20MB
});

// --- REST API REST API Routes ---

// Check if admin password exists
app.get('/api/admin/has-password', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT value FROM settings WHERE key = ?', 'adminPassword');
    res.json({ hasPassword: !!(row && row.value) });
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

// List all pads
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
      ORDER BY p.date DESC
    `);
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
    res.json({ pad, memos });
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
    await db.run('DELETE FROM pads WHERE id = ?', padId);
    await db.run('DELETE FROM memos WHERE padId = ?', padId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Convert filename encoding from latin1 to utf-8 to support Korean/Unicode characters properly
  let originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  
  // Transcode audio if necessary (ALAC -> AAC, CAF -> M4A)
  try {
    if (req.file.mimetype.startsWith('audio/') || ['.m4a', '.caf'].includes(path.extname(req.file.originalname).toLowerCase())) {
      const transcodeResult = await checkAndTranscodeAudio(req.file);
      if (transcodeResult && transcodeResult.originalNameExtension) {
        // Update original filename extension to match transcoded file
        const originalExt = path.extname(originalName);
        originalName = originalName.substring(0, originalName.length - originalExt.length) + transcodeResult.originalNameExtension;
      }
    }
  } catch (err) {
    console.error('Failed to process/transcode uploaded audio:', err);
  }

  // Return the relative URL of the file
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, originalName });
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
            audioFileName = ?, imageUrl = ?, imageFileName = ?
          WHERE id = ? AND padId = ?
        `, 
        memo.title, memo.author, memo.content, memo.color, memo.date,
        memo.x, memo.y, memo.z, memo.parentId || null, memo.titleColor || null,
        memo.contentColor || null, memo.waveformColor || null, memo.audioUrl || null,
        memo.audioFileName || null, memo.imageUrl || null, memo.imageFileName || null,
        memo.id, padId);
      } else {
        await db.run(`
          INSERT INTO memos (
            id, padId, title, author, content, color, date, 
            x, y, z, parentId, titleColor, contentColor, 
            waveformColor, audioUrl, audioFileName, imageUrl, imageFileName
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        memo.id, padId, memo.title, memo.author, memo.content, memo.color, memo.date,
        memo.x, memo.y, memo.z, memo.parentId || null, memo.titleColor || null,
        memo.contentColor || null, memo.waveformColor || null, memo.audioUrl || null,
        memo.audioFileName || null, memo.imageUrl || null, memo.imageFileName || null);
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
      await db.run('DELETE FROM memos WHERE id = ? AND padId = ?', id, padId);
      
      if (activeLocks[padId] && activeLocks[padId][id]) {
        delete activeLocks[padId][id];
      }
      
      socket.to(padId).emit('memo:deleted', { id });
    } catch (e) {
      console.error('Failed to delete memo from DB:', e);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
