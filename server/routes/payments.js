// ============================================================
//  RECIVERSE – Payments Route (SQLite Database Powered)
//  Razorpay Sandbox / Test Mode — records payments in SQLite DB
// ============================================================

const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db     = require('../database');

const SECRET = 'reciverse_jwt_secret_2024';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── POST /api/payments ─────────────────────────────────────
// Records a sandbox payment (Razorpay test mode)
router.post('/', auth, (req, res) => {
  const { requestId, techId, amount, method, txnId, status, sandbox, paidAt } = req.body;

  if (!requestId || !amount) {
    return res.status(400).json({ error: 'requestId and amount are required.' });
  }

  // Check if already paid
  const existing = db.payments.getByRequestId(requestId);
  if (existing && existing.status === 'paid') {
    return res.json({ success: true, alreadyPaid: true, payment: existing });
  }

  const reqRecord = db.requests.getById(requestId);
  const payment = db.payments.create({
    id:              uuidv4(),
    requestId,
    userId:          req.user.id,
    techId:          techId || reqRecord?.technicianId || null,
    amount:          Number(amount) || 0,
    method:          method || 'UPI',
    txnId:           txnId || ('rzp_sandbox_' + uuidv4().replace(/-/g,'')),
    status:          status || 'paid',
    sandbox:         sandbox !== false,
    razorpayEnv:     'sandbox',
    customerName:    reqRecord?.userName || null,
    technicianName:  reqRecord?.technicianName || null,
    serviceCategory: reqRecord?.productCategory || null,
    paidAt:          paidAt || new Date().toISOString(),
    createdAt:       new Date().toISOString()
  });

  // Mark request as paid in database
  db.requests.update(requestId, {
    paymentStatus: 'paid',
    paymentId:     payment.id,
    paidAt:        payment.paidAt
  });

  res.status(201).json({
    success: true,
    payment,
    message: `Payment of ₹${amount} recorded (Razorpay sandbox/test mode in SQLite).`
  });
});

// ── GET /api/payments ──────────────────────────────────────
// Get all payments for the logged-in user
router.get('/', auth, (req, res) => {
  const payments = db.payments.getByUserId(req.user.id);
  res.json(payments);
});

// ── GET /api/payments/:id ──────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const payment = db.payments.getById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  res.json(payment);
});

// ── GET /api/payments/status/:requestId ───────────────────
router.get('/status/:requestId', auth, (req, res) => {
  const payment = db.payments.getByRequestId(req.params.requestId);
  res.json({
    paid:    !!payment && payment.status === 'paid',
    payment: payment || null
  });
});

module.exports = router;
