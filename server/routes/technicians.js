// ============================================================
//  RECIVERSE – Technician Routes (SQLite Powered)
// ============================================================

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database');
const { runPass, recordTechResponseTime } = require('../matchingEngine');

const SECRET  = 'reciverse_jwt_secret_2024';

const ALL_CATEGORIES = [
  'Washing Machine','Refrigerator','Air Conditioner','Television',
  'Laptop/Computer','Mobile Phone','Microwave','Geyser/Water Heater',
  'Water Purifier','Vehicle (2-Wheeler)','Vehicle (4-Wheeler)',
  'Fan/Motor','CCTV/Security System','Printer/Scanner',
  'Inverter/UPS','Other Appliance'
];

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'technician')
      return res.status(403).json({ error: 'Invalid token type' });
    req.tech = decoded;
    next();
  } catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}

function computeAchievements(tech) {
  const badges = [];
  if (tech.totalJobs >= 10)  badges.push({ id:'jobs10',   icon:'🔧', label:'10 Jobs Done' });
  if (tech.totalJobs >= 50)  badges.push({ id:'jobs50',   icon:'⚡', label:'50 Jobs Milestone' });
  if (tech.totalJobs >= 100) badges.push({ id:'jobs100',  icon:'💯', label:'100 Jobs Champion' });
  if (tech.totalJobs >= 500) badges.push({ id:'jobs500',  icon:'🏆', label:'500 Jobs Legend' });
  if (tech.rating >= 4.5)    badges.push({ id:'toprated', icon:'⭐', label:'Top Rated' });
  if (tech.rating >= 4.9)    badges.push({ id:'elite',    icon:'💎', label:'Elite Tech' });
  const acc = (tech.acceptedCount || 0);
  const dec = (tech.declinedCount || 0);
  const accRate = (acc + dec) > 0 ? acc / (acc + dec) : 1;
  if (accRate >= 0.9 && (acc + dec) >= 5)
    badges.push({ id:'reliable', icon:'✅', label:'Highly Reliable' });
  const expYears = parseInt(tech.experience) || 0;
  if (expYears >= 5)  badges.push({ id:'exp5',  icon:'🎓', label:'5+ Years Expert' });
  if (expYears >= 10) badges.push({ id:'exp10', icon:'👑', label:'10+ Years Veteran' });
  if (tech.isOnline)  badges.push({ id:'online', icon:'🟢', label:'Available Now' });

  const skillCount = (tech.skills || []).length;
  if (skillCount >= 3) badges.push({ id:'multiskill', icon:'🛠️', label:'Multi-Skilled Tech' });
  if (skillCount >= 6) badges.push({ id:'master',     icon:'🌟', label:'Master All-Rounder' });
  if (tech.verified)   badges.push({ id:'verified',   icon:'🛡️', label:'Platform Verified' });

  return badges;
}

// ── POST /api/technicians/register ───────────────────────
router.post('/register', async (req, res) => {
  const { name, email, phone, password, city, skills, experience, workingStyle, bio, interviewAnswers } = req.body;
  if (!name || !email || !phone || !password || !city || !skills || !experience)
    return res.status(400).json({ error: 'All required fields must be filled.' });

  const existing = db.technicians.getByEmail(email);
  if (existing)
    return res.status(400).json({ error: 'Email already registered.' });

  const skillList = Array.isArray(skills) ? skills : [skills];
  if (skillList.length === 0)
    return res.status(400).json({ error: 'Select at least one skill.' });

  const initialSkillDetails = {};
  skillList.forEach(s => {
    initialSkillDetails[s] = {
      verified: true,
      score: 100,
      verifiedAt: new Date().toISOString()
    };
  });

  const hashedPassword = await bcrypt.hash(password, 10);
  const tech = db.technicians.create({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone.trim(),
    city: city.trim(),
    skills: skillList,
    skillDetails: initialSkillDetails,
    experience: experience.trim(),
    workingStyle: workingStyle || 'Flexible',
    bio: (bio || '').trim(),
    interviewAnswers: interviewAnswers || [],
    password: hashedPassword,
    rating: 0,
    ratingCount: 0,
    ratingBreakdown: { 1:0, 2:0, 3:0, 4:0, 5:0 },
    totalJobs: 0,
    activeJobs: 0,
    maxCapacity: 10,
    acceptedCount: 0,
    declinedCount: 0,
    verified: true,
    isOnline: true,
    isBanned: false,
    avatar: '',
    createdAt: new Date().toISOString(),
    reviews: []
  });

  runPass();

  const token = jwt.sign({ id: tech.id, type: 'technician' }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = tech;
  safe.achievements = computeAchievements(safe);
  res.status(201).json({ token, technician: safe });
});

// ── POST /api/technicians/login ───────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const tech = db.technicians.getByEmail(email);
  if (!tech) return res.status(400).json({ error: 'No technician account with this email.' });
  if (tech.isBanned) return res.status(403).json({ error: 'Account suspended. Contact support.' });

  const ok = await bcrypt.compare(password, tech.password);
  if (!ok) return res.status(400).json({ error: 'Incorrect password.' });

  const updatedTech = db.technicians.update(tech.id, { isOnline: true });
  runPass();

  const token = jwt.sign({ id: updatedTech.id, type: 'technician' }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = updatedTech;
  safe.achievements = computeAchievements(safe);
  res.json({ token, technician: safe });
});

