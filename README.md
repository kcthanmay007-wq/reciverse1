# Reciverse — Any repair. One tap. One voice.

> **Universal On-Demand Repair Aggregator Platform**  
> Final Project for **CS1303 - Full Stack Development**  
> Department of Computer Science & Engineering, **National Institute of Technology, Warangal (NIT Warangal)**  
> **Student:** K. C. Thanmay Krishna (Roll No: `24CSB0A31`)

---

## 📖 Overview
Reciverse is an on-demand repair aggregator platform engineered to bridge the gap between everyday consumers and local, verified vocational mechanics. The platform standardizes repair requests across 16 major product categories, featuring a voice-first, pictorial interface for low-digital-literacy users and a centralized bipartite matching engine that eliminates notification fatigue for technicians.

---

## 🛠️ Technology Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), Web Speech API
- **Backend:** Node.js, Express.js REST API
- **Database:** SQLite (`better-sqlite3`) in Write-Ahead-Logging (WAL) mode
- **Security:** bcryptjs (10 salt rounds), UUID v4, Parameterized SQL queries
- **Payments:** Razorpay Sandbox checkout simulation
- **Matching Algorithm:** Swiggy-style centralized bipartite matching engine (v4) with 140-point composite scoring and 4-tier urgency passes

---

## 🚀 Getting Started Locally

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- Modern browser (Google Chrome, Microsoft Edge, or Mozilla Firefox)

### 2. Installation & Execution
```bash
# Clone the repository
git clone https://github.com/ThanmayKrishna/reciverse1.git
cd reciverse1/server

# Install dependencies
npm install

# Start the server
npm start
```

Open your browser and navigate to **`http://localhost:3000`**.

---

## 👥 Default Demo Credentials
- **Admin Portal:** `admin@reciverse.com` / `admin123`
- **Technician 1:** `ravi@demo.com` / `demo123` (Washing Machine, AC, Refrigerator)
- **Technician 2:** `suresh@demo.com` / `demo123` (TV, Laptop, Mobile)
- **Technician 3:** `anitha@demo.com` / `demo123` (Washing Machine, Microwave, Geyser)
- **Technician 4:** `farhan@demo.com` / `demo123` (2-Wheeler, 4-Wheeler, Motor)
- **Technician 5:** `kiran@demo.com` / `demo123` (Laptop, CCTV, Printer)

---

## 📄 Project Documentation
- **Final Project Report (DOCX):** [Reciverse_Final_Project_Report.docx](./Reciverse_Final_Project_Report.docx)
- **Final Project Report (PDF):** [Reciverse_Final_Project_Report.pdf](./Reciverse_Final_Project_Report.pdf)
- **Project Brief:** [Reciverse — Project Brief & Build Prompt.pdf](./Reciverse%20—%20Project%20Brief%20%26%20Build%20Prompt.pdf)
