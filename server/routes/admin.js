// ============================================================
//  RECIVERSE – Admin Dashboard Routes (SQLite Powered)
// ============================================================

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const db      = require('../database');
const { runPass, passLabel } = require('../matchingEngine');

const SECRET  = 'reciverse_jwt_secret_2024';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    req.admin = decoded;
    next();
  } catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}

// ── POST /api/admin/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = db.admin.get();
  if (!admin) return res.status(503).json({ error: 'Admin not configured.' });
  if (admin.email.toLowerCase() !== email?.toLowerCase()) return res.status(400).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, admin.password);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials.' });
  const token = jwt.sign({ id: 'admin', type: 'admin' }, SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// ── GET /api/admin/stats ──────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const users    = db.users.getAll();
  const techs    = db.technicians.getAll();
  const requests = db.requests.getAll();
  const reviews  = db.reviews.getAll();

  const byStatus = {};
  requests.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  // Last 7 days registrations
  const now = Date.now();
  const day = 86400000;
  const newUsers7d  = users.filter(u  => now - new Date(u.createdAt)  < 7*day).length;
  const newTechs7d  = techs.filter(t  => now - new Date(t.createdAt)  < 7*day).length;
  const newReqs7d   = requests.filter(r => now - new Date(r.createdAt) < 7*day).length;

  const ratedTechs = techs.filter(t => t.ratingCount > 0);
  const avgRating = ratedTechs.length
    ? ratedTechs.reduce((s, t) => s + (t.rating || 0), 0) / ratedTechs.length
    : 0;

  res.json({
    totalUsers:      users.length,
    totalTechs:      techs.length,
    totalRequests:   requests.length,
    totalReviews:    reviews.length,
    onlineTechs:     techs.filter(t => t.isOnline).length,
    byStatus,
    newUsers7d,
    newTechs7d,
    newReqs7d,
    avgPlatformRating: Math.round(avgRating * 10) / 10
  });
});

// ── GET /api/admin/users ──────────────────────────────────
router.get('/users', auth, (req, res) => {
  const users = db.users.getAll().map(({ password, ...u }) => u);
  res.json(users);
});

// ── GET /api/admin/technicians ────────────────────────────
router.get('/technicians', auth, (req, res) => {
  const techs = db.technicians.getAll().map(({ password, ...t }) => t);
  res.json(techs);
});

// ── GET /api/admin/requests ───────────────────────────────
router.get('/requests', auth, (req, res) => {
  const requests = db.requests.getAll().map(r => ({
    ...r,
    passLabel: passLabel(r)
  }));
  res.json(requests);
});

// ── POST /api/admin/run-matching-pass ─────────────────────
router.post('/run-matching-pass', auth, (_req, res) => {
  const stats = runPass();
  res.json({ success: true, stats });
});

// ── PUT /api/admin/users/:id/ban ─────────────────────────
router.put('/users/:id/ban', auth, (req, res) => {
  const user = db.users.getById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const updated = db.users.update(req.params.id, { isBanned: !user.isBanned });
  res.json({ isBanned: updated.isBanned });
});

// ── PUT /api/admin/technicians/:id/ban ───────────────────
router.put('/technicians/:id/ban', auth, (req, res) => {
  const tech = db.technicians.getById(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found.' });
  const updated = db.technicians.update(req.params.id, {
    isBanned: !tech.isBanned,
    isOnline: tech.isBanned ? tech.isOnline : false
  });
  res.json({ isBanned: updated.isBanned });
});

// ── PUT /api/admin/technicians/:id/verify ────────────────
router.put('/technicians/:id/verify', auth, (req, res) => {
  const tech = db.technicians.getById(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found.' });
  const updated = db.technicians.update(req.params.id, { verified: !tech.verified });
  res.json({ verified: updated.verified });
});

// ── DELETE /api/admin/requests/:id ───────────────────────
router.delete('/requests/:id', auth, (req, res) => {
  const ok = db.requests.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ success: true });
});

// ── GET /api/admin/payments ───────────────────────────────
router.get('/payments', auth, (req, res) => {
  const payments = db.payments.getAll();
  res.json(payments);
});

// ── GET /api/admin/payments/:id/slip ──────────────────────
router.get('/payments/:id/slip', auth, (req, res) => {
  const payment = db.payments.getById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment slip not found.' });

  const request = payment.requestId ? db.requests.getById(payment.requestId) : null;
  const user = payment.userId ? db.users.getById(payment.userId) : null;
  const tech = payment.techId ? db.technicians.getById(payment.techId) : null;

  const slip = {
    slipId:          'SLIP-' + payment.id.slice(0, 8).toUpperCase(),
    transactionId:   payment.txnId,
    paymentId:       payment.id,
    requestId:       payment.requestId,
    amount:          payment.amount,
    currency:        'INR',
    method:          payment.method,
    status:          payment.status,
    sandbox:         payment.sandbox,
    paidAt:          payment.paidAt,
    customer: {
      name:  payment.customerName || user?.name || request?.userName || 'Customer',
      email: user?.email || request?.userEmail || '—',
      phone: user?.phone || request?.userPhone || '—',
      city:  user?.city || request?.city || '—'
    },
    technician: {
      name:  payment.technicianName || tech?.name || request?.technicianName || 'Technician',
      email: tech?.email || '—',
      phone: tech?.phone || request?.technicianPhone || '—',
      city:  tech?.city || '—'
    },
    service: {
      category:    payment.serviceCategory || request?.productCategory || 'Appliance Repair',
      productName: request?.productName || 'Service Item',
      fault:       request?.faultDescription || 'Repair Service'
    },
    auditTimeline: {
      requestCreated:     request?.createdAt,
      acceptedAt:         request?.acceptedAt,
      techCompletedAt:    request?.techCompletedAt,
      customerApprovedAt: request?.customerApprovedAt,
      completedAt:        request?.completedAt,
      paidAt:             payment.paidAt
    }
  };

  res.json(slip);
});

// ── GET /api/admin/audit-logs ─────────────────────────────
router.get('/audit-logs', auth, (req, res) => {
  const requests = db.requests.getAll();
  const logs = [];

  for (const r of requests) {
    if (r.passLog && Array.isArray(r.passLog)) {
      for (const entry of r.passLog) {
        logs.push({
          requestId: r.id,
          product: r.productName || r.productCategory,
          customerName: r.userName,
          ...entry
        });
      }
    }
  }

  logs.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  res.json(logs);
});

module.exports = router;
