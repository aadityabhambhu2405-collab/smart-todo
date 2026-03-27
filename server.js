// ============================================================
// server.js — Smart To-Do App Backend
// Uses sql.js (pure JS SQLite — no compilation needed!)
// BCA 1st Year College Project
// ============================================================

const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const initSqlJs = require('sql.js');

const app        = express();
const PORT       = 3000;
const JWT_SECRET = 'bca_todo_secret_2024_secure_key';
const DB_FILE    = path.join(__dirname, 'todo_app.db');

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Database Setup ───────────────────────────────────────────
let db;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file if it exists, else create new
  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing database from file');
  } else {
    db = new SQL.Database();
    console.log('✅ Created new database');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    UNIQUE NOT NULL,
      email      TEXT    UNIQUE NOT NULL,
      password   TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      title       TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      priority    TEXT    DEFAULT 'medium',
      category    TEXT    DEFAULT 'General',
      due_date    TEXT    DEFAULT NULL,
      completed   INTEGER DEFAULT 0,
      pinned      INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id   INTEGER NOT NULL,
      title     TEXT    NOT NULL,
      completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name    TEXT    NOT NULL,
      color   TEXT    DEFAULT '#6366f1'
    );
  `);

  saveDB();
  console.log('✅ Database tables ready');
}

// Save DB to file after every write
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

// Helper: run a query and return all rows as objects
function dbAll(sql, params = []) {
  try {
    const stmt    = db.prepare(sql);
    const results = [];
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('dbAll error:', e.message, sql);
    return [];
  }
}

// Helper: run a query and return first row
function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows[0] || null;
}

// Helper: run INSERT/UPDATE/DELETE and return lastInsertRowid
function dbRun(sql, params = []) {
  try {
    db.run(sql, params);
    const row = dbGet('SELECT last_insert_rowid() as id');
    saveDB();
    return { lastInsertRowid: row ? row.id : null };
  } catch (e) {
    console.error('dbRun error:', e.message);
    throw e;
  }
}

// ─── Auth Middleware ──────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const count = dbGet('SELECT COUNT(*) as c FROM users');
  if (count && count.c >= 20)
    return res.status(400).json({ error: 'Maximum 20 users reached for this demo app' });

  const hashed = bcrypt.hashSync(password, 10);
  try {
    const result = dbRun(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hashed]
    );
    const uid = result.lastInsertRowid;

    // Add default categories
    const defaultCats = [
      ['Work', '#6366f1'], ['Personal', '#ec4899'],
      ['Study', '#f59e0b'], ['Health', '#10b981'], ['Shopping', '#3b82f6']
    ];
    defaultCats.forEach(([name, color]) => {
      dbRun('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)', [uid, name, color]);
    });

    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, username, email, userId: uid });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE'))
      return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const user = dbGet('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username, email: user.email, userId: user.id });
});

// ─── TASK ROUTES ──────────────────────────────────────────────

// Get all tasks
app.get('/api/tasks', authenticate, (req, res) => {
  const { filter, priority, category, search, sort } = req.query;

  let query = `SELECT t.*,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as subtask_done
    FROM tasks t WHERE t.user_id = ?`;
  const params = [req.userId];

  if (filter === 'completed')   { query += ' AND t.completed = 1'; }
  else if (filter === 'pending') { query += ' AND t.completed = 0'; }
  else if (filter === 'today')  { query += ` AND date(t.due_date) = date('now')`; }
  else if (filter === 'overdue'){ query += ` AND t.completed = 0 AND t.due_date IS NOT NULL AND date(t.due_date) < date('now')`; }

  if (priority && priority !== 'all') { query += ' AND t.priority = ?'; params.push(priority); }
  if (category && category !== 'all') { query += ' AND t.category = ?'; params.push(category); }
  if (search) { query += ' AND t.title LIKE ?'; params.push(`%${search}%`); }

  if (sort === 'due_date')      query += ' ORDER BY t.pinned DESC, t.due_date ASC';
  else if (sort === 'priority') query += ' ORDER BY t.pinned DESC, CASE t.priority WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END';
  else if (sort === 'title')    query += ' ORDER BY t.pinned DESC, t.title ASC';
  else                          query += ' ORDER BY t.pinned DESC, t.created_at DESC';

  res.json(dbAll(query, params));
});

// Create task
app.post('/api/tasks', authenticate, (req, res) => {
  const { title, description, priority, category, due_date, subtasks } = req.body;
  if (!title || !title.trim())
    return res.status(400).json({ error: 'Task title is required' });

  const result = dbRun(
    `INSERT INTO tasks (user_id, title, description, priority, category, due_date) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.userId, title.trim(), description || '', priority || 'medium', category || 'General', due_date || null]
  );
  const taskId = result.lastInsertRowid;

  if (subtasks && subtasks.length > 0) {
    subtasks.forEach(s => { if (s && s.trim()) dbRun('INSERT INTO subtasks (task_id, title) VALUES (?, ?)', [taskId, s.trim()]); });
  }

  const task = dbGet(`SELECT t.*,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as subtask_done
    FROM tasks t WHERE t.id = ?`, [taskId]);
  res.status(201).json(task);
});

