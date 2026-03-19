// ═══════════════════════════════════════════════════════════════
//  HackForge 2025 — Registration Backend  (server.js)
//  Tech: Node.js + Express + sqlite3 + Nodemailer
// ═══════════════════════════════════════════════════════════════

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3   = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path      = require('path');
const crypto    = require('crypto');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database Setup ─────────────────────────────────────────────
const db = new sqlite3.Database(path.join(__dirname, 'registrations.db'), (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Database ready — registrations.db');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id       TEXT UNIQUE NOT NULL,
      team_name     TEXT NOT NULL,
      track         TEXT NOT NULL,
      project_idea  TEXT NOT NULL,
      github        TEXT,
      agree_photo   INTEGER DEFAULT 0,
      agree_updates INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id  TEXT NOT NULL,
      role     TEXT NOT NULL,
      name     TEXT NOT NULL,
      email    TEXT NOT NULL,
      phone    TEXT NOT NULL,
      college  TEXT NOT NULL,
      year     TEXT,
      skills   TEXT,
      FOREIGN KEY(team_id) REFERENCES teams(team_id)
    )
  `);
});

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many attempts. Try again later.' }
});

// ── Email (Optional) ────────────────────────────────────────────
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  transporter.verify(err => {
    if (err) console.warn('Email config error:', err.message);
    else     console.log('Email service ready');
  });
} else {
  console.log('Email not configured — skipping confirmation emails');
}

// ── Helpers ────────────────────────────────────────────────────
function generateTeamId() {
  return 'TEAM-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validatePhone(p)  { return /^[+\d\s\-]{8,15}$/.test(p); }

// ── POST /api/register ─────────────────────────────────────────
app.post('/api/register', limiter, (req, res) => {
  const { team_name, track, project_idea, github, agree_photo, agree_updates, members } = req.body;

  const errors = [];
  if (!team_name || team_name.trim().length < 2) errors.push('Team name required');
  if (!track)         errors.push('Track required');
  if (!project_idea || project_idea.trim().length < 10) errors.push('Project idea required');
  if (!Array.isArray(members) || members.length !== 4) {
    errors.push('Exactly 4 team members required');
  } else {
    members.forEach((m, i) => {
      const n = i + 1;
      if (!m.name?.trim())                              errors.push(`Member ${n}: name missing`);
      if (!m.email?.trim() || !validateEmail(m.email)) errors.push(`Member ${n}: valid email required`);
      if (!m.phone?.trim() || !validatePhone(m.phone)) errors.push(`Member ${n}: valid phone required`);
      if (!m.college?.trim())                           errors.push(`Member ${n}: college missing`);
      if (!m.skills?.trim())                            errors.push(`Member ${n}: skills missing`);
    });
  }

  if (errors.length > 0) return res.status(400).json({ success: false, message: errors[0], errors });

  const emails = members.map(m => m.email.toLowerCase().trim());
  if (new Set(emails).size !== emails.length)
    return res.status(400).json({ success: false, message: 'Each member must have a unique email' });

  db.get('SELECT team_id FROM teams WHERE LOWER(team_name) = LOWER(?)', [team_name.trim()], (err, existing) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (existing) return res.status(409).json({ success: false, message: `Team name "${team_name}" already registered` });

    const teamId = generateTeamId();

    db.run(
      `INSERT INTO teams (team_id, team_name, track, project_idea, github, agree_photo, agree_updates)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teamId, team_name.trim(), track.trim(), project_idea.trim(), github?.trim() || null, agree_photo ? 1 : 0, agree_updates ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Failed to save team' });

        const stmt = db.prepare(
          `INSERT INTO members (team_id, role, name, email, phone, college, year, skills)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        members.forEach(m => {
          stmt.run(teamId, m.role, m.name.trim(), m.email.trim().toLowerCase(),
            m.phone.trim(), m.college.trim(), m.year || '', m.skills.trim());
        });

        stmt.finalize(() => {
          console.log(`Registered: ${teamId} — "${team_name}" (${track})`);

          if (transporter) {
            const memberRows = members.map((m, i) =>
              `<tr><td>${i+1}</td><td>${m.name}</td><td>${m.email}</td><td>${m.skills}</td></tr>`
            ).join('');
            transporter.sendMail({
              from: `"HackForge 2025" <${process.env.EMAIL_USER}>`,
              to: members[0].email,
              subject: `Registration Confirmed — ${team_name} | ${teamId}`,
              html: `<div style="font-family:monospace;background:#030508;color:#e8f4f8;padding:40px">
                <h1 style="color:#00f5ff">HACKFORGE 2025</h1>
                <p>Team <b style="color:#00ff88">${team_name}</b> is in!</p>
                <p style="color:#00f5ff;font-size:24px;letter-spacing:6px">${teamId}</p>
                <p>Track: ${track}</p>
                <table>${memberRows}</table>
              </div>`
            }).catch(e => console.warn('Email failed:', e.message));
          }

          res.status(201).json({ success: true, teamId, message: 'Registration successful!' });
        });
      }
    );
  });
});

// ── GET /api/registrations ─────────────────────────────────────
app.get('/api/registrations', (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'hackforge-admin-2025'))
    return res.status(401).json({ success: false, message: 'Unauthorized' });

  db.all(
    `SELECT t.*, GROUP_CONCAT(m.name, ', ') as member_names, COUNT(m.id) as member_count
     FROM teams t LEFT JOIN members m ON t.team_id = m.team_id
     GROUP BY t.team_id ORDER BY t.created_at DESC`,
    [],
    (err, teams) => {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: true, total: teams.length, teams });
    }
  );
});

// ── GET /api/team/:teamId ──────────────────────────────────────
app.get('/api/team/:teamId', (req, res) => {
  db.get('SELECT * FROM teams WHERE team_id = ?', [req.params.teamId], (err, team) => {
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    db.all('SELECT * FROM members WHERE team_id = ?', [req.params.teamId], (err, members) => {
      res.json({ success: true, team, members });
    });
  });
});

// ── GET /api/stats ─────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM teams', [], (err, row) => {
    db.all('SELECT track, COUNT(*) as count FROM teams GROUP BY track ORDER BY count DESC', [], (err, byTrack) => {
      res.json({ success: true, totalTeams: row.count, byTrack });
    });
  });
});

// ── Serve frontend ──────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       HACKFORGE 2025 — SERVER READY      ║
  ╠══════════════════════════════════════════╣
  ║  Website  →  http://localhost:${PORT}       ║
  ║  Admin    →  /api/registrations?secret=  ║
  ║  Stats    →  /api/stats                  ║
  ╚══════════════════════════════════════════╝
  `);
});