// ── GET /api/technicians ──────────────────────────────────
router.get('/', (_req, res) => {
  const techs = db.technicians.getAll().map(({ password, ...t }) => ({
    ...t,
    achievements: computeAchievements(t)
  }));
  res.json(techs);
});

// ── GET /api/technicians/me ───────────────────────────────
router.get('/me', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });
  const { password: _, ...safe } = tech;
  safe.achievements = computeAchievements(safe);
  res.json(safe);
});

// ── GET /api/technicians/:id/public ──────────────────────
router.get('/:id/public', (req, res) => {
  const tech = db.technicians.getById(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found.' });
  const reviews = db.reviews.getByTechId(tech.id);
  const { password, email, phone, ...safe } = tech;
  safe.achievements = computeAchievements(safe);
  safe.reviews      = reviews.slice(0, 20);
  res.json(safe);
});

// ── GET /api/technicians/categories ──────────────────────
router.get('/categories', (_req, res) => {
  res.json(ALL_CATEGORIES);
});

// ── GET /api/technicians/available-requests ───────────────
router.get('/available-requests', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const allRequests = db.requests.getAll();
  const techSkills = (tech.skills || []).map(s => s.toLowerCase());

  const requests = allRequests.filter(r => {
    if (r.status !== 'pending') return false;
    const skillMatch = techSkills.includes((r.productCategory || '').toLowerCase());
    if (!skillMatch) return false;
    const notDeclined = !(r.rejectedByTechIds || []).includes(tech.id);
    if (!notDeclined) return false;

    const pass = r.passNumber || 0;
    if (pass === 2) {
      return (r.notifiedTechIds || []).includes(tech.id);
    }
    return true;
  });

  res.json(requests);
});

// ── GET /api/technicians/my-jobs ──────────────────────────
router.get('/my-jobs', auth, (req, res) => {
  const jobs = db.requests.getByTechId(req.tech.id);
  res.json(jobs);
});

// ── GET /api/technicians/earnings ────────────────────────
router.get('/earnings', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  const jobs = db.requests.getByTechId(req.tech.id).filter(r => r.status === 'completed');
  const reviews = db.reviews.getByTechId(req.tech.id);
  const fiveStarCount = reviews.filter(r => r.rating === 5).length;
  const estimated = jobs.length * 200 + fiveStarCount * 50;
  res.json({
    completedJobs: jobs.length,
    estimatedEarnings: estimated,
    averageRating: tech?.rating || 0,
    totalReviews: reviews.length
  });
});