// Update task
app.put('/api/tasks/:id', authenticate, (req, res) => {
  const task = dbGet('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { title, description, priority, category, due_date, completed, pinned } = req.body;

  dbRun(`UPDATE tasks SET title=?, description=?, priority=?, category=?, due_date=?, completed=?, pinned=?, updated_at=datetime('now') WHERE id=? AND user_id=?`,
    [
      title       !== undefined ? title       : task.title,
      description !== undefined ? description : task.description,
      priority    !== undefined ? priority    : task.priority,
      category    !== undefined ? category    : task.category,
      due_date    !== undefined ? due_date    : task.due_date,
      completed   !== undefined ? (completed ? 1 : 0) : task.completed,
      pinned      !== undefined ? (pinned ? 1 : 0)    : task.pinned,
      req.params.id,
      req.userId
    ]
  );

  const updated = dbGet(`SELECT t.*,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
    (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as subtask_done
    FROM tasks t WHERE t.id = ?`, [req.params.id]);
  res.json(updated);
});

// Delete task
app.delete('/api/tasks/:id', authenticate, (req, res) => {
  const task = dbGet('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  dbRun('DELETE FROM subtasks WHERE task_id = ?', [req.params.id]);
  dbRun('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json({ message: 'Task deleted successfully' });
});

// Toggle complete
app.patch('/api/tasks/:id/toggle', authenticate, (req, res) => {
  const task = dbGet('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const newStatus = task.completed ? 0 : 1;
  dbRun(`UPDATE tasks SET completed=?, updated_at=datetime('now') WHERE id=?`, [newStatus, req.params.id]);
  res.json({ completed: !!newStatus });
});

// Get subtasks
app.get('/api/tasks/:id/subtasks', authenticate, (req, res) => {
  const task = dbGet('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(dbAll('SELECT * FROM subtasks WHERE task_id = ?', [req.params.id]));
});

// Toggle subtask
app.patch('/api/subtasks/:id/toggle', authenticate, (req, res) => {
  const sub = dbGet(`SELECT s.* FROM subtasks s JOIN tasks t ON s.task_id = t.id WHERE s.id = ? AND t.user_id = ?`, [req.params.id, req.userId]);
  if (!sub) return res.status(404).json({ error: 'Subtask not found' });
  dbRun('UPDATE subtasks SET completed=? WHERE id=?', [sub.completed ? 0 : 1, req.params.id]);
  res.json({ completed: !sub.completed });
});

// ─── CATEGORY ROUTES ──────────────────────────────────────────

app.get('/api/categories', authenticate, (req, res) => {
  res.json(dbAll('SELECT * FROM categories WHERE user_id = ?', [req.userId]));
});

app.post('/api/categories', authenticate, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  const result = dbRun('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)', [req.userId, name.trim(), color || '#6366f1']);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), color: color || '#6366f1' });
});

app.delete('/api/categories/:id', authenticate, (req, res) => {
  dbRun('DELETE FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json({ message: 'Category deleted' });
});

// ─── STATS ROUTE ──────────────────────────────────────────────

app.get('/api/stats', authenticate, (req, res) => {
  const uid   = req.userId;
  const total     = (dbGet('SELECT COUNT(*) as c FROM tasks WHERE user_id=?', [uid]) || {}).c || 0;
  const completed = (dbGet('SELECT COUNT(*) as c FROM tasks WHERE user_id=? AND completed=1', [uid]) || {}).c || 0;
  const pending   = (dbGet('SELECT COUNT(*) as c FROM tasks WHERE user_id=? AND completed=0', [uid]) || {}).c || 0;
  const high      = (dbGet('SELECT COUNT(*) as c FROM tasks WHERE user_id=? AND priority="high" AND completed=0', [uid]) || {}).c || 0;
  const overdue   = (dbGet(`SELECT COUNT(*) as c FROM tasks WHERE user_id=? AND completed=0 AND due_date IS NOT NULL AND date(due_date) < date('now')`, [uid]) || {}).c || 0;
  const today     = (dbGet(`SELECT COUNT(*) as c FROM tasks WHERE user_id=? AND date(due_date)=date('now')`, [uid]) || {}).c || 0;
  res.json({ total, completed, pending, high, overdue, today });
});

// ─── Serve Frontend ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 TaskFlow running at http://localhost:${PORT}`);
    console.log(`📦 Database: todo_app.db (sql.js SQLite - no build tools needed!)\n`);
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
});
