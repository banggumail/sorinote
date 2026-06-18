import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH
  ? (path.isAbsolute(process.env.DATABASE_PATH) ? process.env.DATABASE_PATH : path.resolve(__dirname, process.env.DATABASE_PATH))
  : path.join(__dirname, 'database.sqlite');

let db;

export async function getDb() {
  if (db) return db;
  
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  await initializeDatabase(db);
  return db;
}

async function initializeDatabase(database) {
  // Create settings table
  await database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Create pads table
  await database.exec(`
    CREATE TABLE IF NOT EXISTS pads (
      id TEXT PRIMARY KEY,
      title TEXT,
      date TEXT,
      canvasBgColor TEXT,
      outerBgColor TEXT,
      titleColor TEXT,
      isPrivate INTEGER DEFAULT 0
    )
  `);

  try {
    await database.exec(`ALTER TABLE pads ADD COLUMN isPrivate INTEGER DEFAULT 0`);
  } catch (err) {
    // Column might already exist
  }

  // Create memos table
  await database.exec(`
    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY,
      padId TEXT,
      title TEXT,
      author TEXT,
      content TEXT,
      color TEXT,
      date TEXT,
      x REAL,
      y REAL,
      z INTEGER,
      parentId INTEGER,
      titleColor TEXT,
      contentColor TEXT,
      waveformColor TEXT,
      audioUrl TEXT,
      audioFileName TEXT,
      imageUrl TEXT,
      imageFileName TEXT,
      waveformPeaks TEXT
    )
  `);

  try {
    await database.exec(`ALTER TABLE memos ADD COLUMN waveformPeaks TEXT`);
  } catch (err) {
    // Column might already exist
  }

  // Create comments table
  await database.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      memoId INTEGER,
      padId TEXT,
      author TEXT,
      content TEXT,
      date TEXT
    )
  `);

  // Insert default settings if not exists
  const homeSettings = await database.get('SELECT value FROM settings WHERE key = ?', 'homeSettings');
  if (!homeSettings) {
    const defaultSettings = {
      bgColor: '#000000',
      titleText: '2bpencil',
      titleColor: '#fcff52',
      descText: 'sorinote.2bpencil.online',
      descColor: '#fcff52',
      adminBgColor: '#000000',
      adminFontColor: '#ffffff'
    };
    await database.run('INSERT INTO settings (key, value) VALUES (?, ?)', 'homeSettings', JSON.stringify(defaultSettings));
  }
}