// ── PUT /api/technicians/profile ─────────────────────────
router.put('/profile', auth, async (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const { name, phone, city, bio, workingStyle, avatar, experience, currentPassword, newPassword } = req.body;
  const updates = {};

  if (name)        updates.name        = name.trim();
  if (phone)       updates.phone       = phone.trim();
  if (city)        updates.city        = city.trim();
  if (experience)  updates.experience  = experience.trim();
  if (workingStyle) updates.workingStyle = workingStyle.trim();
  if (typeof bio !== 'undefined') updates.bio = bio.trim();
  if (avatar)      updates.avatar      = avatar;

  if (newPassword) {
    if (!currentPassword) return res.status(400).json({ error: 'Current password required.' });
    const ok = await bcrypt.compare(currentPassword, tech.password);
    if (!ok) return res.status(400).json({ error: 'Current password incorrect.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    updates.password = await bcrypt.hash(newPassword, 10);
  }

  updates.updatedAt = new Date().toISOString();
  const updated = db.technicians.update(req.tech.id, updates);

  const { password: _, ...safe } = updated;
  safe.achievements = computeAchievements(safe);
  res.json({ technician: safe });
});

// ── PUT /api/technicians/skills/add ──────────────────────
router.put('/skills/add', auth, (req, res) => {
  const { skill, verified, assessmentScore } = req.body;
  if (!skill) return res.status(400).json({ error: 'Skill is required.' });
  if (!ALL_CATEGORIES.includes(skill))
    return res.status(400).json({ error: 'Invalid skill category.' });

  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const skills = tech.skills || [];
  const skillDetails = tech.skillDetails || {};

  if (!skills.includes(skill)) {
    skills.push(skill);
  }

  skillDetails[skill] = {
    verified: verified !== false,
    score: assessmentScore || 100,
    verifiedAt: new Date().toISOString()
  };

  const updated = db.technicians.update(req.tech.id, {
    skills,
    skillDetails,
    updatedAt: new Date().toISOString()
  });

  runPass();

  const { password: _, ...safe } = updated;
  safe.achievements = computeAchievements(safe);
  res.json({
    success: true,
    skills: safe.skills,
    skillDetails: safe.skillDetails,
    technician: safe
  });
});

// ── DELETE /api/technicians/skills/:skill ─────────────────
router.delete('/skills/:skill', auth, (req, res) => {
  const skill = decodeURIComponent(req.params.skill);
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  if ((tech.skills || []).length <= 1)
    return res.status(400).json({ error: 'You must maintain at least one skill category.' });

  const skills = (tech.skills || []).filter(s => s !== skill);
  const skillDetails = tech.skillDetails || {};
  delete skillDetails[skill];

  const updated = db.technicians.update(req.tech.id, {
    skills,
    skillDetails,
    updatedAt: new Date().toISOString()
  });

  const { password: _, ...safe } = updated;
  safe.achievements = computeAchievements(safe);
  res.json({
    success: true,
    skills: safe.skills,
    skillDetails: safe.skillDetails,
    technician: safe
  });
});

// ── PUT /api/technicians/toggle-online ───────────────────
router.put('/toggle-online', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });
  const updated = db.technicians.update(req.tech.id, { isOnline: !tech.isOnline });

  if (updated.isOnline) runPass();

  res.json({ isOnline: updated.isOnline });
});

// ── PUT /api/technicians/requests/:id/accept ─────────────
router.put('/requests/:id/accept', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  if (tech.activeJobs >= tech.maxCapacity)
    return res.status(400).json({ error: `Capacity full (${tech.maxCapacity} active jobs max).` });

  const request = db.requests.getById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending')
    return res.status(400).json({ error: 'Request already accepted by someone else.' });

  const techSkills = (tech.skills || []).map(s => s.toLowerCase());
  const reqCat = (request.productCategory || '').toLowerCase();
  if (!techSkills.includes(reqCat))
    return res.status(400).json({ error: 'This request does not match your skills.' });
  if ((request.rejectedByTechIds || []).includes(tech.id))
    return res.status(400).json({ error: 'You previously declined this request.' });

  const now = new Date().toISOString();
  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1, at: now,
    result: 'tech_self_accepted', techId: tech.id, techName: tech.name
  });

  const updatedReq = db.requests.update(request.id, {
    status:           'accepted',
    technicianId:     tech.id,
    technicianName:   tech.name,
    technicianPhone:  tech.phone,
    technicianAvatar: tech.avatar || '',
    acceptedAt:       now,
    passLog
  });

  let avgResponseMs = tech.avgResponseMs || 0;
  let responseTimeCount = tech.responseTimeCount || 0;
  const assignedAt = request.lastPassAt || request.createdAt;
  if (assignedAt) {
    const latencyMs = Date.now() - new Date(assignedAt).getTime();
    if (latencyMs > 0 && latencyMs < 24 * 3600 * 1000) {
      avgResponseMs = responseTimeCount === 0 ? latencyMs : Math.round(avgResponseMs * 0.7 + latencyMs * 0.3);
      responseTimeCount += 1;
    }
  }

  db.technicians.update(tech.id, {
    activeJobs:        tech.activeJobs + 1,
    acceptedCount:     (tech.acceptedCount || 0) + 1,
    avgResponseMs,
    responseTimeCount
  });

  res.json({ success: true, request: updatedReq });
});

