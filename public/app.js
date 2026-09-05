// ==========================================================================
// app.js - WebRTC Video Conferencing & Real-Time Collaboration Client
// 
// Written with clean, modular functions and clear explanations
// for each WebRTC lifecycle step (Permissions -> Signaling -> Stream Exchange)
// ==========================================================================

// Global state variables
let socket = null;
let localStream = null;
let screenStream = null;
let currentRoomId = null;
let currentUser = null;

// Track WebRTC Peer Connections: { [socketId]: RTCPeerConnection }
const peerConnections = {};

// Free Google Public STUN server configuration for NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Controls state
let isAudioMuted = false;
let isVideoStopped = false;
let isScreenSharing = false;

/* ==========================================================================
   1. AUTHENTICATION & SESSION MANAGEMENT
   ========================================================================== */

function getAuthToken() {
  return localStorage.getItem('comm_token');
}

function getStoredUser() {
  const u = localStorage.getItem('comm_user');
  return u ? JSON.parse(u) : null;
}

function setAuthSession(token, user) {
  localStorage.setItem('comm_token', token);
  localStorage.setItem('comm_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('comm_token');
  localStorage.removeItem('comm_user');
  window.location.href = 'login.html';
}

function checkAuthProtection() {
  const token = getAuthToken();
  if (!token && !window.location.pathname.includes('login.html')) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

/* ==========================================================================
   2. WEBRTC MEDIA CAPTURE & INITIALIZATION
   
   Explanation:
   - getUserMedia requests microphone and camera access from the user's browser.
   - We attach this local media stream to our own preview video element.
   ========================================================================== */

async function startLocalMedia() {
  try {
    // Request webcam and audio access
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });

    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
    }
  } catch (err) {
    console.warn('Camera/Mic permission denied or not available. Running in dummy stream mode for testing.', err);
    // Fallback: create a blank canvas video stream if user has no webcam or denies permission
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e222d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#60a5fa';
    ctx.font = '24px sans-serif';
    ctx.fillText('Camera Inactive', 220, 180);
    localStream = canvas.captureStream(15);
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = localStream;
  }
}

/* ==========================================================================
   3. WEBRTC PEER CONNECTION FACTORY
   
   Explanation:
   - For every remote participant, we create a new RTCPeerConnection instance.
   - We add all tracks (audio & video) from our local stream to this connection.
   - When remote media arrives (ontrack), we display it in a new video tile.
   - When candidate routes are found (onicecandidate), we send them via Socket.io.
   ========================================================================== */

