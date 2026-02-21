import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import multer from "multer";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("notes.db");

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  );
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    birth_date TEXT,
    cpf TEXT,
    address TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    patient_id INTEGER,
    complaint TEXT,
    intervention TEXT,
    next_focus TEXT,
    observations TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'draft',
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    patient_id INTEGER,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  );
  CREATE TABLE IF NOT EXISTS financial_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    patient_id INTEGER,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    category TEXT,
    description TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(patient_id) REFERENCES patients(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/stats", (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const sessionsToday = db.prepare("SELECT COUNT(*) as count FROM notes WHERE date(created_at) = ?").get(today) as any;
    const pendingReview = db.prepare("SELECT COUNT(*) as count FROM notes WHERE status = 'draft' AND date(created_at) = ?").get(today) as any;
    
    // Calculate volume for last 7 days
    const volumeData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      const count = db.prepare("SELECT COUNT(*) as count FROM notes WHERE date(created_at) = ?").get(dateStr) as any;
      volumeData.push({ name: dayName, volume: count.count });
    }
    
    res.json({
      sessionsToday: sessionsToday.count,
      pendingReview: pendingReview.count,
      timeSaved: `${sessionsToday.count * 20}m`, // Assuming 20m saved per session
      avgProcessing: "1m 12s",
      volumeData
    });
  });

  app.get("/api/appointments/next", (req, res) => {
    const now = new Date().toISOString();
    const nextApp = db.prepare(`
      SELECT a.*, p.name as patient_name 
      FROM appointments a 
      JOIN patients p ON a.patient_id = p.id 
      WHERE a.start_time > ? 
      ORDER BY a.start_time ASC 
      LIMIT 1
    `).get(now);
    res.json(nextApp || null);
  });

  app.get("/api/patients/:id/history", (req, res) => {
    const { id } = req.params;
    const notes = db.prepare("SELECT * FROM notes WHERE patient_id = ? ORDER BY created_at DESC").all(id);
    const appointments = db.prepare("SELECT * FROM appointments WHERE patient_id = ? ORDER BY start_time DESC").all(id);
    const financial = db.prepare("SELECT * FROM financial_records WHERE patient_id = ? ORDER BY date DESC").all(id);
    
    res.json({ notes, appointments, financial });
  });

  app.get("/api/patients", (req, res) => {
    const patients = db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM notes WHERE patient_id = p.id) as session_count 
      FROM patients p 
      ORDER BY p.name ASC
    `).all();
    res.json(patients);
  });

  app.post("/api/patients", (req, res) => {
    const { name, email, phone, birth_date, cpf, address, notes } = req.body;
    const stmt = db.prepare("INSERT INTO patients (user_id, name, email, phone, birth_date, cpf, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const info = stmt.run(1, name, email, phone, birth_date, cpf, address, notes);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/appointments", (req, res) => {
    const appointments = db.prepare(`
      SELECT a.*, p.name as patient_name 
      FROM appointments a 
      JOIN patients p ON a.patient_id = p.id 
      ORDER BY start_time ASC
    `).all();
    res.json(appointments);
  });

  app.post("/api/appointments", (req, res) => {
    const { patient_id, start_time, end_time, notes } = req.body;
    const stmt = db.prepare("INSERT INTO appointments (user_id, patient_id, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?)");
    const info = stmt.run(1, patient_id, start_time, end_time, notes);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/financial", (req, res) => {
    const records = db.prepare(`
      SELECT f.*, p.name as patient_name 
      FROM financial_records f 
      LEFT JOIN patients p ON f.patient_id = p.id 
      ORDER BY date DESC
    `).all();
    res.json(records);
  });

  app.post("/api/financial", (req, res) => {
    const { patient_id, amount, type, category, description, date, status } = req.body;
    const stmt = db.prepare("INSERT INTO financial_records (user_id, patient_id, amount, type, category, description, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const info = stmt.run(1, patient_id, amount, type, category, description, date, status);
    res.json({ id: info.lastInsertRowid });
  });

  app.post("/api/notes", (req, res) => {
    const { user_id, patient_id, complaint, intervention, next_focus, observations } = req.body;
    const stmt = db.prepare("INSERT INTO notes (user_id, patient_id, complaint, intervention, next_focus, observations) VALUES (?, ?, ?, ?, ?, ?)");
    const info = stmt.run(user_id || 1, patient_id, complaint, intervention, next_focus, observations);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/notes", (req, res) => {
    const notes = db.prepare(`
      SELECT n.*, p.name as patient_name 
      FROM notes n 
      LEFT JOIN patients p ON n.patient_id = p.id 
      ORDER BY n.created_at DESC
    `).all();
    res.json(notes);
  });

  app.delete("/api/notes/:id", (req, res) => {
    db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
