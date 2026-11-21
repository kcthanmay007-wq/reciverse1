// ============================================================
//  RECIVERSE — Smart Matching Engine  (v4 — True Auto-Assign)
//
//  Scoring (max ~140 pts) with pass-adaptive weights:
//    ① Skill match          : 40 pts  (REQUIRED — no skill = excluded)
//    ② Verified skill bonus :  5 pts  (passed diagnostic assessment)
//    ③ Rating               : 25 pts  (tech.rating / 5 * 25)
//    ④ Acceptance rate      : 15 pts  (accepted / total ratio)
//    ⑤ Availability (capacity):20 pts (free slots / maxCapacity)
//    ⑥ Response speed       : 10 pts  (avg accept latency — lower is better)
//    ⑦ Review tags bonus    :  5 pts  (positive tag count from reviews)
//    ⑧ City / distance      : 10 pts  (same city → full; else scaled per pass)
//    ⑨ Experience bonus     :  5 pts  (REDUCED heavily in pass 3+)
//    ⑩ Wait-time priority   :  5 pts  (bonus for requests stuck > 2 min)
//
//  PASS SYSTEM (urgency-driven):
//    URGENT:  Pass 1 → Pass 2 → Pass 3 → Pass 4 (overflow)
//    NORMAL:  Directly queued for Pass 3 (broad dispatch)
//
//  Pass 1 (urgent, online only, strict city):
//    • TOP-SCORED tech is HARD-ASSIGNED immediately (no waiting)
//    • 30-second accept window; decline → instant re-queue
//
//  Pass 2 (urgent P1-failed + general queue):
//    • Top 5 notified, same-city preference
//    • Wait-time bonus: +5 pts for requests that failed P1
//    • 2-minute window before escalation to P3
//
//  Pass 3 (normal urgency + failed P2):
//    • Includes offline techs, city weight halved
//    • Experience weight zeroed for stuck requests
//    • 5-minute window
//
//  Pass 4 (overflow — still unassigned after P3):
//    • City factor = 0, experience = 0
//    • Min score threshold reduced to just skill match
//    • Broadcasts to ALL eligible techs in platform
//
//  QUALITY GATES (apply every pass):
//    • Rating < 3.0   → excluded
//    • isBanned        → excluded
//    • Already declined this request → excluded
//    • Zero free capacity → excluded
//
//  RESPONSE TIME FACTOR:
//    tech.avgResponseMs: rolling average ms from assignment → acceptance
//    < 5 min  → 10 pts | < 15 min → 7 pts | < 30 min → 4 pts | else 0
// ============================================================

const db = require('./database');

const readR   = () => db.requests.getAll();
const writeR  = d  => {
  if (Array.isArray(d)) {
    for (const r of d) {
      db.requests.update(r.id, r);
    }
  }
};
const readT   = () => db.technicians.getAll();
const writeT  = d  => {
  if (Array.isArray(d)) {
    for (const t of d) {
      db.technicians.update(t.id, t);
    }
  }
};
const readRev = () => db.reviews.getAll();

// ── Review tag scoring map ────────────────────────────────────
const POSITIVE_TAGS = ['Professional','On-time','Expert','Friendly','Clean work','Fair price','Would recommend'];

function getReviewTagScore(techId, reviews) {
  const techReviews = reviews.filter(r => r.technicianId === techId);
  if (techReviews.length === 0) return 0;
  let tagHits = 0;
  techReviews.slice(-20).forEach(r => {
    (r.tags || []).forEach(t => { if (POSITIVE_TAGS.includes(t)) tagHits++; });
  });
  // Normalize: 5+ positive tags → 5 pts, scale down
  return Math.min(5, Math.round(tagHits / Math.max(techReviews.length, 1)));
}

// ── Response time score ───────────────────────────────────────
function getResponseTimeScore(tech) {
  const avg = tech.avgResponseMs;
  if (!avg || avg <= 0) return 5; // No history → neutral 5 pts (benefit of doubt)
  const minutes = avg / 60000;
  if (minutes < 5)  return 10;
  if (minutes < 15) return 7;
  if (minutes < 30) return 4;
  if (minutes < 60) return 2;
  return 0;
}

