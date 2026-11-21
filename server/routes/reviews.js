// ============================================================
//  RECIVERSE – Reviews & Ratings Routes (SQLite Powered)
// ============================================================

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database');

const SECRET  = 'reciverse_jwt_secret_2024';
const TAGS    = ['Professional', 'On-time', 'Expert', 'Friendly', 'Clean work', 'Fair price', 'Would recommend'];

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'user') return res.status(403).json({ error: 'Only users can post reviews.' });
    req.user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}

// Recalculate tech rating from all reviews
function recalcRating(techId, reviews) {
  const techReviews = reviews.filter(r => r.technicianId === techId);
  if (techReviews.length === 0) return { rating: 0, ratingCount: 0, ratingBreakdown: { 5:0,4:0,3:0,2:0,1:0 } };
  const breakdown = { 5:0, 4:0, 3:0, 2:0, 1:0 };
  let total = 0;
  techReviews.forEach(r => {
    total += r.rating;
    breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
  });
  return {
    rating: Math.round((total / techReviews.length) * 10) / 10,
    ratingCount: techReviews.length,
    ratingBreakdown: breakdown
  };
}

// ── POST /api/reviews ─────────────────────────────────────
router.post('/', auth, (req, res) => {
  const { requestId, rating, comment, tags } = req.body;
  if (!requestId || !rating)
    return res.status(400).json({ error: 'requestId and rating are required.' });

  const ratingNum = parseInt(rating);
  if (ratingNum < 1 || ratingNum > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

  const request = db.requests.getById(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.userId !== req.user.id)
    return res.status(403).json({ error: 'You can only review your own requests.' });
  if (request.status !== 'completed')
    return res.status(400).json({ error: 'Can only review completed jobs.' });
  if (request.hasReview)
    return res.status(400).json({ error: 'You already reviewed this job.' });

  const review = db.reviews.create({
    id:            uuidv4(),
    requestId,
    userId:        req.user.id,
    technicianId:  request.technicianId,
    rating:        ratingNum,
    comment:       (comment || '').trim(),
    tags:          (tags || []).filter(t => TAGS.includes(t)),
    productCategory: request.productCategory,
    createdAt:     new Date().toISOString()
  });

  // Mark request as reviewed in SQLite
  db.requests.update(requestId, { hasReview: true });

  // Update technician rating in SQLite
  if (request.technicianId) {
    const techReviews = db.reviews.getByTechId(request.technicianId);
    const stats = recalcRating(request.technicianId, techReviews);
    db.technicians.update(request.technicianId, {
      rating:          stats.rating,
      ratingCount:     stats.ratingCount,
      ratingBreakdown: stats.ratingBreakdown
    });
  }

  res.status(201).json({ review });
});

// ── GET /api/reviews/technician/:id ──────────────────────
router.get('/technician/:id', (req, res) => {
  const reviews = db.reviews.getByTechId(req.params.id);
  res.json(reviews);
});

// ── GET /api/reviews/request/:id ─────────────────────────
router.get('/request/:id', (req, res) => {
  const review = db.reviews.getByRequestId(req.params.id);
  res.json(review || null);
});

// ── GET /api/reviews/tags ─────────────────────────────────
router.get('/tags', (_req, res) => res.json(TAGS));

module.exports = router;