// ── PUT /api/technicians/requests/:id/decline ─────────────
router.put('/requests/:id/decline', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const request = db.requests.getById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  db.technicians.update(tech.id, {
    declinedCount: (tech.declinedCount || 0) + 1
  });

  const notifiedTechIds = (request.notifiedTechIds || []).filter(id => id !== tech.id);
  const rejectedByTechIds = request.rejectedByTechIds || [];
  if (!rejectedByTechIds.includes(tech.id)) {
    rejectedByTechIds.push(tech.id);
  }

  const reqUpdates = {
    notifiedTechIds,
    rejectedByTechIds
  };

  if (request.suggestedTechnicianId === tech.id) {
    reqUpdates.suggestedTechnicianId   = null;
    reqUpdates.suggestedTechnicianName = null;
    reqUpdates.suggestedTechScore      = null;
    reqUpdates.passStatus              = 'declined_requeued';
  }

  db.requests.update(request.id, reqUpdates);

  const passResult = runPass();

  res.json({
    success: true,
    message: 'Declined. Request immediately requeued for next matching technician.',
    passResult
  });
});

// ── PUT /api/technicians/requests/:id/complete ────────────
// Technician completes work and requests Customer Approval (Mutual Assurance Step 1)
router.put('/requests/:id/complete', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const request = db.requests.getById(req.params.id);
  if (!request || request.technicianId !== tech.id)
    return res.status(404).json({ error: 'Job not found.' });

  const now = new Date().toISOString();
  // 4-digit mutual verification code
  const completionOtp = Math.floor(1000 + Math.random() * 9000).toString();

  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1,
    at: now,
    result: 'tech_marked_completed_awaiting_customer',
    techId: tech.id,
    techName: tech.name,
    otp: completionOtp
  });

  const updatedReq = db.requests.update(request.id, {
    status:          'pending_completion',
    techCompletedAt: now,
    completionOtp,
    passLog
  });

  res.json({
    success: true,
    pendingApproval: true,
    completionOtp,
    message: `Work completed! Verification code is ${completionOtp}. Awaiting customer approval.`,
    request: updatedReq
  });
});

// ── PUT /api/technicians/requests/:id/release ─────────────
// Technician releases an accepted job if accepted by mistake or unable to attend
router.put('/requests/:id/release', auth, (req, res) => {
  const tech = db.technicians.getById(req.tech.id);
  if (!tech) return res.status(404).json({ error: 'Not found.' });

  const request = db.requests.getById(req.params.id);
  if (!request || request.technicianId !== tech.id)
    return res.status(404).json({ error: 'Job not found.' });

  const reason = (req.body.reason || 'Technician released job / accepted mistakenly').trim();

  // Free technician capacity
  db.technicians.update(tech.id, {
    activeJobs: Math.max(0, tech.activeJobs - 1),
    declinedCount: (tech.declinedCount || 0) + 1
  });

  const rejectedByTechIds = request.rejectedByTechIds || [];
  if (!rejectedByTechIds.includes(tech.id)) {
    rejectedByTechIds.push(tech.id);
  }

  const passLog = request.passLog || [];
  passLog.push({
    pass: request.passNumber || 1,
    at: new Date().toISOString(),
    result: 'technician_released_active_job',
    techId: tech.id,
    techName: tech.name,
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

  // Automatically requeue request in matching engine
  runPass(request.id, 1);

  res.json({
    success: true,
    message: 'Job released and returned to matching pool for other technicians.'
  });
});

module.exports = router;
