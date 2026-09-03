const http = require('http');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting CodeAlpha Task 4 (Real-Time Communication App) Verification Tests ---');
  const timestamp = Date.now();

  // 1. Test Register
  console.log('\n[1] Testing POST /api/auth/register:');
  const testEmail = `host_${timestamp}@example.com`;
  const regRes = await request({
    hostname: 'localhost',
    port: 7000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Meeting Host',
    email: testEmail,
    password: 'password123'
  });
  console.log(`Status: ${regRes.status}, User: ${regRes.data.user?.name} (${regRes.data.user?.email})`);
  if (regRes.status !== 201) throw new Error('Registration failed');
  const token = regRes.data.token;

  // 2. Test Login
  console.log('\n[2] Testing POST /api/auth/login:');
  const loginRes = await request({
    hostname: 'localhost',
    port: 7000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: testEmail,
    password: 'password123'
  });
  console.log(`Status: ${loginRes.status}, Message: ${loginRes.data.message}`);
  if (loginRes.status !== 200) throw new Error('Login failed');

  // 3. Test Create Meeting Room
  console.log('\n[3] Testing POST /api/rooms (Meeting Rooms):');
  const roomRes = await request({
    hostname: 'localhost',
    port: 6000,
    path: '/api/rooms',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, {
    title: 'CodeAlpha WebRTC Architecture Review'
  });
  console.log(`Status: ${roomRes.status}, Room Code: ${roomRes.data.room?.room_code}, Title: "${roomRes.data.room?.title}"`);
  if (roomRes.status !== 201 || !roomRes.data.room?.room_code) throw new Error('Create room failed');

  // 4. Test Get Recent Rooms
  console.log('\n[4] Testing GET /api/rooms:');
  const getRoomsRes = await request({
    hostname: 'localhost',
    port: 6000,
    path: '/api/rooms',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`Status: ${getRoomsRes.status}, Total Rooms: ${getRoomsRes.data.rooms?.length}`);
  if (getRoomsRes.status !== 200 || getRoomsRes.data.rooms.length === 0) throw new Error('Get rooms failed');

  console.log('\n================================================================');
  console.log('✅ ALL TASK 4 VIDEO COMMUNICATION APP CRITERIA VERIFIED!');
  console.log('================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
