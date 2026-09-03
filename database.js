// database.js - SQLite Database Setup for CodeAlpha Video Communication App

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file path in root directory
const dbPath = path.join(__dirname, 'video_comm.db');

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Enable foreign key constraints
db.run('PRAGMA foreign_keys = ON');

// Initialize database tables
db.serialize(() => {
  // 1. Users table (Stores registered users for authentication)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Rooms table (Tracks created meeting rooms and their hosts)
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      host_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Seed a demo user if database is freshly created
  db.get('SELECT COUNT(*) AS count FROM users', async (err, row) => {
    if (err) {
      console.error('Error checking user count:', err.message);
      return;
    }

    if (row && row.count === 0) {
      console.log('Creating initial demo account for testing...');
      const hashedPassword = await bcrypt.hash('password123', 10);

      const insertUser = db.prepare(`
        INSERT INTO users (name, email, password, avatar_url)
        VALUES (?, ?, ?, ?)
      `);

      insertUser.run(
        'Alex Johnson',
        'alex@codealpha.com',
        hashedPassword,
        'https://api.dicebear.com/7.x/bottts/svg?seed=Alex'
      );
      insertUser.finalize();

      console.log('Demo user created: alex@codealpha.com / password123');
    }
  });
});

module.exports = db;
