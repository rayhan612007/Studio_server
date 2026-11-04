<div align="center">

# 🎬 Studio Space — Backend Server

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)]()

**Studio Server** is the robust backend REST API for the **Studio Space** platform. It handles database operations, user requests, and media management securely.

[Live API Endpoint](https://studio-server-khaki.vercel.app)

</div>

---

## 🚀 Features

- **RESTful API Architecture:** Clean and organized endpoints powering studio listings and app logic.
- **Database Integration:** Scalable data storage and management using **MongoDB**.
- **Studio Images:** Stores externally hosted HTTPS image URLs with each studio listing.
- **Booking Management:** Saves new reservations as Pending; users confirm from My Bookings, where the server checks for overlapping confirmed slots. Confirmed bookings become Completed after their scheduled end time.
- **Serverless Ready:** Configured with `vercel.json` for seamless serverless deployment.

---

## 🛠️ Tech Stack

- **Runtime:** [Node.js](https://nodejs.org/)
- **Framework:** [Express.js](https://expressjs.com/)
- **Database:** [MongoDB](https://www.mongodb.com/)
- **Deployment:** [Vercel](https://vercel.com/)

---

## 📦 Getting Started

Follow these instructions to set up and run the project locally for development.

### Prerequisites

Make sure you have Node.js installed on your system:
- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm, yarn, pnpm, or bun

Configure `CRON_SECRET` in the deployment environment so the scheduled booking-status job can authenticate. Booking creation uses MongoDB transactions to serialize reservations for the same studio; use a MongoDB replica set deployment such as MongoDB Atlas.

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/rayhan612007/Studio_server.git](https://github.com/rayhan612007/Studio_server.git)
   cd Studio_server