function createPeerConnection(remoteSocketId, remoteName) {
  // If connection already exists, return it
  if (peerConnections[remoteSocketId]) {
    return peerConnections[remoteSocketId];
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[remoteSocketId] = pc;

  // Step A: Feed local audio/video tracks to the remote peer
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  // Step B: ICE Candidate discovery (how browsers find network paths)
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetSocketId: remoteSocketId,
        candidate: event.candidate
      });
    }
  };

  // Step C: Remote stream arrived! Create video element on UI
  pc.ontrack = (event) => {
    console.log(`[WebRTC] Received remote stream from: ${remoteName} (${remoteSocketId})`);
    createRemoteVideoTile(remoteSocketId, remoteName, event.streams[0]);
  };

  // Step D: Handle connection state change
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Peer ${remoteSocketId} state: ${pc.connectionState}`);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      removeRemoteVideoTile(remoteSocketId);
    }
  };

  return pc;
}

/* ==========================================================================
   4. SOCKET.IO SIGNALING LIFECYCLE
   ========================================================================== */

function initializeMeetingRoom(roomId) {
  currentUser = getStoredUser() || { name: 'Guest User', avatar_url: '' };
  currentRoomId = roomId;

  // Connect to Socket.io server
  socket = io();

  socket.on('connect', async () => {
    console.log(`[Socket] Connected to signaling server with ID: ${socket.id}`);

    // Join room with my user info
    socket.emit('join-room', {
      roomId: currentRoomId,
      userName: currentUser.name,
      userAvatar: currentUser.avatar_url
    });
  });

  // Event 1: Server tells us who was ALREADY in this room before we arrived
  // As the newly arrived peer, WE create the WebRTC Offers to connect to them
  socket.on('existing-peers', async (peers) => {
    console.log(`[WebRTC] Existing peers in room:`, peers);
    for (const peer of peers) {
      const pc = createPeerConnection(peer.socketId, peer.userName);

      // Create WebRTC SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to that specific peer
      socket.emit('webrtc-offer', {
        targetSocketId: peer.socketId,
        offer: offer
      });
    }
  });

  // Event 2: A brand new user joined the room
  socket.on('user-joined', ({ socketId, userName }) => {
    console.log(`[WebRTC] A new user joined: ${userName} (${socketId})`);
    // Prepare peer connection container for incoming offer
    createPeerConnection(socketId, userName);
  });

  // Event 3: Received WebRTC Offer from a calling peer
  socket.on('webrtc-offer', async ({ senderSocketId, senderName, offer }) => {
    console.log(`[WebRTC] Received Offer from: ${senderName}`);
    const pc = createPeerConnection(senderSocketId, senderName);

    // Set remote description from caller
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Create SDP Answer and set as local description
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send Answer back to caller
    socket.emit('webrtc-answer', {
      targetSocketId: senderSocketId,
      answer: answer
    });
  });

  // Event 4: Received WebRTC Answer back from target peer
  socket.on('webrtc-answer', async ({ senderSocketId, answer }) => {
    console.log(`[WebRTC] Received Answer from: ${senderSocketId}`);
    const pc = peerConnections[senderSocketId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  // Event 5: Received ICE Candidate
  socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
    const pc = peerConnections[senderSocketId];
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  });

  // Event 6: Participant left
  socket.on('user-left', ({ socketId, userName }) => {
    console.log(`[WebRTC] User left: ${userName} (${socketId})`);
    if (peerConnections[socketId]) {
      peerConnections[socketId].close();
      delete peerConnections[socketId];
    }
    removeRemoteVideoTile(socketId);
  });

  // Event 7: Chat message received
  socket.on('chat-message', (msg) => {
    appendChatMessage(msg);
  });

  // Event 8: Shared file received
  socket.on('file-share', (fileData) => {
    appendSharedFile(fileData);
  });

  // Event 9: Whiteboard draw event
  socket.on('whiteboard-draw', (drawData) => {
    drawFromRemote(drawData);
  });

  // Event 10: Whiteboard cleared
  socket.on('whiteboard-clear', () => {
    clearCanvasLocal();
  });
}

/* ==========================================================================
   5. VIDEO GRID UI HELPERS
   ========================================================================== */

function createRemoteVideoTile(socketId, name, stream) {
  const videoGrid = document.getElementById('videoGrid');
  if (!videoGrid) return;

  // Avoid duplicates
  let tile = document.getElementById(`tile-${socketId}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${socketId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'participant-label';
    label.innerHTML = `<span>👤</span> <span>${escapeHtml(name)}</span>`;

    tile.appendChild(video);
    tile.appendChild(label);
    videoGrid.appendChild(tile);
  } else {
    tile.querySelector('video').srcObject = stream;
  }
}

function removeRemoteVideoTile(socketId) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) tile.remove();
}

/* ==========================================================================
   6. IN-CALL CONTROLS (MIC, CAMERA, SCREEN SHARE)
   ========================================================================== */

// Toggle Microphone Mute/Unmute
function toggleMicrophone() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;

    const btn = document.getElementById('btnToggleMic');
    if (btn) {
      btn.classList.toggle('active-off', isAudioMuted);
      btn.title = isAudioMuted ? 'Unmute Mic' : 'Mute Mic';
    }
  }
}

// Toggle Camera On/Off
function toggleCamera() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    isVideoStopped = !isVideoStopped;
    videoTrack.enabled = !isVideoStopped;

    const btn = document.getElementById('btnToggleVideo');
    if (btn) {
      btn.classList.toggle('active-off', isVideoStopped);
      btn.title = isVideoStopped ? 'Start Camera' : 'Turn Off Camera';
    }
  }
}

// Screen Sharing: uses navigator.mediaDevices.getDisplayMedia
async function toggleScreenShare() {
  const btn = document.getElementById('btnScreenShare');

  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track across all active peer connections
      Object.values(peerConnections).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
      });

      // Update local preview
      document.getElementById('localVideo').srcObject = screenStream;
      isScreenSharing = true;
      if (btn) btn.classList.add('btn-primary');

      // Revert back when user stops screen share from browser dialog
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.warn('Screen share canceled or denied:', err);
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  // Restore camera track to all peers
  const cameraTrack = localStream ? localStream.getVideoTracks()[0] : null;
  if (cameraTrack) {
    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(cameraTrack);
      }
    });
    document.getElementById('localVideo').srcObject = localStream;
  }

  isScreenSharing = false;
  const btn = document.getElementById('btnScreenShare');
  if (btn) btn.classList.remove('btn-primary');
}

function leaveMeeting() {
  if (confirm('Are you sure you want to leave this meeting?')) {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }
    if (socket) {
      socket.disconnect();
    }
    window.location.href = 'index.html';
  }
}

