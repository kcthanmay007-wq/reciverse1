// ============================================================
//  RECIVERSE - Main Server (Node.js + Express)
//  Modules: User Module (1) + Technician Module (2)
//  + Smart Matching Engine (Swiggy-style pass-based)
// ============================================================

const express = require('express');
const cors    = require('cors');
const { runPass } = require('./matchingEngine');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the website (public folder)
app.use(express.static(path.join(__dirname, '../public')));

// ── Database (SQLite) ──────────────────────────────────────
const db = require('./database');

// ── Seed Demo Technicians ──────────────────────────────────
async function seedTechnicians() {
  const existing = db.technicians.getAll();
  if (existing.length > 0) return;

  console.log('\n🌱  Seeding 5 demo technicians into SQLite (password: demo123)...');
  const pwd = await bcrypt.hash('demo123', 10);

  const demos = [
    { name:'Ravi Kumar',       email:'ravi@demo.com',   phone:'9876543210', city:'Hyderabad',
      skills:['Washing Machine','Refrigerator','Air Conditioner'],
      experience:'8 years', workingStyle:'Punctual & professional',
      bio:'Former Voltas service engineer. 8+ yrs in home appliances.',
      rating:4.8, totalJobs:342, activeJobs:2 },
    { name:'Suresh Babu',      email:'suresh@demo.com', phone:'9876543211', city:'Hyderabad',
      skills:['Television','Laptop/Computer','Mobile Phone'],
      experience:'5 years', workingStyle:'Detail-oriented & patient',
      bio:'Electronics specialist — TVs, laptops, and phones.',
      rating:4.6, totalJobs:198, activeJobs:1 },
    { name:'Anitha Reddy',     email:'anitha@demo.com', phone:'9876543212', city:'Hyderabad',
      skills:['Washing Machine','Microwave','Geyser/Water Heater','Water Purifier'],
      experience:'6 years', workingStyle:'Thorough & communicative',
      bio:'RO & water-purifier expert. One of the few women in appliance repair.',
      rating:4.7, totalJobs:217, activeJobs:0 },
    { name:'Mohammed Farhan',  email:'farhan@demo.com', phone:'9876543213', city:'Hyderabad',
      skills:['Vehicle (2-Wheeler)','Vehicle (4-Wheeler)','Fan/Motor'],
      experience:'10 years', workingStyle:'Honest & transparent',
      bio:'Veteran mechanic for 2 & 4 wheelers, fans and motors.',
      rating:4.5, totalJobs:456, activeJobs:3 },
    { name:'Kiran Sharma',     email:'kiran@demo.com',  phone:'9876543214', city:'Hyderabad',
      skills:['Laptop/Computer','CCTV/Security System','Printer/Scanner'],
      experience:'7 years', workingStyle:'Fast & reliable',
      bio:'IT & security-systems expert. CCTV installation, laptop repairs.',
      rating:4.9, totalJobs:289, activeJobs:1 }
  ];

  for (const d of demos) {
    db.technicians.create({
      id: uuidv4(), ...d,
      password: pwd, maxCapacity: 10,
      verified: true, isOnline: true,
      createdAt: new Date().toISOString(),
      reviews: [], interviewAnswers: []
    });
  }
  console.log('✅  Seeded 5 technicians into database.\n');
}

// ── API Routes ─────────────────────────────────────────────
app.use('/api/users',       require('./routes/users'));
app.use('/api/technicians', require('./routes/technicians'));
app.use('/api/requests',    require('./routes/requests'));
app.use('/api/reviews',     require('./routes/reviews'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/payments',    require('./routes/payments'));

// ── Catch-all → serve index.html ──────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ──────────────────────────────────────────────────
const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('🔧  ════════════════════════════════════════════');
    console.log('    RECIVERSE  —  Any repair. One tap. One voice.');
    console.log('════════════════════════════════════════════════');
    console.log(`\n🌐  Website Live → ${url}\n`);
    console.log('👤  Customers   →  Sign Up / Login / Dashboard / Profile / Raise Request');
    console.log('🔧  Technicians →  Register / Login / Dashboard / Profile');
    console.log('💳  Payments    →  ' + url + '/payment.html  (Razorpay sandbox)');
    console.log('⭐  Reviews     →  ' + url + '/review.html');
    console.log('🛡️  Admin       →  ' + url + '/admin-dashboard.html  (admin@reciverse.com / admin123)');
    console.log('');
    console.log('🌱  Demo technician logins (password: demo123)');
    console.log('    ravi@demo.com  | suresh@demo.com | anitha@demo.com');
    console.log('    farhan@demo.com | kiran@demo.com');
    console.log('════════════════════════════════════════════════\n');

    // ── Start Smart Matching Engine ────────────────────────────
    console.log('⚡  Matching engine active (Swiggy-style auto-dispatch)...');
    const boot = runPass();
    console.log(`    Boot pass: ${boot.total || 0} pending | ${boot.assigned || 0} matched | ${boot.unmatched || 0} unmatched`);

    setInterval(() => {
      const stats = runPass();
      if (stats.total > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] Matching pass: ${stats.total || 0} pending | ${stats.assigned || 0} matched | ${stats.unmatched || 0} unmatched`);
      }
    }, 30000);
  });

  server.on('error', err => {
    if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${port} unavailable (${err.code}). Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

seedTechnicians().then(() => {
  startServer(DEFAULT_PORT);
});