// ── Update rolling avg response time ─────────────────────────
function updateResponseTime(tech, assignedAt) {
  if (!assignedAt) return;
  const latencyMs = Date.now() - new Date(assignedAt).getTime();
  if (latencyMs < 0 || latencyMs > 24 * 3600 * 1000) return; // sanity check
  const prev = tech.avgResponseMs || 0;
  const count = (tech.responseTimeCount || 0);
  // Exponential moving average: 70% old + 30% new
  tech.avgResponseMs = count === 0 ? latencyMs : Math.round(prev * 0.7 + latencyMs * 0.3);
  tech.responseTimeCount = count + 1;
}

// ── CORE SCORING ──────────────────────────────────────────────
function computeScoreBreakdown(tech, request, passCapacityMap, opts = {}) {
  const {
    relaxOnline    = false,  // Pass 3+: allow offline techs
    cityWeight     = 10,     // 10 = full, 5 = P3 half, 0 = P4 none
    expWeight      = 5,      // 5 = normal, 0 = P3/P4 zeroed (give everyone a chance)
    waitBonus      = 0,      // +5 for stuck-pass requests
    reviews        = []      // pre-loaded reviews for efficiency
  } = opts;

  const reqCat = (request.productCategory || '').toLowerCase();
  const skillMatch = (tech.skills || []).some(s => s.toLowerCase() === reqCat);
  if (!skillMatch) return { eligible: false, reason: 'Skill mismatch', total: 0 };

  const usedInPass = (passCapacityMap && passCapacityMap.get(tech.id)) || 0;
  const maxCap = tech.maxCapacity || 10;
  const freeSlots = maxCap - (tech.activeJobs || 0) - usedInPass;
  if (freeSlots <= 0) return { eligible: false, reason: 'Capacity full', total: 0 };

  if (!relaxOnline && !tech.isOnline) return { eligible: false, reason: 'Offline', total: 0 };
  if (tech.isBanned) return { eligible: false, reason: 'Account suspended', total: 0 };
  if ((request.rejectedByTechIds || []).includes(tech.id)) return { eligible: false, reason: 'Previously declined', total: 0 };
  if ((tech.rating || 0) > 0 && tech.rating < 3.0) return { eligible: false, reason: 'Rating below threshold (< 3.0)', total: 0 };

  // ① Skill match: 40 pts
  const skillPts = 40;

  // ② Verified skill: +5 pts
  const hasVerified = tech.skillDetails && tech.skillDetails[request.productCategory]?.verified;
  const verifiedPts = hasVerified ? 5 : 0;

  // ③ Rating: 25 pts
  const ratingPts = Math.round(((tech.rating || 0) / 5) * 25);

  // ④ Acceptance rate: 15 pts
  const accepted = tech.acceptedCount || 0;
  const declined = tech.declinedCount || 0;
  const total = accepted + declined;
  const accRate = total > 0 ? accepted / total : 0.85; // Default 85% if no history
  const acceptPts = Math.round(accRate * 15);

  // ⑤ Availability: 20 pts
  const availPts = Math.round((freeSlots / maxCap) * 20);

  // ⑥ Response speed: 10 pts
  const responsePts = getResponseTimeScore(tech);

  // ⑦ Review tags: 5 pts
  const tagPts = getReviewTagScore(tech.id, reviews);

  // ⑧ City/distance: up to cityWeight pts (pass-adaptive)
  const sameCity = tech.city && request.city &&
    tech.city.toLowerCase().trim() === request.city.toLowerCase().trim();
  const cityPts = sameCity ? cityWeight : 0;

  // ⑨ Experience: up to expWeight pts (zeroed in P3/P4 for equity)
  let expPts = 0;
  if (expWeight > 0) {
    const expYears = parseInt(tech.experience) || 0;
    if (expYears >= 10) expPts = expWeight;
    else if (expYears >= 5) expPts = Math.round(expWeight * 0.8);
    else if (expYears >= 2) expPts = Math.round(expWeight * 0.5);
    else expPts = Math.round(expWeight * 0.2);
  }

  // ⑩ Wait-time bonus (for escalated/stuck requests)
  const waitPts = waitBonus;

  const totalScore = skillPts + verifiedPts + ratingPts + acceptPts + availPts +
                     responsePts + tagPts + cityPts + expPts + waitPts;

  return {
    eligible: true,
    total: totalScore,
    breakdown: {
      skill: skillPts,
      verified: verifiedPts,
      rating: ratingPts,
      acceptance: acceptPts,
      availability: availPts,
      responseSpeed: responsePts,
      reviewTags: tagPts,
      city: cityPts,
      experience: expPts,
      waitBonus: waitPts
    }
  };
}

