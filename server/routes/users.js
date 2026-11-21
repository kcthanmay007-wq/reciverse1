// ============================================================
//  RECIVERSE – User Routes (Powered by SQLite database)
// ============================================================

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database');

const SECRET  = 'reciverse_jwt_secret_2024';

// ── Auth middleware ───────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'user') return res.status(403).json({ error: 'Invalid token type' });
    req.user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}

// ── POST /api/users/register ──────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, phone, password, city } = req.body;
  if (!name || !email || !phone || !password || !city)
    return res.status(400).json({ error: 'All fields are required.' });

  const existing = db.users.getByEmail(email);
  if (existing)
    return res.status(400).json({ error: 'Email already registered.' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = db.users.create({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone.trim(),
    city: city.trim(),
    password: hashedPassword,
    about: '',
    avatar: '',
    totalRequests: 0,
    isBanned: false,
    createdAt: new Date().toISOString()
  });

  const token = jwt.sign({ id: user.id, type: 'user' }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.status(201).json({ token, user: safe });
});

// ── POST /api/users/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.getByEmail(email);
  if (!user) return res.status(400).json({ error: 'No account found with this email.' });
  if (user.isBanned) return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Incorrect password.' });

  const token = jwt.sign({ id: user.id, type: 'user' }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

// ── GET /api/users/me ─────────────────────────────────────
router.get('/me', auth, (req, res) => {
  const user = db.users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ── PUT /api/users/profile ────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  const user = db.users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { name, phone, city, about, avatar, currentPassword, newPassword } = req.body;
  const updates = {};

  if (name)   updates.name  = name.trim();
  if (phone)  updates.phone = phone.trim();
  if (city)   updates.city  = city.trim();
  if (typeof about !== 'undefined') updates.about = about.trim();
  if (avatar) updates.avatar = avatar; // base64 data URL

  // Optional password change
  if (newPassword) {
    if (!currentPassword)
      return res.status(400).json({ error: 'Current password is required to change password.' });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    updates.password = await bcrypt.hash(newPassword, 10);
  }

  updates.updatedAt = new Date().toISOString();
  const updatedUser = db.users.update(req.user.id, updates);

  const { password: _, ...safe } = updatedUser;
  res.json({ user: safe });
});

// ── GET /api/users/stats ──────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const requests = db.requests.getByUserId(req.user.id);
  const completed = requests.filter(r => r.status === 'completed').length;
  const pending   = requests.filter(r => r.status === 'pending').length;
  const accepted  = requests.filter(r => r.status === 'accepted').length;
  res.json({
    total:     requests.length,
    completed,
    pending,
    active:    accepted,
    requests
  });
});

module.exports = router;
module.exports.SECRET = SECRET;
