// ============================================================
//  RECIVERSE – Repair Requests Routes (SQLite Powered)
// ============================================================

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database');
const { runPass, passLabel, computeScoreBreakdown } = require('../matchingEngine');

const SECRET  = 'reciverse_jwt_secret_2024';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── POST /api/requests ─────────────────────────────────────
router.post('/', auth, (req, res) => {
  const { productCategory, productName, faultDescription, city, urgency, dispatchMode } = req.body;
  if (!productCategory || !faultDescription)
    return res.status(400).json({ error: 'Product category and fault description are required.' });

  const user = db.users.getById(req.user.id);
  const isUrgent = urgency === 'urgent';
  const effectiveMode = dispatchMode || (isUrgent ? 'auto' : 'broadcast');

  const request = db.requests.create({
    id:               uuidv4(),
    userId:           req.user.id,
    userName:         user ? user.name  : 'Customer',
    userPhone:        user ? user.phone : '',
    userEmail:        user ? user.email : '',
    productCategory,
    productName:      productName || productCategory,
    faultDescription: faultDescription.trim(),
    city:             city || (user ? user.city : ''),
    urgency:          urgency || 'normal',
    dispatchMode:     effectiveMode,
    status:           'pending',
    technicianId:     null,
    technicianName:   null,
    technicianPhone:  null,
    technicianAvatar: '',
    passNumber:       0,
    passStatus:       'pending',
    rejectedByTechIds:[],
    notifiedTechIds:  [],
    passLog:          [],
    hasReview:        false,
    createdAt:        new Date().toISOString(),
    acceptedAt:       null,
    completedAt:      null
  });

  // Trigger matching engine pass immediately
  const isAuto = effectiveMode === 'auto' || isUrgent;
  runPass(request.id, isAuto ? 1 : 3);

  // Fetch updated record after matching pass
  const updated = db.requests.getById(request.id) || request;

  // Informational matching scores for customer UI
  const matched = db.technicians.getAll()
    .filter(t =>
      t.verified &&
      (t.skills || []).some(s => s.toLowerCase() === productCategory.toLowerCase()) &&
      t.activeJobs < t.maxCapacity
    )
    .map(({ password, ...t }) => {
      const breakdown = computeScoreBreakdown(t, updated, null, { cityWeight: 10, expWeight: 5, reviews: [] });
      return { ...t, matchScore: breakdown.total, matchBreakdown: breakdown.breakdown };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  res.status(201).json({
    request: {
      ...updated,
      passLabel: passLabel(updated)
    },
    matchedTechnicians: matched,
    passInfo: {
      passNumber: updated.passNumber,
      passStatus: updated.passStatus,
      passLabel:  passLabel(updated),
      urgency:    updated.urgency,
      autoAssigned: updated.status === 'accepted',
      technicianName: updated.technicianName,
      suggestedTechnicianId:   updated.suggestedTechnicianId,
      suggestedTechnicianName: updated.suggestedTechnicianName,
      suggestedTechScore:      updated.suggestedTechScore,
      suggestedTechBreakdown:  updated.suggestedTechBreakdown
    }
  });
});

// ── GET /api/requests ──────────────────────────────────────
router.get('/', auth, (req, res) => {
  const requests = db.requests.getByUserId(req.user.id)
    .map(r => ({
      ...r,
      passLabel: passLabel(r)
    }));
  res.json(requests);
});

// ── GET /api/requests/:id ──────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  const matched = db.technicians.getAll()
    .filter(t =>
      t.verified &&
      (t.skills || []).some(s => s.toLowerCase() === request.productCategory.toLowerCase())
    )
    .map(({ password, ...t }) => {
      const breakdown = computeScoreBreakdown(t, request, null, { cityWeight: 10, expWeight: 5, reviews: [] });
      return { ...t, matchScore: breakdown.total, matchBreakdown: breakdown.breakdown };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  res.json({
    request: {
      ...request,
      passLabel: passLabel(request)
    },
    matchedTechnicians: matched
  });
});

// ── PUT /api/requests/:id/cancel ───────────────────────────
router.put('/:id/cancel', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request || request.userId !== req.user.id)
    return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending' && request.status !== 'accepted')
    return res.status(400).json({ error: 'Only pending or accepted requests can be cancelled.' });

  // If was accepted, free up technician's capacity
  if (request.status === 'accepted' && request.technicianId) {
    const tech = db.technicians.getById(request.technicianId);
    if (tech && tech.activeJobs > 0) {
      db.technicians.update(tech.id, { activeJobs: tech.activeJobs - 1 });
    }
  }

  db.requests.update(request.id, {
    status:      'cancelled',
    cancelledAt: new Date().toISOString()
  });

  res.json({ success: true, message: 'Request cancelled successfully.' });
});

// ── POST /api/requests/:id/auto-assign ─────────────────────
router.post('/:id/auto-assign', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request || request.userId !== req.user.id)
    return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending')
    return res.status(400).json({ error: 'Only pending requests can be auto-assigned.' });

  db.requests.update(request.id, {
    dispatchMode: 'auto',
    forceAutoAssign: true
  });

  let result = runPass(request.id, 1);
  let updated = db.requests.getById(request.id);

  if (updated && updated.status !== 'accepted') {
    result = runPass(request.id, 3);
    updated = db.requests.getById(request.id);
  }
  if (updated && updated.status !== 'accepted') {
    result = runPass(request.id, 4);
    updated = db.requests.getById(request.id);
  }

  res.json({
    success: true,
    message: updated?.status === 'accepted'
      ? `⚡ Auto-assigned to ${updated.technicianName} (Pass ${updated.passNumber})!`
      : 'Searching for available technicians…',
    request: {
      ...updated,
      passLabel: passLabel(updated)
    },
    result
  });
});