function scoreTech(tech, request, passCapacityMap, opts) {
  return computeScoreBreakdown(tech, request, passCapacityMap, opts).total;
}

// ── PASS RUNNER ───────────────────────────────────────────────
// This is the core auto-assignment engine.
// It reads all pending requests, sorts them by urgency + age,
// then for each request determines which pass to run and either:
//   - HARD-ASSIGNS (Pass 1 urgent): sets status → 'accepted' directly
//   - NOTIFIES TOP N (Pass 2/3): sets suggestedTechnicianId for tech dashboard display
//   - BROADCASTS (Pass 4): marks for any-tech pickup
//
// Pass selection per request:
//   urgency=urgent, passNumber=0 → Pass 1 (instant hard-assign)
//   urgency=normal, passNumber=0 → Pass 3 (broad dispatch, no hard-assign)
//   failed P1 or stuck > 2 min   → Pass 2 (top-5 with wait bonus)
//   stuck > 5 min or failed P2   → Pass 3 (relaxed online, half city weight)
//   stuck > 10 min or failed P3  → Pass 4 (drop city+exp, broadcast all)
// ─────────────────────────────────────────────────────────────
function runPass(forceRequestId = null, targetPass = null) {
  const now      = Date.now();
  const requests = readR();
  const techs    = readT();
  const reviews  = readRev();

  const pending = requests.filter(r => r.status === 'pending');
  if (pending.length === 0) return { assigned: 0, unmatched: 0, total: 0 };

  // Urgent first, then oldest-wait first
  pending.sort((a, b) => {
    if (a.urgency === 'urgent' && b.urgency !== 'urgent') return -1;
    if (b.urgency === 'urgent' && a.urgency !== 'urgent') return  1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  const passCapacityMap = new Map(); // track in-session assignments
  let assigned  = 0;
  let unmatched = 0;
  let changed   = false;

  for (const req of pending) {
    if (forceRequestId && req.id !== forceRequestId) continue;

    const idx = requests.findIndex(r => r.id === req.id);
    if (idx === -1) continue;

    const waitedMs  = now - new Date(req.createdAt).getTime();
    const waitedMin = waitedMs / 60000;
    const currentPass = req.passNumber || 0;
    const lastPassMs = req.lastPassAt ? now - new Date(req.lastPassAt).getTime() : waitedMs;

    if (!requests[idx].passLog) requests[idx].passLog = [];

    // ── Determine which pass to execute ──────────────────────
    let execPass;
    if (targetPass) {
      execPass = targetPass;
    } else if (req.forcePass) {
      execPass = req.forcePass;
    } else if (currentPass === 0) {
      // Brand new request
      execPass = (req.urgency === 'urgent') ? 1 : 3;
    } else if (currentPass === 1 && (req.passStatus === 'declined_requeued' || req.passStatus === 'no_techs_available' || lastPassMs > 2 * 60 * 1000)) {
      execPass = 2;
    } else if (currentPass <= 2 && (req.passStatus === 'no_techs_available' || lastPassMs > 5 * 60 * 1000)) {
      execPass = 3;
    } else if (currentPass <= 3 && lastPassMs > 10 * 60 * 1000) {
      execPass = 4;
    } else if (currentPass === 3 && req.passStatus === 'pass3_broadcast' && lastPassMs > 2 * 60 * 1000) {
      // Re-broadcast P3 every 2 minutes to catch techs coming online
      execPass = 3;
    } else if (currentPass === 4 && (req.passStatus === 'pass4_overflow' || req.passStatus === 'no_coverage')) {
      // Pass 4 re-runs every cron cycle (30s) — keep trying until accepted
      execPass = 4;
    } else {
      // Already in-progress at this pass within cooldown window, skip this cycle
      continue;
    }

    const isStuck = currentPass >= 1 && (req.passStatus === 'declined_requeued' || req.passStatus === 'no_techs_available');
    const waitBonus = isStuck ? 5 : 0;

    const isAutoDispatch = (req.dispatchMode === 'auto' || req.urgency === 'urgent' || req.forceAutoAssign || targetPass === 1);

    function assignTo(top, passNum, passStatusName, pool) {
      const techIdx = techs.findIndex(t => t.id === top.tech.id);
      requests[idx].status             = 'accepted';
      requests[idx].technicianId       = top.tech.id;
      requests[idx].technicianName     = top.tech.name;
      requests[idx].technicianPhone    = top.tech.phone;
      requests[idx].technicianAvatar   = top.tech.avatar || '';
      requests[idx].acceptedAt         = new Date().toISOString();
      requests[idx].passNumber         = passNum;
      requests[idx].passStatus         = passStatusName;
      requests[idx].lastPassAt         = new Date().toISOString();
      requests[idx].suggestedTechnicianId   = top.tech.id;
      requests[idx].suggestedTechnicianName = top.tech.name;
      requests[idx].suggestedTechScore      = top.score;
      requests[idx].suggestedTechBreakdown  = top.details.breakdown;
      requests[idx].notifiedTechIds         = (pool || [top]).slice(0, 5).map(x => x.tech.id);
      requests[idx].forcePass               = null;
      requests[idx].forceAutoAssign         = null;
      requests[idx].passLog.push({
        pass: passNum,
        at: new Date().toISOString(),
        result: 'auto_assigned',
        techId: top.tech.id,
        techName: top.tech.name,
        score: top.score
      });

      if (techIdx !== -1) {
        techs[techIdx].activeJobs    = (techs[techIdx].activeJobs || 0) + 1;
        techs[techIdx].acceptedCount = (techs[techIdx].acceptedCount || 0) + 1;
      }
      passCapacityMap.set(top.tech.id, (passCapacityMap.get(top.tech.id) || 0) + 1);
      assigned++;
      changed = true;
    }

    // ════════════════════════════════════════════════════════
    //  PASS 1: Urgent / Auto-Dispatch — Hard auto-assign
    // ════════════════════════════════════════════════════════
    if (execPass === 1) {
      const scored = techs
        .map(t => {
          const d = computeScoreBreakdown(t, req, passCapacityMap, {
            relaxOnline: false, cityWeight: 10, expWeight: 5, waitBonus, reviews
          });
          return { tech: t, score: d.total, details: d };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        requests[idx].passNumber = 1;
        requests[idx].passStatus = 'no_techs_available';
        requests[idx].lastPassAt = new Date().toISOString();
        requests[idx].passLog.push({ pass: 1, at: new Date().toISOString(), result: 'no_techs' });
        unmatched++;
        changed = true;
        continue;
      }

      assignTo(scored[0], 1, 'pass1_auto_assigned', scored);
      continue;
    }

    // ════════════════════════════════════════════════════════
    //  PASS 2: Priority Queue (P1 failed + wait bonus)
    // ════════════════════════════════════════════════════════
    if (execPass === 2) {
      const scored = techs
        .map(t => {
          const d = computeScoreBreakdown(t, req, passCapacityMap, {
            relaxOnline: false, cityWeight: 10, expWeight: 5, waitBonus, reviews
          });
          return { tech: t, score: d.total, details: d };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        requests[idx].passNumber = 2;
        requests[idx].passStatus = 'no_techs_available';
        requests[idx].lastPassAt = new Date().toISOString();
        requests[idx].passLog.push({ pass: 2, at: new Date().toISOString(), result: 'no_techs' });
        unmatched++;
        changed = true;
        continue;
      }

      const top5 = scored.slice(0, 5);

      if (isAutoDispatch) {
        // True Auto-Dispatch: Hard-assign top available partner
        assignTo(top5[0], 2, 'pass2_auto_assigned', top5);
        continue;
      }

      // Open broadcast mode: notify top 5
      requests[idx].passNumber              = 2;
      requests[idx].passStatus              = 'pass2_notified';
      requests[idx].lastPassAt              = new Date().toISOString();
      requests[idx].notifiedTechIds         = top5.map(x => x.tech.id);
      requests[idx].suggestedTechnicianId   = top5[0].tech.id;
      requests[idx].suggestedTechnicianName = top5[0].tech.name;
      requests[idx].suggestedTechScore      = top5[0].score;
      requests[idx].suggestedTechBreakdown  = top5[0].details.breakdown;
      requests[idx].forcePass               = null;

      const lastLog = requests[idx].passLog[requests[idx].passLog.length - 1];
      if (!lastLog || lastLog.pass !== 2 || lastLog.topTech !== top5[0].tech.name) {
        requests[idx].passLog.push({
          pass: 2, at: new Date().toISOString(), result: 'notified_top5',
          count: top5.length, topTech: top5[0].tech.name, score: top5[0].score, waitBonus
        });
      }

      top5.forEach(x => {
        passCapacityMap.set(x.tech.id, (passCapacityMap.get(x.tech.id) || 0) + 1);
      });
      assigned++;
      changed = true;
      continue;
    }

    // ════════════════════════════════════════════════════════
    //  PASS 3: Relaxed — offline included, half city weight,
    //  zero experience weight (give all technicians a chance)
    // ════════════════════════════════════════════════════════
    if (execPass === 3) {
      const scored = techs
        .map(t => {
          const d = computeScoreBreakdown(t, req, passCapacityMap, {
            relaxOnline: true,   // ← include offline techs
            cityWeight: 5,       // ← reduced to 5
            expWeight: 0,        // ← zeroed for equity
            waitBonus,
            reviews
          });
          return { tech: t, score: d.total, details: d };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        requests[idx].passNumber = 3;
        requests[idx].passStatus = 'no_techs_available';
        requests[idx].lastPassAt = new Date().toISOString();
        requests[idx].passLog.push({ pass: 3, at: new Date().toISOString(), result: 'no_techs' });
        unmatched++;
        changed = true;
        continue;
      }

      const top = scored[0];
      const top10 = scored.slice(0, 10);

      if (isAutoDispatch) {
        // True Auto-Dispatch: Hard-assign top available partner
        assignTo(top, 3, 'pass3_auto_assigned', top10);
        continue;
      }

      // Open broadcast mode
      requests[idx].passNumber              = 3;
      requests[idx].passStatus              = 'pass3_broadcast';
      requests[idx].lastPassAt              = new Date().toISOString();
      requests[idx].suggestedTechnicianId   = top.tech.id;
      requests[idx].suggestedTechnicianName = top.tech.name;
      requests[idx].suggestedTechScore      = top.score;
      requests[idx].suggestedTechBreakdown  = top.details.breakdown;
      requests[idx].notifiedTechIds         = top10.map(x => x.tech.id);
      requests[idx].forcePass               = null;

      const lastLog = requests[idx].passLog[requests[idx].passLog.length - 1];
      if (!lastLog || lastLog.pass !== 3 || lastLog.topTech !== top.tech.name) {
        requests[idx].passLog.push({
          pass: 3, at: new Date().toISOString(), result: 'broadcast',
          count: scored.length, topTech: top.tech.name, score: top.score
        });
      }

      top10.forEach(x => {
        passCapacityMap.set(x.tech.id, (passCapacityMap.get(x.tech.id) || 0) + 1);
      });
      assigned++;
      changed = true;
      continue;
    }

    // ════════════════════════════════════════════════════════
    //  PASS 4: Overflow — city=0, exp=0, platform-wide
    // ════════════════════════════════════════════════════════
    if (execPass === 4) {
      const scored = techs
        .map(t => {
          const d = computeScoreBreakdown(t, req, passCapacityMap, {
            relaxOnline: true,
            cityWeight: 0,   // ← zero — ignore location entirely
            expWeight: 0,    // ← zero — only skill + rating matter
            waitBonus: 5,    // always give wait bonus in overflow
            reviews
          });
          return { tech: t, score: d.total, details: d };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        requests[idx].passNumber = 4;
        requests[idx].passStatus = 'no_coverage';
        requests[idx].lastPassAt = new Date().toISOString();
        requests[idx].passLog.push({ pass: 4, at: new Date().toISOString(), result: 'no_coverage' });
        unmatched++;
        changed = true;
        continue;
      }

      const top = scored[0];
      const allNotified = scored.slice(0, 20).map(x => x.tech.id);

      if (isAutoDispatch) {
        // True Auto-Dispatch: Hard-assign top available partner in overflow
        assignTo(top, 4, 'pass4_auto_assigned', scored);
        continue;
      }

      // Open broadcast mode
      requests[idx].passNumber              = 4;
      requests[idx].passStatus              = 'pass4_overflow';
      requests[idx].lastPassAt              = new Date().toISOString();
      requests[idx].suggestedTechnicianId   = top.tech.id;
      requests[idx].suggestedTechnicianName = top.tech.name;
      requests[idx].suggestedTechScore      = top.score;
      requests[idx].suggestedTechBreakdown  = top.details.breakdown;
      requests[idx].notifiedTechIds         = allNotified;
      requests[idx].forcePass               = null;

      const lastLog = requests[idx].passLog[requests[idx].passLog.length - 1];
      if (!lastLog || lastLog.pass !== 4 || lastLog.topTech !== top.tech.name) {
        requests[idx].passLog.push({
          pass: 4, at: new Date().toISOString(), result: 'overflow_broadcast',
          count: scored.length, topTech: top.tech.name, score: top.score
        });
      }

      allNotified.forEach(id => {
        passCapacityMap.set(id, (passCapacityMap.get(id) || 0) + 1);
      });
      assigned++;
      changed = true;
      continue;
    }
  }

  if (changed) {
    writeR(requests);
    writeT(techs); // Update tech activeJobs if any P1 hard-assigns happened
  }

  return {
    assigned,
    unmatched,
    total: pending.length,
    timestamp: new Date().toISOString()
  };
}

// ── PASS LABEL (for frontend display) ────────────────────────
function passLabel(req) {
  if (!req) return '⏳ Awaiting match';
  if (req.status === 'completed') return '🏁 Repair Completed & Approved';
  if (req.status === 'pending_completion') return '⏳ Work Finished — Awaiting Customer Approval';
  if (req.status === 'cancelled') return '✗ Request Cancelled';

  if (req.status === 'accepted') {
    const tech = req.technicianName || 'Technician';
    const pass = req.passNumber || 1;
    const icon = pass === 1 ? '⚡' : pass === 2 ? '📣' : '📡';
    return `${icon} Auto-Assigned to ${tech} (Pass ${pass})`;
  }

  const map = {
    pass1_auto_assigned: `⚡ Pass 1: Auto-Assigned (Urgent Dispatch)`,
    pass2_auto_assigned: `⚡ Pass 2: Auto-Assigned (Priority Queue)`,
    pass3_auto_assigned: `⚡ Pass 3: Auto-Assigned (Expanded Search)`,
    pass4_auto_assigned: `⚡ Pass 4: Auto-Assigned (Platform Overflow)`,
    pass2_notified:      `📣 Pass 2: Notifying Top 5 Technicians${req.suggestedTechnicianName ? ` (Best: ${req.suggestedTechnicianName})` : ''}`,
    pass3_broadcast:     `📡 Pass 3: Broadcast — All Area Technicians${req.suggestedTechnicianName ? ` (Top: ${req.suggestedTechnicianName})` : ''}`,
    pass4_overflow:      `🌐 Pass 4: Overflow — Platform-Wide Search`,
    declined_requeued:   `🔄 Re-queuing to Next Best Technician…`,
    no_techs_available:  `⚠️ No Technicians Available — Escalating to Next Pass…`,
    no_coverage:         `🚨 No Coverage Available — Please Try Again or Call Support`
  };
  return map[req.passStatus] || `⏳ Matching in Progress (Pass ${req.passNumber || 1})`;
}

// ── RESPONSE TIME UPDATER (called on tech accept) ─────────────
function recordTechResponseTime(techId, assignedAt) {
  const techs = readT();
  const idx = techs.findIndex(t => t.id === techId);
  if (idx === -1 || !assignedAt) return;
  updateResponseTime(techs[idx], assignedAt);
  writeT(techs);
}

module.exports = {
  runPass,
  scoreTech,
  computeScoreBreakdown,
  passLabel,
  recordTechResponseTime
};