/* ==========================================================================
   7. COLLABORATIVE WHITEBOARD (HTML5 Canvas + Sockets)
   
   Explanation:
   - Tracks mouse drag events on the canvas.
   - Calculates line coordinates (prevX, prevY -> currX, currY).
   - Draws locally and emits the stroke to Socket.io to replicate on all peers.
   ========================================================================== */

let canvas, ctx;
let isDrawing = false;
let prevX = 0, prevY = 0;
let drawColor = '#0f172a';
let brushSize = 3;
let isEraser = false;

function initWhiteboard() {
  canvas = document.getElementById('whiteboardCanvas');
  if (!canvas) return;

  ctx = canvas.getContext('2d');

  // Adjust resolution to match card size
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  setTimeout(resizeCanvas, 200);

  // Mouse drawing listeners
  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    prevX = e.clientX - rect.left;
    prevY = e.clientY - rect.top;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const currX = e.clientX - rect.left;
    const currY = e.clientY - rect.top;

    drawLine(prevX, prevY, currX, currY, isEraser ? '#ffffff' : drawColor, isEraser ? 18 : brushSize);

    // Broadcast stroke to other peers
    if (socket) {
      socket.emit('whiteboard-draw', {
        prevX: prevX / canvas.width,
        prevY: prevY / canvas.height,
        currX: currX / canvas.width,
        currY: currY / canvas.height,
        color: isEraser ? '#ffffff' : drawColor,
        size: isEraser ? 18 : brushSize
      });
    }

    prevX = currX;
    prevY = currY;
  });

  window.addEventListener('mouseup', () => {
    isDrawing = false;
  });
}

function drawLine(x1, y1, x2, y2, color, size) {
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// Receive draw stroke from remote peer
function drawFromRemote(data) {
  if (!canvas || !ctx) return;
  drawLine(
    data.prevX * canvas.width,
    data.prevY * canvas.height,
    data.currX * canvas.width,
    data.currY * canvas.height,
    data.color,
    data.size
  );
}

function clearCanvasLocal() {
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function triggerClearWhiteboard() {
  clearCanvasLocal();
  if (socket) {
    socket.emit('whiteboard-clear');
  }
}

function toggleWhiteboardModal() {
  const modal = document.getElementById('whiteboardModal');
  if (modal) {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      initWhiteboard();
    }
  }
}

/* ==========================================================================
   8. IN-MEETING CHAT & FILE SHARING
   ========================================================================== */

function toggleChatDrawer() {
  const drawer = document.getElementById('chatDrawer');
  if (drawer) {
    drawer.classList.toggle('open');
  }
}

function sendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !socket) return;

  socket.emit('chat-message', text);
  input.value = '';
}

function appendChatMessage(msg) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `
    <div class="chat-sender">
      <span>${escapeHtml(msg.senderName)}</span>
      <span style="font-size:0.75rem; color:#94a3b8;">${msg.timestamp}</span>
    </div>
    <div style="color:#f8fafc; word-break:break-word;">${escapeHtml(msg.text)}</div>
  `;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// File Sharing: converts file to data URL and sends over socket
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    alert('File size exceeds 10MB limit.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    socket.emit('file-share', {
      fileName: file.name,
      fileType: file.type,
      fileSize: (file.size / 1024).toFixed(1) + ' KB',
      fileData: reader.result
    });
  };
  reader.readAsDataURL(file);
}

function appendSharedFile(f) {
  const container = document.getElementById('chatMessages');
  if (!container || !f) return;

  // Validate that fileData is a safe data/blob URI to prevent pseudo-protocol injection
  const rawData = String(f.fileData || '');
  const isSafeDataUri = rawData.startsWith('data:') || rawData.startsWith('blob:');
  const safeHref = isSafeDataUri ? rawData : '#';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.style.borderLeft = '3px solid #3b82f6';
  bubble.innerHTML = `
    <div class="chat-sender">
      <span>📎 ${escapeHtml(f.senderName)} shared a file</span>
      <span style="font-size:0.75rem; color:#94a3b8;">${f.timestamp || ''}</span>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px;">
      <div>
        <strong>${escapeHtml(f.fileName || 'Shared File')}</strong>
        <p style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(f.fileSize || '')}</p>
      </div>
      ${isSafeDataUri ? `<a href="${safeHref}" download="${escapeHtml(f.fileName || 'file')}" class="btn btn-primary" style="padding:4px 10px; font-size:0.8rem; text-decoration:none;">Download</a>` : '<span style="font-size:0.75rem; color:#ef4444;">Invalid file</span>'}
    </div>
  `;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// Utility: HTML escaping
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
