import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const UPLOADS_DIR = '/home/banggumail/sorinote/server/uploads';
const DB_PATH = '/home/banggumail/sorinote/server/database.sqlite';
const LOG_PATH = '/home/banggumail/sorinote/server/clean_cron.log';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

function log(msg) {
  const time = new Date().toISOString();
  const line = `[${time}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.log(msg);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    log(`Error opening database: ${err.message}`);
    process.exit(1);
  }
});

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const runCommand = (sql) => {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

async function clean() {
  log('Starting weekly garbage collection...');
  try {
    // 1. Get referenced files
    const memos = await query('SELECT audioUrl, imageUrl FROM memos');
    const referencedFiles = new Set();

    memos.forEach(m => {
      if (m.audioUrl && m.audioUrl.startsWith('/uploads/')) {
        referencedFiles.add(path.basename(m.audioUrl));
      }
      if (m.imageUrl && m.imageUrl.startsWith('/uploads/')) {
        referencedFiles.add(path.basename(m.imageUrl));
      }
    });

    const settings = await query('SELECT key, value FROM settings');
    settings.forEach(s => {
      try {
        const val = JSON.parse(s.value);
        if (val && val.descImage && val.descImage.startsWith('/uploads/')) {
          referencedFiles.add(path.basename(val.descImage));
        }
      } catch (e) {
        if (s.value && s.value.startsWith('/uploads/')) {
          referencedFiles.add(path.basename(s.value));
        }
      }
    });

    // 2. Scan and delete unreferenced files older than grace period
    const filesInUploads = fs.readdirSync(UPLOADS_DIR);
    const now = Date.now();
    
    let deletedCount = 0;
    let freedSize = 0;

    filesInUploads.forEach(file => {
      const filePath = path.join(UPLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) return;

      const age = now - stat.mtimeMs;
      
      if (!referencedFiles.has(file)) {
        if (age > GRACE_PERIOD_MS) {
          fs.unlinkSync(filePath);
          deletedCount++;
          freedSize += stat.size;
          log(`Deleted garbage file: ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB, age: ${(age / 1000 / 60 / 60).toFixed(1)} hours)`);
        } else {
          log(`Skipped new unreferenced file (in grace period): ${file} (age: ${(age / 1000 / 60 / 60).toFixed(1)} hours)`);
        }
      }
    });

    // 3. Vacuum DB
    log('Running VACUUM on database...');
    const sizeBefore = fs.statSync(DB_PATH).size;
    await runCommand('VACUUM');
    const sizeAfter = fs.statSync(DB_PATH).size;

    log(`Garbage collection finished. Deleted: ${deletedCount} files, Freed: ${(freedSize / 1024 / 1024).toFixed(2)} MB, DB size: ${(sizeBefore / 1024).toFixed(1)} KB -> ${(sizeAfter / 1024).toFixed(1)} KB`);

  } catch (error) {
    log(`Garbage collection failed: ${error.message}`);
  } finally {
    db.close();
  }
}

clean();
