// ═══════════════════════════════════════════════════════════════
//  HackHive 2026 — Registration Backend
//  Node.js + Express + MongoDB Atlas
// ═══════════════════════════════════════════════════════════════

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const mongoose   = require('mongoose');
const path       = require('path');
const crypto     = require('crypto');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB Connection ─────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not set! Add it in Render environment variables.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });

// ── Schema ─────────────────────────────────────────────────────
const memberSchema = new mongoose.Schema({
  role:  String,
  name:  String,
  email: String,
  phone: String,
});

const registrationSchema = new mongoose.Schema({
  team_id:            { type: String, unique: true },
  team_name:          { type: String, required: true },
  college:            { type: String, required: true },
  track:              { type: String, required: true },
  team_size:          String,
  fee:                String,
  utr:                { type: String, required: true },
  project_title:      String,
  project_desc:       String,
  payment_screenshot: String,   // base64 image
  members:            [memberSchema],
  created_at:         { type: Date, default: Date.now },
});

const Registration = mongoose.model('Registration', registrationSchema);

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20mb' }));  // large limit for base64 screenshot
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// Rate limiting — max 10 registrations per IP per hour
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many attempts. Please try again later.' }
});

// ── Helpers ────────────────────────────────────────────────────
function generateTeamId() {
  return 'HH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ── POST /api/register ─────────────────────────────────────────
app.post('/api/register', limiter, async (req, res) => {
  try {
    const {
      team_name, college, track, team_size, fee,
      utr, project_title, project_desc,
      payment_screenshot, members
    } = req.body;

    // ── Validation
    const errors = [];
    if (!team_name?.trim())  errors.push('Team name is required');
    if (!college?.trim())    errors.push('College name is required');
    if (!track?.trim())      errors.push('Track is required');
    if (!utr?.trim())        errors.push('UTR / Transaction number is required');

    if (!Array.isArray(members) || members.length === 0) {
      errors.push('At least 1 member is required');
    } else {
      const leader = members[0];
      if (!leader.name?.trim())            errors.push('Leader name is required');
      if (!leader.email?.trim() || !validateEmail(leader.email))
        errors.push('Valid leader email is required');
      if (!leader.phone?.trim())           errors.push('Leader phone is required');
    }

    if (errors.length > 0)
      return res.status(400).json({ success: false, message: errors[0], errors });

    // ── Check duplicate UTR
    const dupUTR = await Registration.findOne({ utr: utr.trim() });
    if (dupUTR)
      return res.status(409).json({ success: false, message: 'This UTR number has already been used for registration' });

    // ── Check duplicate team name
    const dupTeam = await Registration.findOne({
      team_name: { $regex: new RegExp(`^${team_name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (dupTeam)
      return res.status(409).json({ success: false, message: `Team name "${team_name}" is already registered` });

    // ── Save registration
    const teamId = generateTeamId();
    const reg = new Registration({
      team_id:            teamId,
      team_name:          team_name.trim(),
      college:            college.trim(),
      track:              track.trim(),
      team_size:          team_size || '',
      fee:                fee || '',
      utr:                utr.trim(),
      project_title:      project_title?.trim() || '',
      project_desc:       project_desc?.trim() || '',
      payment_screenshot: payment_screenshot || '',
      members:            members.map(m => ({
        role:  m.role  || '',
        name:  m.name?.trim()  || '',
        email: m.email?.trim().toLowerCase() || '',
        phone: m.phone?.trim() || '',
      }))
    });

    await reg.save();
    console.log(`✅ Registered: ${teamId} — "${team_name}" | UTR: ${utr} | Track: ${track}`);

    res.status(201).json({
      success: true,
      teamId,
      message: 'Registration successful!'
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── GET /api/registrations (Admin Panel) ───────────────────────
app.get('/api/registrations', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== (process.env.ADMIN_SECRET || 'hackhive-admin-2026'))
    return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const regs = await Registration.find()
      .sort({ created_at: -1 })
      .select('-payment_screenshot'); // don't send base64 in list view (too heavy)

    res.json({
      success: true,
      total: regs.length,
      registrations: regs.map(r => ({
        team_id:      r.team_id,
        team_name:    r.team_name,
        college:      r.college,
        track:        r.track,
        team_size:    r.team_size,
        fee:          r.fee,
        utr:          r.utr,
        project_title: r.project_title,
        created_at:   r.created_at,
        leader:       r.members[0] || {},
        member_names: r.members.map(m => m.name).join(', '),
        member_count: r.members.length,
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/team/:teamId ──────────────────────────────────────
app.get('/api/team/:teamId', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== (process.env.ADMIN_SECRET || 'hackhive-admin-2026'))
    return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const reg = await Registration.findOne({ team_id: req.params.teamId });
    if (!reg) return res.status(404).json({ success: false, message: 'Team not found' });
    res.json({ success: true, registration: reg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/payment/:teamId (View payment screenshot) ─────────
app.get('/api/payment/:teamId', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== (process.env.ADMIN_SECRET || 'hackhive-admin-2026'))
    return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const reg = await Registration.findOne({ team_id: req.params.teamId }).select('payment_screenshot team_name');
    if (!reg) return res.status(404).json({ success: false, message: 'Team not found' });
    if (!reg.payment_screenshot)
      return res.status(404).json({ success: false, message: 'No screenshot found' });

    // Return HTML page showing the screenshot
    res.send(`
      <html>
        <body style="background:#020810;display:flex;flex-direction:column;align-items:center;padding:40px;font-family:monospace">
          <h2 style="color:#00c8ff;letter-spacing:4px">PAYMENT SCREENSHOT</h2>
          <p style="color:#6a84a0;letter-spacing:2px">${reg.team_name}</p>
          <img src="${reg.payment_screenshot}" style="max-width:500px;border:1px solid rgba(0,200,255,.3);margin-top:20px"/>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/stats ─────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const total = await Registration.countDocuments();
    const byTrack = await Registration.aggregate([
      { $group: { _id: '$track', count: { $sum: 1 } } },
      { $sort:  { count: -1 } }
    ]);
    const byCollege = await Registration.aggregate([
      { $group: { _id: '$college', count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: 10 }
    ]);
    res.json({ success: true, totalTeams: total, byTrack, topColleges: byCollege });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Serve frontend ──────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║        HACKHIVE 2026 — SERVER READY      ║
  ╠══════════════════════════════════════════╣
  ║  Website  →  http://localhost:${PORT}       ║
  ║  Admin    →  /api/registrations?secret=  ║
  ║  Stats    →  /api/stats                  ║
  ╚══════════════════════════════════════════╝
  `);
});