// ── POST /api/requests/:id/escalate ───────────────────────
router.post('/:id/escalate', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending')
    return res.status(400).json({ error: 'Only pending requests can be escalated.' });

  const currentPass = request.passNumber || 0;
  let nextPass;
  if (currentPass === 0) nextPass = 1;
  else if (currentPass < 3) nextPass = currentPass + 1;
  else nextPass = 4;

  db.requests.update(request.id, {
    forcePass: nextPass,
    passStatus: 'declined_requeued'
  });

  const result = runPass(request.id, nextPass);
  const updated = db.requests.getById(request.id);

  res.json({
    success: true,
    message: `Escalated to Pass ${nextPass}! ${updated?.status === 'accepted' ? `Auto-assigned to ${updated.technicianName}` : 'Searching for technicians…'}`,
    request: {
      ...updated,
      passLabel: passLabel(updated)
    },
    result
  });
});

// ── PUT /api/requests/:id/reject-technician ───────────────
// Customer unbinds/rejects the assigned partner (e.g. chosen by mistake)
router.put('/:id/reject-technician', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request || request.userId !== req.user.id)
    return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'accepted' && request.status !== 'pending_completion')
    return res.status(400).json({ error: 'Can only reject partner for active jobs.' });

  const techId = request.technicianId;
  const reason = (req.body.reason || 'Customer rejected partner / assigned mistakenly').trim();

  // Free up technician capacity
  if (techId) {
    const tech = db.technicians.getById(techId);
    if (tech && tech.activeJobs > 0) {
      db.technicians.update(techId, { activeJobs: Math.max(0, tech.activeJobs - 1) });
    }
  }

  // Record rejection in history and in rejectedByTechIds so same tech isn't immediately re-assigned
  const rejectedByTechIds = request.rejectedByTechIds || [];
  if (techId && !rejectedByTechIds.includes(techId)) {
    rejectedByTechIds.push(techId);
  }

  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1,
    at: new Date().toISOString(),
    result: 'customer_rejected_partner',
    techId,
    techName: request.technicianName,
    reason
  });

  db.requests.update(request.id, {
    status:           'pending',
    technicianId:     null,
    technicianName:   null,
    technicianPhone:  null,
    technicianAvatar: '',
    acceptedAt:       null,
    techCompletedAt:  null,
    completionOtp:    null,
    rejectionReason:  reason,
    rejectedByTechIds,
    passStatus:       'declined_requeued',
    passLog
  });

  // Re-run matching pass to find another technician
  runPass(request.id, 1);
  const refreshed = db.requests.getById(request.id);

  res.json({
    success: true,
    message: 'Partner unassigned. Request returned to matching pool.',
    request: {
      ...refreshed,
      passLabel: passLabel(refreshed)
    }
  });
});

// ── PUT /api/requests/:id/confirm-completion ──────────────
// Customer approves the completed work (Dual Confirmation / Two-Way Handshake)
router.put('/:id/confirm-completion', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request || request.userId !== req.user.id)
    return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending_completion' && request.status !== 'accepted')
    return res.status(400).json({ error: 'Job is not awaiting completion confirmation.' });

  // Optional OTP verification if submitted by technician
  const { otp } = req.body;
  if (request.completionOtp && otp && String(otp).trim() !== String(request.completionOtp).trim()) {
    return res.status(400).json({ error: 'Incorrect verification code. Please check with your technician.' });
  }

  const now = new Date().toISOString();
  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1,
    at: now,
    result: 'dual_completion_approved_by_customer',
    customerName: request.userName,
    techName: request.technicianName
  });

  // Free technician capacity & increment completed total
  if (request.technicianId) {
    const tech = db.technicians.getById(request.technicianId);
    if (tech) {
      db.technicians.update(tech.id, {
        activeJobs: Math.max(0, tech.activeJobs - 1),
        totalJobs:  (tech.totalJobs || 0) + 1
      });
    }
  }

  const updated = db.requests.update(request.id, {
    status:             'completed',
    customerApprovedAt: now,
    completedAt:        now,
    passLog
  });

  res.json({
    success: true,
    message: 'Work completion verified and approved! You can now proceed to payment and review.',
    request: {
      ...updated,
      passLabel: passLabel(updated)
    }
  });
});

// ── PUT /api/requests/:id/dispute-completion ──────────────
// Customer disputes unverified completion
router.put('/:id/dispute-completion', auth, (req, res) => {
  const request = db.requests.getById(req.params.id);
  if (!request || request.userId !== req.user.id)
    return res.status(404).json({ error: 'Request not found.' });

  const reason = (req.body.reason || 'Work incomplete / issue not resolved').trim();
  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1,
    at: new Date().toISOString(),
    result: 'completion_disputed_by_customer',
    reason
  });

  const updated = db.requests.update(request.id, {
    status: 'accepted',
    rejectionReason: reason,
    passLog
  });

  res.json({
    success: true,
    message: 'Dispute recorded. Status returned to In Progress for technician resolution.',
    request: {
      ...updated,
      passLabel: passLabel(updated)
    }
  });
});

// ── POST /api/requests/run-pass ────────────────────────────
router.post('/run-pass', (_req, res) => {
  const stats = runPass();
  res.json({ success: true, stats });
});

module.exports = router;
