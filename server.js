// server.js - Express & WebRTC Signaling Server for Video Conferencing & Collaboration

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

// Initialize Express application and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.io with permissive CORS for real-time signaling
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 6000;
const JWT_SECRET = process.env.JWT_SECRET || 'codealpha_video_comm_secret_2026';

// Middleware for parsing JSON requests and serving static frontend files
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware: verifies incoming JWT bearer tokens
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Please login to continue.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired. Please log in again.' });
    }
    req.user = user;
    next();
  });
}

/* ==========================================================================
   WEBRTC SIGNALING & COLLABORATION ENGINE (SOCKET.IO)
   
   Explanation for Interviewers:
   - WebRTC is peer-to-peer (audio/video travels directly between browsers).
   - However, browsers first need to find each other and negotiate media formats.
   - This Socket.io server acts as the "Signaling Channel" to relay:
     1. Room presence (who is in the room)
     2. SDP Offers & Answers (audio/video codecs, resolution)
     3. ICE Candidates (public/private IP addresses & ports)
     4. Whiteboard drawing coordinates
     5. Chat messages & shared files
   ========================================================================== */

// Keep track of which room each socket belongs to, and user details
const roomParticipants = {}; // format: { [roomId]: { [socketId]: { name, avatar } } }

io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  // 1. Participant joins a video room
  socket.on('join-room', ({ roomId, userName, userAvatar }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName || 'Guest User';
    socket.userAvatar = userAvatar || '';

    // Initialize room dictionary if first person
    if (!roomParticipants[roomId]) {
      roomParticipants[roomId] = {};
    }

    // Inform existing participants that a new peer has joined
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userName: socket.userName,
      userAvatar: socket.userAvatar
    });

    // Save this participant
    roomParticipants[roomId][socket.id] = {
      name: socket.userName,
      avatar: socket.userAvatar
    };

    // Send the list of existing peers back to the newly joined user
    const existingPeers = Object.keys(roomParticipants[roomId])
      .filter(id => id !== socket.id)
      .map(id => ({
        socketId: id,
        userName: roomParticipants[roomId][id].name,
        userAvatar: roomParticipants[roomId][id].avatar
      }));

    socket.emit('existing-peers', existingPeers);
    console.log(`[Room ${roomId}] ${socket.userName} (${socket.id}) joined. Total: ${Object.keys(roomParticipants[roomId]).length}`);
  });

  // 2. WebRTC SDP Offer Relay
  // When Peer A wants to connect to Peer B, A creates an Offer and sends it here
  socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      senderName: socket.userName,
      offer
    });
  });

  // 3. WebRTC SDP Answer Relay
  // Peer B accepts Peer A's offer, creates an Answer and sends it back
  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer
    });
  });

  // 4. WebRTC ICE Candidate Relay
  // When a browser discovers a network route/candidate, it shares it with the remote peer
  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate
    });
  });

  // 5. Collaborative Whiteboard: Drawing coordinates sync
  socket.on('whiteboard-draw', (drawData) => {
    if (socket.roomId) {
      // Broadcast coordinates to all other participants in the room
      socket.to(socket.roomId).emit('whiteboard-draw', drawData);
    }
  });

  // 6. Collaborative Whiteboard: Clear canvas sync
  socket.on('whiteboard-clear', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('whiteboard-clear');
    }
  });

  // 7. In-Meeting Text Chat
  socket.on('chat-message', (messageText) => {
    if (socket.roomId && messageText && messageText.trim()) {
      io.to(socket.roomId).emit('chat-message', {
        senderId: socket.id,
        senderName: socket.userName,
        senderAvatar: socket.userAvatar,
        text: messageText.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 8. In-Meeting File Sharing
  socket.on('file-share', (filePayload) => {
    if (socket.roomId && filePayload) {
      io.to(socket.roomId).emit('file-share', {
        senderName: socket.userName,
        fileName: filePayload.fileName,
        fileType: filePayload.fileType,
        fileSize: filePayload.fileSize,
        fileData: filePayload.fileData,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 9. Handle Disconnect / Leaving Meeting
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && roomParticipants[roomId]) {
      delete roomParticipants[roomId][socket.id];

      // Notify remaining peers to destroy video element for this user
      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userName: socket.userName
      });

      if (Object.keys(roomParticipants[roomId]).length === 0) {
        delete roomParticipants[roomId];
      }
    }
    console.log(`[Socket] User disconnected: ${socket.id}`);
  });
});

/* ==========================================================================
   REST API ENDPOINTS (AUTHENTICATION & ROOM MANAGEMENT)
   ========================================================================== */

// 1. User Registration
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Please provide name, email, and password.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.get('SELECT * FROM users WHERE email = ?', [cleanEmail], async (err, existing) => {
    if (err) return res.status(500).json({ error: 'Database query error.' });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}`;

      db.run(
        'INSERT INTO users (name, email, password, avatar_url) VALUES (?, ?, ?, ?)',
        [name.trim(), cleanEmail, hashedPassword, avatarUrl],
        function (insertErr) {
          if (insertErr) return res.status(500).json({ error: 'Failed to create user.' });

          const token = jwt.sign(
            { id: this.lastID, name: name.trim(), email: cleanEmail },
            JWT_SECRET,
            { expiresIn: '7d' }
          );

          res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: { id: this.lastID, name: name.trim(), email: cleanEmail, avatar_url: avatarUrl }
          });
        }
      );
    } catch (hashError) {
      res.status(500).json({ error: 'Error encrypting password.' });
    }
  });
});

// 2. User Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.get('SELECT * FROM users WHERE email = ?', [cleanEmail], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database query error.' });
    if (!user) {
      return res.status(401).json({ error: 'User not found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password. Please check and try again.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url }
    });
  });
});

// 3. Get Current User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, name, email, avatar_url, created_at FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database query error.' });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  });
});

// 4. Create a New Meeting Room
app.post('/api/rooms', authenticateToken, (req, res) => {
  const { title } = req.body;
  const roomTitle = title && title.trim() ? title.trim() : 'Instant Collaboration Room';

  // Generate a clean human-readable 9-character room code (e.g. abc-def-ghi)
  const generateCode = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const segment = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${segment(3)}-${segment(3)}-${segment(3)}`;
  };

  const roomCode = generateCode();

  db.run(
    'INSERT INTO rooms (room_code, title, host_id) VALUES (?, ?, ?)',
    [roomCode, roomTitle, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to create meeting room.' });

      res.status(201).json({
        message: 'Meeting room created!',
        room: {
          id: this.lastID,
          room_code: roomCode,
          title: roomTitle,
          host_id: req.user.id
        }
      });
    }
  );
});

// 5. Get My Recent Meeting Rooms
app.get('/api/rooms', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM rooms WHERE host_id = ? ORDER BY created_at DESC LIMIT 10',
    [req.user.id],
    (err, rooms) => {
      if (err) return res.status(500).json({ error: 'Failed to load rooms.' });
      res.json({ rooms });
    }
  );
});

// Serve frontend single-page application fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🎥 CodeAlpha Video Conferencing & Real-Time App is running!`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`⚡ WebRTC Signaling Server active via Socket.io`);
  console.log('================================================================');
});
