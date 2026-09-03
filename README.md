# CodeAlpha_VideoCommunicationApp

### Full Stack Web Development Internship — Task 4: Real-Time Communication App

A full-stack peer-to-peer **Video Conferencing & Team Collaboration Platform** (inspired by Google Meet & Zoom) built strictly in accordance with the **CodeAlpha Internship** curriculum and technical guidelines.

---

## 📌 Features Implemented

1. **Multi-User Video & Audio Calling**:
   - High quality, low-latency media streaming powered by native **WebRTC** (`RTCPeerConnection`).
   - Dynamic multi-user video grid automatically adjusting to participant count.
   - Interactive controls to toggle camera On/Off and mute/unmute microphone.

2. **Real-Time Screen Sharing**:
   - Instant 1-click screen, application window, or browser tab sharing using browser `navigator.mediaDevices.getDisplayMedia`.
   - Seamless media track replacement without disconnecting active peer sessions.

3. **Interactive Collaborative Whiteboard**:
   - Real-time synchronized drawing canvas powered by HTML5 `<canvas>` and WebSockets.
   - Pen tool, eraser mode, color palette picker, and brush thickness slider.
   - Live stroke replication across all connected participant screens with 1-click canvas wipe.

4. **In-Meeting Chat & File Sharing**:
   - Dedicated side drawer for instant text communication with message timestamps.
   - Direct file sharing (images, documents, PDFs) with one-click peer download links.

5. **Authentication & Room History**:
   - Secure account registration & login with password encryption via `bcryptjs` and JSON Web Tokens (JWT).
   - Instant 9-character room code generation (e.g. `abc-def-ghi`) and meeting history persistence in SQLite.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Modern Responsive CSS3 (Dark Mode Theme, Flexbox & CSS Grid), Vanilla JavaScript (ES6+)
- **Backend**: Node.js, Express.js REST API
- **Real-Time Media & Signaling**: WebRTC (`RTCPeerConnection`, Google Public STUN servers) & Socket.io
- **Database**: SQLite3 (`video_comm.db`)
- **Authentication**: JWT & `bcryptjs`

---

## 📂 Project Directory Structure

```
CodeAlpha_VideoCommunicationApp/
├── database.js          # SQLite connection, users & rooms schema, demo seeds
├── server.js            # Express server, WebRTC signaling relay & REST APIs
├── package.json         # Project metadata and dependencies
├── test_comm_api.js     # Automated verification test script
├── public/              # Client-side web frontend
│   ├── index.html       # Meeting dashboard & room launcher
│   ├── room.html        # Video conference room, whiteboard & chat
│   ├── login.html       # Authentication portal with 1-click demo login
│   ├── style.css        # Sleek dark-mode theme & video grid styles
│   └── app.js           # WebRTC peer lifecycle, screen sharing & canvas sync
└── README.md            # Complete documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16.0 or higher)
- `npm`

### Step 1: Install Dependencies
Open a terminal in the project directory:
```bash
npm install
```

### Step 2: Start the Server
```bash
npm start
```
The server will start on port **7000**:
```
🎥 CodeAlpha Video Conferencing & Real-Time App is running!
🌐 URL: http://localhost:7000
⚡ WebRTC Signaling Server active via Socket.io
```

### Step 3: Open in Browser
Visit the following URL in your web browser:
```
http://localhost:7000
```

### Step 4: Quick Demo Login
You can either create a new account or click **Auto-fill Demo Credentials** on the login page:
- **Email**: `alex@codealpha.com`
- **Password**: `password123`

---

## 🧪 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register meeting participant |
| `POST` | `/api/auth/login` | Login and receive JWT token |
| `GET` | `/api/auth/me` | Current user profile |
| `POST` | `/api/rooms` | Create new meeting room code |
| `GET` | `/api/rooms` | List recent meeting rooms hosted by user |

---

## 👨‍💻 Submission Notes for CodeAlpha Internship
- **Repository Name**: `CodeAlpha_VideoCommunicationApp`
- **Domain**: Full Stack Web Development
- **Task**: Task 4 (Real-Time Communication App)
