// ============================================================
//  RECIVERSE – Database Layer (SQLite via better-sqlite3)
//  Persistent local database stored in server/data/reciverse.db
// ============================================================

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'reciverse.db');
const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency & speed
db.pragma('journal_mode = WAL');

// ── Schema Initialization ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    city TEXT,
    password TEXT NOT NULL,
    about TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    totalRequests INTEGER DEFAULT 0,
    isBanned INTEGER DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS technicians (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    city TEXT,
    skills TEXT DEFAULT '[]',
    skillDetails TEXT DEFAULT '{}',
    experience TEXT DEFAULT '',
    workingStyle TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    interviewAnswers TEXT DEFAULT '[]',
    password TEXT NOT NULL,
    rating REAL DEFAULT 0,
    ratingCount INTEGER DEFAULT 0,
    ratingBreakdown TEXT DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}',
    totalJobs INTEGER DEFAULT 0,
    activeJobs INTEGER DEFAULT 0,
    maxCapacity INTEGER DEFAULT 10,
    acceptedCount INTEGER DEFAULT 0,
    declinedCount INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 1,
    isOnline INTEGER DEFAULT 1,
    isBanned INTEGER DEFAULT 0,
    avatar TEXT DEFAULT '',
    avgResponseMs INTEGER DEFAULT 0,
    responseTimeCount INTEGER DEFAULT 0,
    reviews TEXT DEFAULT '[]',
    createdAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    userId TEXT,
    userName TEXT,
    userPhone TEXT,
    userEmail TEXT,
    productCategory TEXT NOT NULL,
    productName TEXT,
    faultDescription TEXT NOT NULL,
    city TEXT,
    urgency TEXT DEFAULT 'normal',
    dispatchMode TEXT DEFAULT 'broadcast',
    status TEXT DEFAULT 'pending',
    technicianId TEXT,
    technicianName TEXT,
    technicianPhone TEXT,
    technicianAvatar TEXT DEFAULT '',
    passNumber INTEGER DEFAULT 0,
    passStatus TEXT DEFAULT 'pending',
    rejectedByTechIds TEXT DEFAULT '[]',
    notifiedTechIds TEXT DEFAULT '[]',
    passLog TEXT DEFAULT '[]',
    hasReview INTEGER DEFAULT 0,
    forceAutoAssign INTEGER DEFAULT 0,
    forcePass INTEGER,
    suggestedTechnicianId TEXT,
    suggestedTechnicianName TEXT,
    suggestedTechScore REAL,
    suggestedTechBreakdown TEXT,
    lastPassAt TEXT,
    paymentStatus TEXT DEFAULT 'unpaid',
    paymentId TEXT,
    paidAt TEXT,
    techCompletedAt TEXT,
    customerApprovedAt TEXT,
    completionOtp TEXT,
    rejectionReason TEXT,
    createdAt TEXT,
    acceptedAt TEXT,
    completedAt TEXT,
    cancelledAt TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    userId TEXT NOT NULL,
    technicianId TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    productCategory TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    userId TEXT NOT NULL,
    techId TEXT,
    amount REAL NOT NULL,
    method TEXT DEFAULT 'UPI',
    txnId TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'paid',
    sandbox INTEGER DEFAULT 1,
    razorpayEnv TEXT DEFAULT 'sandbox',
    paidAt TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS admin (
    id TEXT PRIMARY KEY DEFAULT 'admin',
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_requests_userId ON requests(userId);
  CREATE INDEX IF NOT EXISTS idx_requests_techId ON requests(technicianId);
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_reviews_techId  ON reviews(technicianId);
  CREATE INDEX IF NOT EXISTS idx_reviews_reqId   ON reviews(requestId);
  CREATE INDEX IF NOT EXISTS idx_payments_reqId  ON payments(requestId);
`);

// Safe column migrations for existing SQLite database files
const colsToAdd = [
  'ALTER TABLE requests ADD COLUMN techCompletedAt TEXT',
  'ALTER TABLE requests ADD COLUMN customerApprovedAt TEXT',
  'ALTER TABLE requests ADD COLUMN completionOtp TEXT',
  'ALTER TABLE requests ADD COLUMN rejectionReason TEXT',
  'ALTER TABLE payments ADD COLUMN customerName TEXT',
  'ALTER TABLE payments ADD COLUMN technicianName TEXT',
  'ALTER TABLE payments ADD COLUMN serviceCategory TEXT'
];
for (const sql of colsToAdd) {
  try { db.exec(sql); } catch {}
}

// ── JSON Hydration & Parsing Helpers ─────────────────────────
function parseUser(row) {
  if (!row) return null;
  return {
    ...row,
    isBanned: Boolean(row.isBanned)
  };
}

function parseTechnician(row) {
  if (!row) return null;
  return {
    ...row,
    skills: typeof row.skills === 'string' ? JSON.parse(row.skills || '[]') : (row.skills || []),
    skillDetails: typeof row.skillDetails === 'string' ? JSON.parse(row.skillDetails || '{}') : (row.skillDetails || {}),
    interviewAnswers: typeof row.interviewAnswers === 'string' ? JSON.parse(row.interviewAnswers || '[]') : (row.interviewAnswers || []),
    ratingBreakdown: typeof row.ratingBreakdown === 'string' ? JSON.parse(row.ratingBreakdown || '{"1":0,"2":0,"3":0,"4":0,"5":0}') : (row.ratingBreakdown || {}),
    reviews: typeof row.reviews === 'string' ? JSON.parse(row.reviews || '[]') : (row.reviews || []),
    verified: Boolean(row.verified),
    isOnline: Boolean(row.isOnline),
    isBanned: Boolean(row.isBanned)
  };
}

function parseRequest(row) {
  if (!row) return null;
  return {
    ...row,
    rejectedByTechIds: typeof row.rejectedByTechIds === 'string' ? JSON.parse(row.rejectedByTechIds || '[]') : (row.rejectedByTechIds || []),
    notifiedTechIds: typeof row.notifiedTechIds === 'string' ? JSON.parse(row.notifiedTechIds || '[]') : (row.notifiedTechIds || []),
    passLog: typeof row.passLog === 'string' ? JSON.parse(row.passLog || '[]') : (row.passLog || []),
    suggestedTechBreakdown: row.suggestedTechBreakdown && typeof row.suggestedTechBreakdown === 'string' ? JSON.parse(row.suggestedTechBreakdown) : row.suggestedTechBreakdown,
    hasReview: Boolean(row.hasReview),
    forceAutoAssign: Boolean(row.forceAutoAssign)
  };
}

function parseReview(row) {
  if (!row) return null;
  return {
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || [])
  };
}

function parsePayment(row) {
  if (!row) return null;
  return {
    ...row,
    sandbox: Boolean(row.sandbox)
  };
}

// ── One-Time Seed/Migration from JSON if tables are empty ─────
function autoMigrateFromJson() {
  // 1. Users
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const jsonPath = path.join(DATA_DIR, 'users.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const users = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const ins = db.prepare(`
          INSERT INTO users (id, name, email, phone, city, password, about, avatar, totalRequests, isBanned, createdAt, updatedAt)
          VALUES (@id, @name, @email, @phone, @city, @password, @about, @avatar, @totalRequests, @isBanned, @createdAt, @updatedAt)
        `);
        const insertMany = db.transaction((rows) => {
          for (const u of rows) {
            ins.run({
              id: u.id,
              name: u.name || '',
              email: (u.email || '').toLowerCase().trim(),
              phone: u.phone || '',
              city: u.city || '',
              password: u.password || '',
              about: u.about || '',
              avatar: u.avatar || '',
              totalRequests: u.totalRequests || 0,
              isBanned: u.isBanned ? 1 : 0,
              createdAt: u.createdAt || new Date().toISOString(),
              updatedAt: u.updatedAt || null
            });
          }
        });
        insertMany(users);
        console.log(`📦 [DB Migrate] Migrated ${users.length} users into SQLite`);
      } catch (err) {
        console.warn('⚠️  Could not auto-migrate users.json:', err.message);
      }
    }
  }

  // 2. Technicians
  const techCount = db.prepare('SELECT COUNT(*) as count FROM technicians').get().count;
  if (techCount === 0) {
    const jsonPath = path.join(DATA_DIR, 'technicians.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const techs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const ins = db.prepare(`
          INSERT INTO technicians (
            id, name, email, phone, city, skills, skillDetails, experience, workingStyle, bio,
            interviewAnswers, password, rating, ratingCount, ratingBreakdown, totalJobs, activeJobs,
            maxCapacity, acceptedCount, declinedCount, verified, isOnline, isBanned, avatar,
            avgResponseMs, responseTimeCount, reviews, createdAt, updatedAt
          ) VALUES (
            @id, @name, @email, @phone, @city, @skills, @skillDetails, @experience, @workingStyle, @bio,
            @interviewAnswers, @password, @rating, @ratingCount, @ratingBreakdown, @totalJobs, @activeJobs,
            @maxCapacity, @acceptedCount, @declinedCount, @verified, @isOnline, @isBanned, @avatar,
            @avgResponseMs, @responseTimeCount, @reviews, @createdAt, @updatedAt
          )
        `);
        const insertMany = db.transaction((rows) => {
          for (const t of rows) {
            ins.run({
              id: t.id,
              name: t.name || '',
              email: (t.email || '').toLowerCase().trim(),
              phone: t.phone || '',
              city: t.city || '',
              skills: JSON.stringify(t.skills || []),
              skillDetails: JSON.stringify(t.skillDetails || {}),
              experience: t.experience || '',
              workingStyle: t.workingStyle || '',
              bio: t.bio || '',
              interviewAnswers: JSON.stringify(t.interviewAnswers || []),
              password: t.password || '',
              rating: Number(t.rating || 0),
              ratingCount: Number(t.ratingCount || 0),
              ratingBreakdown: JSON.stringify(t.ratingBreakdown || {"1":0,"2":0,"3":0,"4":0,"5":0}),
              totalJobs: Number(t.totalJobs || 0),
              activeJobs: Number(t.activeJobs || 0),
              maxCapacity: Number(t.maxCapacity || 10),
              acceptedCount: Number(t.acceptedCount || 0),
              declinedCount: Number(t.declinedCount || 0),
              verified: t.verified === false ? 0 : 1,
              isOnline: t.isOnline ? 1 : 0,
              isBanned: t.isBanned ? 1 : 0,
              avatar: t.avatar || '',
              avgResponseMs: Number(t.avgResponseMs || 0),
              responseTimeCount: Number(t.responseTimeCount || 0),
              reviews: JSON.stringify(t.reviews || []),
              createdAt: t.createdAt || new Date().toISOString(),
              updatedAt: t.updatedAt || null
            });
          }
        });
        insertMany(techs);
        console.log(`📦 [DB Migrate] Migrated ${techs.length} technicians into SQLite`);
      } catch (err) {
        console.warn('⚠️  Could not auto-migrate technicians.json:', err.message);
      }
    }
  }

  // 3. Requests
  const reqCount = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
  if (reqCount === 0) {
    const jsonPath = path.join(DATA_DIR, 'requests.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const reqs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const ins = db.prepare(`
          INSERT INTO requests (
            id, userId, userName, userPhone, userEmail, productCategory, productName, faultDescription,
            city, urgency, dispatchMode, status, technicianId, technicianName, technicianPhone,
            technicianAvatar, passNumber, passStatus, rejectedByTechIds, notifiedTechIds, passLog,
            hasReview, forceAutoAssign, forcePass, suggestedTechnicianId, suggestedTechnicianName,
            suggestedTechScore, suggestedTechBreakdown, lastPassAt, paymentStatus, paymentId, paidAt,
            createdAt, acceptedAt, completedAt, cancelledAt
          ) VALUES (
            @id, @userId, @userName, @userPhone, @userEmail, @productCategory, @productName, @faultDescription,
            @city, @urgency, @dispatchMode, @status, @technicianId, @technicianName, @technicianPhone,
            @technicianAvatar, @passNumber, @passStatus, @rejectedByTechIds, @notifiedTechIds, @passLog,
            @hasReview, @forceAutoAssign, @forcePass, @suggestedTechnicianId, @suggestedTechnicianName,
            @suggestedTechScore, @suggestedTechBreakdown, @lastPassAt, @paymentStatus, @paymentId, @paidAt,
            @createdAt, @acceptedAt, @completedAt, @cancelledAt
          )
        `);
        const insertMany = db.transaction((rows) => {
          for (const r of rows) {
            ins.run({
              id: r.id,
              userId: r.userId || null,
              userName: r.userName || null,
              userPhone: r.userPhone || null,
              userEmail: r.userEmail || null,
              productCategory: r.productCategory || 'Other Appliance',
              productName: r.productName || r.productCategory,
              faultDescription: r.faultDescription || '',
              city: r.city || '',
              urgency: r.urgency || 'normal',
              dispatchMode: r.dispatchMode || 'broadcast',
              status: r.status || 'pending',
              technicianId: r.technicianId || null,
              technicianName: r.technicianName || null,
              technicianPhone: r.technicianPhone || null,
              technicianAvatar: r.technicianAvatar || '',
              passNumber: Number(r.passNumber || 0),
              passStatus: r.passStatus || 'pending',
              rejectedByTechIds: JSON.stringify(r.rejectedByTechIds || []),
              notifiedTechIds: JSON.stringify(r.notifiedTechIds || []),
              passLog: JSON.stringify(r.passLog || []),
              hasReview: r.hasReview ? 1 : 0,
              forceAutoAssign: r.forceAutoAssign ? 1 : 0,
              forcePass: r.forcePass ? Number(r.forcePass) : null,
              suggestedTechnicianId: r.suggestedTechnicianId || null,
              suggestedTechnicianName: r.suggestedTechnicianName || null,
              suggestedTechScore: r.suggestedTechScore ? Number(r.suggestedTechScore) : null,
              suggestedTechBreakdown: r.suggestedTechBreakdown ? JSON.stringify(r.suggestedTechBreakdown) : null,
              lastPassAt: r.lastPassAt || null,
              paymentStatus: r.paymentStatus || 'unpaid',
              paymentId: r.paymentId || null,
              paidAt: r.paidAt || null,
              createdAt: r.createdAt || new Date().toISOString(),
              acceptedAt: r.acceptedAt || null,
              completedAt: r.completedAt || null,
              cancelledAt: r.cancelledAt || null
            });
          }
        });
        insertMany(reqs);
        console.log(`📦 [DB Migrate] Migrated ${reqs.length} requests into SQLite`);
      } catch (err) {
        console.warn('⚠️  Could not auto-migrate requests.json:', err.message);
      }
    }
  }

  // 4. Reviews
  const revCount = db.prepare('SELECT COUNT(*) as count FROM reviews').get().count;
  if (revCount === 0) {
    const jsonPath = path.join(DATA_DIR, 'reviews.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const revs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const ins = db.prepare(`
          INSERT INTO reviews (id, requestId, userId, technicianId, rating, comment, tags, productCategory, createdAt)
          VALUES (@id, @requestId, @userId, @technicianId, @rating, @comment, @tags, @productCategory, @createdAt)
        `);
        const insertMany = db.transaction((rows) => {
          for (const r of rows) {
            ins.run({
              id: r.id,
              requestId: r.requestId,
              userId: r.userId,
              technicianId: r.technicianId,
              rating: Number(r.rating || 5),
              comment: r.comment || '',
              tags: JSON.stringify(r.tags || []),
              productCategory: r.productCategory || '',
              createdAt: r.createdAt || new Date().toISOString()
            });
          }
        });
        insertMany(revs);
        console.log(`📦 [DB Migrate] Migrated ${revs.length} reviews into SQLite`);
      } catch (err) {
        console.warn('⚠️  Could not auto-migrate reviews.json:', err.message);
      }
    }
  }

  // 5. Payments
  const payCount = db.prepare('SELECT COUNT(*) as count FROM payments').get().count;
  if (payCount === 0) {
    const jsonPath = path.join(DATA_DIR, 'payments.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const pays = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const ins = db.prepare(`
          INSERT INTO payments (id, requestId, userId, techId, amount, method, txnId, status, sandbox, razorpayEnv, paidAt, createdAt)
          VALUES (@id, @requestId, @userId, @techId, @amount, @method, @txnId, @status, @sandbox, @razorpayEnv, @paidAt, @createdAt)
        `);
        const insertMany = db.transaction((rows) => {
          for (const p of rows) {
            ins.run({
              id: p.id,
              requestId: p.requestId,
              userId: p.userId,
              techId: p.techId || null,
              amount: Number(p.amount || 0),
              method: p.method || 'UPI',
              txnId: p.txnId,
              status: p.status || 'paid',
              sandbox: p.sandbox === false ? 0 : 1,
              razorpayEnv: p.razorpayEnv || 'sandbox',
              paidAt: p.paidAt || new Date().toISOString(),
              createdAt: p.createdAt || new Date().toISOString()
            });
          }
        });
        insertMany(pays);
        console.log(`📦 [DB Migrate] Migrated ${pays.length} payments into SQLite`);
      } catch (err) {
        console.warn('⚠️  Could not auto-migrate payments.json:', err.message);
      }
    }
  }

  // 6. Admin
  const adminRow = db.prepare('SELECT * FROM admin WHERE id = ?').get('admin');
  if (!adminRow) {
    const jsonPath = path.join(DATA_DIR, 'admin.json');
    let admin = { email: 'admin@reciverse.com', password: '' };
    if (fs.existsSync(jsonPath)) {
      try {
        const a = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (a && a.email) admin = a;
      } catch {}
    }
    if (admin.password) {
      db.prepare('INSERT OR REPLACE INTO admin (id, email, password) VALUES (?, ?, ?)').run('admin', admin.email, admin.password);
      console.log('📦 [DB Migrate] Migrated admin credentials into SQLite');
    }
  }
}

autoMigrateFromJson();

// ── Convenient Model Helper Methods ──────────────────────────
const models = {
  db,

  users: {
    getAll: () => db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all().map(parseUser),
    getById: (id) => parseUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
    getByEmail: (email) => parseUser(db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email)),
    create: (u) => {
      db.prepare(`
        INSERT INTO users (id, name, email, phone, city, password, about, avatar, totalRequests, isBanned, createdAt, updatedAt)
        VALUES (@id, @name, @email, @phone, @city, @password, @about, @avatar, @totalRequests, @isBanned, @createdAt, @updatedAt)
      `).run({
        id: u.id,
        name: u.name,
        email: u.email.toLowerCase().trim(),
        phone: u.phone || '',
        city: u.city || '',
        password: u.password,
        about: u.about || '',
        avatar: u.avatar || '',
        totalRequests: u.totalRequests || 0,
        isBanned: u.isBanned ? 1 : 0,
        createdAt: u.createdAt || new Date().toISOString(),
        updatedAt: u.updatedAt || null
      });
      return models.users.getById(u.id);
    },
    update: (id, fields) => {
      const allowed = ['name','email','phone','city','password','about','avatar','totalRequests','isBanned','updatedAt'];
      const updates = [];
      const params = { id };
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) {
          updates.push(`${k} = @${k}`);
          params[k] = k === 'isBanned' ? (v ? 1 : 0) : v;
        }
      }
      if (updates.length > 0) {
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = @id`).run(params);
      }
      return models.users.getById(id);
    }
  },

  technicians: {
    getAll: () => db.prepare('SELECT * FROM technicians ORDER BY createdAt DESC').all().map(parseTechnician),
    getById: (id) => parseTechnician(db.prepare('SELECT * FROM technicians WHERE id = ?').get(id)),
    getByEmail: (email) => parseTechnician(db.prepare('SELECT * FROM technicians WHERE LOWER(email) = LOWER(?)').get(email)),
    create: (t) => {
      db.prepare(`
        INSERT INTO technicians (
          id, name, email, phone, city, skills, skillDetails, experience, workingStyle, bio,
          interviewAnswers, password, rating, ratingCount, ratingBreakdown, totalJobs, activeJobs,
          maxCapacity, acceptedCount, declinedCount, verified, isOnline, isBanned, avatar,
          avgResponseMs, responseTimeCount, reviews, createdAt, updatedAt
        ) VALUES (
          @id, @name, @email, @phone, @city, @skills, @skillDetails, @experience, @workingStyle, @bio,
          @interviewAnswers, @password, @rating, @ratingCount, @ratingBreakdown, @totalJobs, @activeJobs,
          @maxCapacity, @acceptedCount, @declinedCount, @verified, @isOnline, @isBanned, @avatar,
          @avgResponseMs, @responseTimeCount, @reviews, @createdAt, @updatedAt
        )
      `).run({
        id: t.id,
        name: t.name,
        email: t.email.toLowerCase().trim(),
        phone: t.phone || '',
        city: t.city || '',
        skills: JSON.stringify(t.skills || []),
        skillDetails: JSON.stringify(t.skillDetails || {}),
        experience: t.experience || '',
        workingStyle: t.workingStyle || '',
        bio: t.bio || '',
        interviewAnswers: JSON.stringify(t.interviewAnswers || []),
        password: t.password,
        rating: Number(t.rating || 0),
        ratingCount: Number(t.ratingCount || 0),
        ratingBreakdown: JSON.stringify(t.ratingBreakdown || {"1":0,"2":0,"3":0,"4":0,"5":0}),
        totalJobs: Number(t.totalJobs || 0),
        activeJobs: Number(t.activeJobs || 0),
        maxCapacity: Number(t.maxCapacity || 10),
        acceptedCount: Number(t.acceptedCount || 0),
        declinedCount: Number(t.declinedCount || 0),
        verified: t.verified === false ? 0 : 1,
        isOnline: t.isOnline === false ? 0 : 1,
        isBanned: t.isBanned ? 1 : 0,
        avatar: t.avatar || '',
        avgResponseMs: Number(t.avgResponseMs || 0),
        responseTimeCount: Number(t.responseTimeCount || 0),
        reviews: JSON.stringify(t.reviews || []),
        createdAt: t.createdAt || new Date().toISOString(),
        updatedAt: t.updatedAt || null
      });
      return models.technicians.getById(t.id);
    },
    update: (id, fields) => {
      const allowed = [
        'name','email','phone','city','skills','skillDetails','experience','workingStyle',
        'bio','interviewAnswers','password','rating','ratingCount','ratingBreakdown',
        'totalJobs','activeJobs','maxCapacity','acceptedCount','declinedCount','verified',
        'isOnline','isBanned','avatar','avgResponseMs','responseTimeCount','reviews','updatedAt'
      ];
      const updates = [];
      const params = { id };
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) {
          updates.push(`${k} = @${k}`);
          if (['skills','skillDetails','interviewAnswers','ratingBreakdown','reviews'].includes(k)) {
            params[k] = typeof v === 'string' ? v : JSON.stringify(v);
          } else if (['verified','isOnline','isBanned'].includes(k)) {
            params[k] = v ? 1 : 0;
          } else {
            params[k] = v;
          }
        }
      }
      if (updates.length > 0) {
        db.prepare(`UPDATE technicians SET ${updates.join(', ')} WHERE id = @id`).run(params);
      }
      return models.technicians.getById(id);
    }
  },

  requests: {
    getAll: () => db.prepare('SELECT * FROM requests ORDER BY createdAt DESC').all().map(parseRequest),
    getById: (id) => parseRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(id)),
    getByUserId: (userId) => db.prepare('SELECT * FROM requests WHERE userId = ? ORDER BY createdAt DESC').all(userId).map(parseRequest),
    getByTechId: (techId) => db.prepare('SELECT * FROM requests WHERE technicianId = ? ORDER BY createdAt DESC').all(techId).map(parseRequest),
    create: (r) => {
      db.prepare(`
        INSERT INTO requests (
          id, userId, userName, userPhone, userEmail, productCategory, productName, faultDescription,
          city, urgency, dispatchMode, status, technicianId, technicianName, technicianPhone,
          technicianAvatar, passNumber, passStatus, rejectedByTechIds, notifiedTechIds, passLog,
          hasReview, forceAutoAssign, forcePass, suggestedTechnicianId, suggestedTechnicianName,
          suggestedTechScore, suggestedTechBreakdown, lastPassAt, paymentStatus, paymentId, paidAt,
          techCompletedAt, customerApprovedAt, completionOtp, rejectionReason,
          createdAt, acceptedAt, completedAt, cancelledAt
        ) VALUES (
          @id, @userId, @userName, @userPhone, @userEmail, @productCategory, @productName, @faultDescription,
          @city, @urgency, @dispatchMode, @status, @technicianId, @technicianName, @technicianPhone,
          @technicianAvatar, @passNumber, @passStatus, @rejectedByTechIds, @notifiedTechIds, @passLog,
          @hasReview, @forceAutoAssign, @forcePass, @suggestedTechnicianId, @suggestedTechnicianName,
          @suggestedTechScore, @suggestedTechBreakdown, @lastPassAt, @paymentStatus, @paymentId, @paidAt,
          @techCompletedAt, @customerApprovedAt, @completionOtp, @rejectionReason,
          @createdAt, @acceptedAt, @completedAt, @cancelledAt
        )
      `).run({
        id: r.id,
        userId: r.userId || null,
        userName: r.userName || null,
        userPhone: r.userPhone || null,
        userEmail: r.userEmail || null,
        productCategory: r.productCategory,
        productName: r.productName || r.productCategory,
        faultDescription: r.faultDescription,
        city: r.city || '',
        urgency: r.urgency || 'normal',
        dispatchMode: r.dispatchMode || 'broadcast',
        status: r.status || 'pending',
        technicianId: r.technicianId || null,
        technicianName: r.technicianName || null,
        technicianPhone: r.technicianPhone || null,
        technicianAvatar: r.technicianAvatar || '',
        passNumber: Number(r.passNumber || 0),
        passStatus: r.passStatus || 'pending',
        rejectedByTechIds: JSON.stringify(r.rejectedByTechIds || []),
        notifiedTechIds: JSON.stringify(r.notifiedTechIds || []),
        passLog: JSON.stringify(r.passLog || []),
        hasReview: r.hasReview ? 1 : 0,
        forceAutoAssign: r.forceAutoAssign ? 1 : 0,
        forcePass: r.forcePass ? Number(r.forcePass) : null,
        suggestedTechnicianId: r.suggestedTechnicianId || null,
        suggestedTechnicianName: r.suggestedTechnicianName || null,
        suggestedTechScore: r.suggestedTechScore ? Number(r.suggestedTechScore) : null,
        suggestedTechBreakdown: r.suggestedTechBreakdown ? (typeof r.suggestedTechBreakdown === 'string' ? r.suggestedTechBreakdown : JSON.stringify(r.suggestedTechBreakdown)) : null,
        lastPassAt: r.lastPassAt || null,
        paymentStatus: r.paymentStatus || 'unpaid',
        paymentId: r.paymentId || null,
        paidAt: r.paidAt || null,
        techCompletedAt: r.techCompletedAt || null,
        customerApprovedAt: r.customerApprovedAt || null,
        completionOtp: r.completionOtp || null,
        rejectionReason: r.rejectionReason || null,
        createdAt: r.createdAt || new Date().toISOString(),
        acceptedAt: r.acceptedAt || null,
        completedAt: r.completedAt || null,
        cancelledAt: r.cancelledAt || null
      });
      return models.requests.getById(r.id);
    },
    update: (id, fields) => {
      const allowed = [
        'userId','userName','userPhone','userEmail','productCategory','productName',
        'faultDescription','city','urgency','dispatchMode','status','technicianId',
        'technicianName','technicianPhone','technicianAvatar','passNumber','passStatus',
        'rejectedByTechIds','notifiedTechIds','passLog','hasReview','forceAutoAssign',
        'forcePass','suggestedTechnicianId','suggestedTechnicianName','suggestedTechScore',
        'suggestedTechBreakdown','lastPassAt','paymentStatus','paymentId','paidAt',
        'techCompletedAt','customerApprovedAt','completionOtp','rejectionReason',
        'acceptedAt','completedAt','cancelledAt'
      ];
      const updates = [];
      const params = { id };
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) {
          updates.push(`${k} = @${k}`);
          if (['rejectedByTechIds','notifiedTechIds','passLog','suggestedTechBreakdown'].includes(k)) {
            params[k] = typeof v === 'string' ? v : JSON.stringify(v);
          } else if (['hasReview','forceAutoAssign'].includes(k)) {
            params[k] = v ? 1 : 0;
          } else {
            params[k] = v;
          }
        }
      }
      if (updates.length > 0) {
        db.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE id = @id`).run(params);
      }
      return models.requests.getById(id);
    },
    delete: (id) => {
      const res = db.prepare('DELETE FROM requests WHERE id = ?').run(id);
      return res.changes > 0;
    }
  },

  reviews: {
    getAll: () => db.prepare('SELECT * FROM reviews ORDER BY createdAt DESC').all().map(parseReview),
    getByTechId: (techId) => db.prepare('SELECT * FROM reviews WHERE technicianId = ? ORDER BY createdAt DESC').all(techId).map(parseReview),
    getByRequestId: (reqId) => parseReview(db.prepare('SELECT * FROM reviews WHERE requestId = ?').get(reqId)),
    create: (r) => {
      db.prepare(`
        INSERT INTO reviews (id, requestId, userId, technicianId, rating, comment, tags, productCategory, createdAt)
        VALUES (@id, @requestId, @userId, @technicianId, @rating, @comment, @tags, @productCategory, @createdAt)
      `).run({
        id: r.id,
        requestId: r.requestId,
        userId: r.userId,
        technicianId: r.technicianId,
        rating: Number(r.rating),
        comment: r.comment || '',
        tags: JSON.stringify(r.tags || []),
        productCategory: r.productCategory || '',
        createdAt: r.createdAt || new Date().toISOString()
      });
      return parseReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(r.id));
    }
  },

  payments: {
    getAll: () => {
      return db.prepare(`
        SELECT p.*, r.productCategory as serviceCategory, r.productName, r.userName as customerName, r.technicianName
        FROM payments p
        LEFT JOIN requests r ON p.requestId = r.id
        ORDER BY p.createdAt DESC
      `).all().map(parsePayment);
    },
    getByUserId: (userId) => db.prepare('SELECT * FROM payments WHERE userId = ? ORDER BY createdAt DESC').all(userId).map(parsePayment),
    getById: (id) => {
      const p = db.prepare(`
        SELECT p.*, r.productCategory as serviceCategory, r.productName, r.userName as customerName, r.technicianName
        FROM payments p
        LEFT JOIN requests r ON p.requestId = r.id
        WHERE p.id = ? OR p.requestId = ?
      `).get(id, id);
      return parsePayment(p);
    },
    getByRequestId: (requestId) => parsePayment(db.prepare('SELECT * FROM payments WHERE requestId = ?').get(requestId)),
    create: (p) => {
      db.prepare(`
        INSERT INTO payments (id, requestId, userId, techId, amount, method, txnId, status, sandbox, razorpayEnv, customerName, technicianName, serviceCategory, paidAt, createdAt)
        VALUES (@id, @requestId, @userId, @techId, @amount, @method, @txnId, @status, @sandbox, @razorpayEnv, @customerName, @technicianName, @serviceCategory, @paidAt, @createdAt)
      `).run({
        id: p.id,
        requestId: p.requestId,
        userId: p.userId,
        techId: p.techId || null,
        amount: Number(p.amount || 0),
        method: p.method || 'UPI',
        txnId: p.txnId,
        status: p.status || 'paid',
        sandbox: p.sandbox === false ? 0 : 1,
        razorpayEnv: p.razorpayEnv || 'sandbox',
        customerName: p.customerName || null,
        technicianName: p.technicianName || null,
        serviceCategory: p.serviceCategory || null,
        paidAt: p.paidAt || new Date().toISOString(),
        createdAt: p.createdAt || new Date().toISOString()
      });
      return models.payments.getById(p.id);
    }
  },

  admin: {
    get: () => db.prepare('SELECT * FROM admin WHERE id = ?').get('admin'),
    set: (email, password) => {
      db.prepare('INSERT OR REPLACE INTO admin (id, email, password) VALUES (?, ?, ?)').run('admin', email, password);
      return models.admin.get();
    }
  },

  db: db,
  rawDb: db
};

module.exports = models;
