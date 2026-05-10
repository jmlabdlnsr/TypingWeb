import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT || 4000);
const ROOM_CAPACITY = 5;
const ROOM_AUTO_START_COUNTDOWN_MS = Number(process.env.ROOM_AUTO_START_COUNTDOWN_MS || 20 * 1000);
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 10 * 60 * 1000);
const SESSION_ACTIVE_TTL_MS = Number(process.env.SESSION_ACTIVE_TTL_MS || 30 * 60 * 1000);
const ONLINE_ACTIVE_TTL_MS = Number(process.env.ONLINE_ACTIVE_TTL_MS || 15 * 1000);
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const DATA_DIR = join(process.cwd(), '.data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const MATCHES_FILE = join(DATA_DIR, 'matches.json');

const rooms = new Map();
const sessionToConnections = new Map();
const sessionToRoomId = new Map();
const sessionLastActiveAt = new Map();
const globalConnections = new Set();
const users = new Map();
let matches = [];

function now() { return Date.now(); }

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowAll = CORS_ALLOWED_ORIGINS.length === 0;
  const allowed = allowAll || CORS_ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { return {}; }
}

function sanitizeName(name, fallback) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || fallback;
}

function normalizeAgentCodename(rawName) {
  const base = sanitizeName(rawName, 'Nova')
    .replace(/^(agent|agen)\s+/i, '')
    .trim();
  return `Agent ${base || 'Nova'}`;
}

function roomStatus(room) {
  if (room.startedAt) return 'in_progress';
  if (room.players.length >= ROOM_CAPACITY) return 'ready';
  return 'waiting';
}

function snapshotRoom(room) {
  if (!room) return null;
  return {
    roomId: room.id,
    access: room.access,
    hostName: room.hostName,
    operationId: room.operationId,
    operationLabel: room.operationLabel,
    opponentMode: room.opponentMode,
    status: roomStatus(room),
    startedAt: room.startedAt,
    countdownStartedAt: room.countdownStartedAt || null,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    resetVersion: room.resetVersion,
    players: room.players.map((p) => ({ id: p.id, name: p.name, role: p.role, clientId: p.clientId })),
  };
}

function canRoomStart(room) {
  if (!room) return false;
  if (room.opponentMode === 'training-ai') return room.players.length >= 1;
  return room.players.length >= 2;
}

function ensureCountdown(room) {
  if (!room || room.startedAt) return;
  if (canRoomStart(room) && !room.countdownStartedAt) {
    room.countdownStartedAt = now();
    room.lastActivityAt = now();
    broadcastToRoom(room.id, 'countdown_started', {
      roomId: room.id,
      countdownStartedAt: room.countdownStartedAt,
      countdownDurationMs: ROOM_AUTO_START_COUNTDOWN_MS,
    });
    broadcastRoomState(room.id);
  }
}

function forceStartRoom(room, reason = 'auto') {
  if (!room || room.startedAt || !canRoomStart(room)) return false;
  room.startedAt = now();
  room.lastActivityAt = now();
  broadcastToRoom(room.id, 'start_match', { roomId: room.id, startedAt: room.startedAt, reason });
  broadcastRoomState(room.id);
  return true;
}

function shouldForfeitAfterLeave(previousCount, remainingCount) {
  if (previousCount <= 1) return true;
  return remainingCount * 2 <= previousCount;
}

function handlePlayerDeparture(room, player, departureEvent) {
  const previousCount = room.players.length;
  room.players = room.players.filter((p) => p.clientId !== player.clientId);
  room.lastActivityAt = now();
  sessionToRoomId.delete(player.clientId);

  const remainingCount = room.players.length;
  broadcastToRoom(room.id, departureEvent, { playerId: player.id, playerName: player.name });

  if (room.startedAt && shouldForfeitAfterLeave(previousCount, remainingCount)) {
    broadcastToRoom(room.id, 'match_forfeit', {
      roomId: room.id,
      byPlayerId: player.id,
      byPlayerName: player.name,
      reason: 'players_below_50_percent',
    });
    deleteRoom(room.id, 'room_forfeit_closed');
    return;
  }

  if (!room.startedAt && remainingCount === 0) {
    deleteRoom(room.id, 'room_empty_closed');
    return;
  }

  if (!room.startedAt && room.countdownStartedAt && !canRoomStart(room)) {
    room.countdownStartedAt = null;
    broadcastToRoom(room.id, 'countdown_cancelled', {
      roomId: room.id,
      reason: 'not_enough_players',
    });
  }

  broadcastRoomState(room.id);
}

function createRoomId(access) {
  const prefix = access === 'public' ? 'PUB' : 'PVT';
  let id = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
  while (rooms.has(id)) id = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
  return id;
}

function getSessionToken(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  return bearer || req.headers['x-session-token'] || null;
}

function ensureUser(sessionToken, codename = 'Agent') {
  if (users.has(sessionToken)) return users.get(sessionToken);
  const user = { id: `usr_${randomUUID().slice(0, 8)}`, codename: normalizeAgentCodename(codename), createdAt: now() };
  users.set(sessionToken, user);
  return user;
}

function markSessionActive(sessionToken) {
  if (!sessionToken) return;
  sessionLastActiveAt.set(sessionToken, now());
}

function isSessionActive(sessionToken) {
  const lastSeen = sessionLastActiveAt.get(sessionToken);
  if (!lastSeen) return false;
  return now() - lastSeen <= SESSION_ACTIVE_TTL_MS;
}

function cleanupInactiveSessions() {
  const timestamp = now();
  for (const [sessionToken, lastSeen] of sessionLastActiveAt.entries()) {
    if (timestamp - lastSeen <= SESSION_ACTIVE_TTL_MS) continue;
    sessionLastActiveAt.delete(sessionToken);
    sessionToConnections.delete(sessionToken);
    sessionToRoomId.delete(sessionToken);
  }
}

function activeSessionCount() {
  cleanupInactiveSessions();
  const timestamp = now();
  const activeSessions = new Set(
    [...sessionLastActiveAt.entries()]
      .filter(([, lastSeen]) => timestamp - lastSeen <= ONLINE_ACTIVE_TTL_MS)
      .map(([sessionToken]) => sessionToken),
  );
  for (const [sessionToken, connections] of sessionToConnections.entries()) {
    const hasOpenConnection = [...connections].some((conn) => conn.readyState === 1);
    if (hasOpenConnection) {
      activeSessions.add(sessionToken);
    }
  }
  return activeSessions.size;
}

function findRoomByPlayer(sessionToken) {
  const roomId = sessionToRoomId.get(sessionToken);
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function visiblePublicRooms() {
  return [...rooms.values()]
    .filter((room) => room.access === 'public' && !room.startedAt && room.players.length < ROOM_CAPACITY)
    .map(snapshotRoom);
}

function broadcastToRoom(roomId, event, payload = {}) {
  for (const [sessionToken, connections] of sessionToConnections.entries()) {
    if (sessionToRoomId.get(sessionToken) !== roomId) continue;
    for (const conn of connections) {
      if (conn.readyState !== 1 || !conn.isRoomConnection) continue;
      conn.send(JSON.stringify({ event, occurredAt: now(), ...payload }));
    }
  }
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToRoom(roomId, 'room_state_update', { room: snapshotRoom(room) });
}

function broadcastGlobal(event, payload = {}) {
  for (const conn of globalConnections) {
    if (conn.readyState !== 1) continue;
    conn.send(JSON.stringify({ event, occurredAt: now(), ...payload }));
  }
}

function broadcastGlobalRoomsUpdated() {
  broadcastGlobal('rooms_updated');
}

function deleteRoom(roomId, reason = 'room_deleted') {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToRoom(roomId, reason, { roomId });
  rooms.delete(roomId);
  for (const player of room.players) {
    sessionToRoomId.delete(player.clientId);
  }
  broadcastGlobalRoomsUpdated();
}

function cleanupIdleRooms() {
  const t = now();
  for (const room of rooms.values()) {
    if (room.startedAt) continue;
    if (t - room.lastActivityAt >= ROOM_IDLE_TTL_MS) {
      deleteRoom(room.id, 'room_idle_deleted');
    }
  }
}

function processAutoStarts() {
  const t = now();
  for (const room of rooms.values()) {
    if (room.startedAt || !room.countdownStartedAt) continue;
    const elapsed = t - room.countdownStartedAt;
    if (elapsed >= ROOM_AUTO_START_COUNTDOWN_MS) {
      forceStartRoom(room, 'auto_countdown');
    }
  }
}

function disconnectPlayer(sessionToken) {
  const room = findRoomByPlayer(sessionToken);
  if (!room) return;

  const player = room.players.find((p) => p.clientId === sessionToken);
  if (!player) return;

  if (player.role === 'host') {
    deleteRoom(room.id, 'host_disconnected');
    return;
  }
  handlePlayerDeparture(room, player, 'disconnect_leave');
}

function leaderboard(scope, limit = 20) {
  const rows = [...matches]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m, index) => ({
      rank: index + 1,
      codename: m.codename,
      operation: m.operation,
      score: m.score,
      wpm: m.wpm,
      success: m.success,
      timestamp: m.timestamp,
    }));

  if (scope === 'recent') {
    return [...matches].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
  return rows;
}

function profileByUserId(userId) {
  const user = [...users.values()].find((u) => u.id === userId);
  if (!user) return null;
  const userMatches = matches.filter((m) => m.userId === userId);
  const totalScore = userMatches.reduce((sum, m) => sum + (m.score || 0), 0);
  const missionWin = userMatches.filter((m) => m.success).length;
  const peakWpm = userMatches.reduce((best, m) => Math.max(best, m.wpm || 0), 0);
  return {
    userId: user.id,
    codename: user.codename,
    totalScore,
    missionWin,
    peakWpm,
    recentOperations: userMatches.slice(-10).reverse(),
  };
}

const server = createServer(async (req, res) => {
  cleanupInactiveSessions();
  cleanupIdleRooms();
  processAutoStarts();
  applyCors(req, res);

  if ((req.method || 'GET') === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (path === '/api/health') return sendJson(res, 200, { ok: true, timestamp: now() });

  if (path === '/api/players/online' && method === 'GET') {
    markSessionActive(getSessionToken(req));
    return sendJson(res, 200, { online: activeSessionCount() });
  }

  if (path === '/api/session/guest' && method === 'POST') {
    const body = await parseBody(req);
    const sessionToken = body.sessionToken || `sess_${randomUUID()}`;

    const requestedCodename = normalizeAgentCodename(body.codename || 'Nova');
    const duplicateUser = [...users.entries()].find(([token, user]) =>
      token !== sessionToken &&
      user.codename.toLowerCase() === requestedCodename.toLowerCase() &&
      isSessionActive(token),
    );
    if (duplicateUser) {
      return sendJson(res, 409, { error: 'Codename sudah dipakai agent lain yang sudah login.' });
    }

    const user = ensureUser(sessionToken, requestedCodename);
    user.codename = requestedCodename;
    users.set(sessionToken, user);
    markSessionActive(sessionToken);
    await writeJson(USERS_FILE, [...users.entries()]);
    return sendJson(res, 200, { sessionToken, user });
  }

  if (path === '/api/rooms/public' && method === 'GET') return sendJson(res, 200, { rooms: visiblePublicRooms() });

  if (path === '/api/rooms' && method === 'POST') {
    const body = await parseBody(req);
    const sessionToken = body.clientId || getSessionToken(req);
    if (!sessionToken) return sendJson(res, 401, { error: 'Unauthorized session' });
    markSessionActive(sessionToken);

    const hostName = sanitizeName(body.hostName, 'Agent Host');
    const room = {
      id: createRoomId(body.access || 'public'),
      access: body.access === 'private' ? 'private' : 'public',
      hostName,
      operationId: body.operationId || 'operation-sandi',
      operationLabel: body.operationLabel || 'Sector: West Logistics',
      opponentMode: body.opponentMode || 'training-ai',
      startedAt: null,
      countdownStartedAt: null,
      createdAt: now(),
      lastActivityAt: now(),
      resetVersion: 0,
      players: [{ id: 'host', name: hostName, role: 'host', clientId: sessionToken }],
    };

    rooms.set(room.id, room);
    sessionToRoomId.set(sessionToken, room.id);
    ensureCountdown(room);
    broadcastGlobalRoomsUpdated();
    return sendJson(res, 201, { room: snapshotRoom(room) });
  }

  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(join|leave|reset|start))?$/);
  if (roomMatch) {
    const roomId = roomMatch[1].toUpperCase();
    const action = roomMatch[2];
    const room = rooms.get(roomId);

    if (!action && method === 'GET') return sendJson(res, room ? 200 : 404, room ? { room: snapshotRoom(room) } : { error: 'Room tidak ditemukan.' });
    if (!room) return sendJson(res, 404, { error: 'Room tidak ditemukan.' });

    const body = await parseBody(req);
    const sessionToken = body.clientId || getSessionToken(req);
    if (!sessionToken) return sendJson(res, 401, { error: 'Unauthorized session' });
    markSessionActive(sessionToken);

    if (action === 'join' && method === 'POST') {
      if (room.startedAt) return sendJson(res, 409, { error: 'Room sudah dimulai.' });
      if (room.players.some((p) => p.clientId === sessionToken)) return sendJson(res, 200, { room: snapshotRoom(room) });
      if (room.players.length >= ROOM_CAPACITY) return sendJson(res, 409, { error: 'Room sudah penuh.' });

      const player = {
        id: `guest-${room.players.length + 1}`,
        name: sanitizeName(body.playerName, 'Agent Guest'),
        role: 'guest',
        clientId: sessionToken,
      };
      room.players.push(player);
      room.lastActivityAt = now();
      sessionToRoomId.set(sessionToken, room.id);
      broadcastToRoom(room.id, 'player_joined', { player });
      ensureCountdown(room);
      broadcastRoomState(room.id);
      broadcastGlobalRoomsUpdated();
      return sendJson(res, 200, { room: snapshotRoom(room) });
    }

    const player = room.players.find((p) => p.clientId === sessionToken);
    if (!player) return sendJson(res, 403, { error: 'Sesi pemain tidak ditemukan di room.' });

    if (action === 'leave' && method === 'POST') {
      if (player.role === 'host') {
        deleteRoom(room.id, 'host_left');
        return sendJson(res, 200, { success: true });
      }
      handlePlayerDeparture(room, player, 'disconnect_leave');
      return sendJson(res, 200, { success: true });
    }

    if (action === 'reset' && method === 'POST') {
      if (player.role !== 'host') return sendJson(res, 403, { error: 'Hanya host yang dapat mereset room.' });
      room.resetVersion += 1;
      room.lastActivityAt = now();
      broadcastToRoom(room.id, 'reset_room', { roomId: room.id, resetVersion: room.resetVersion });
      broadcastRoomState(room.id);
      return sendJson(res, 200, { success: true, room: snapshotRoom(room) });
    }

    if (action === 'start' && method === 'POST') {
      if (player.role !== 'host') return sendJson(res, 403, { error: 'Hanya host yang dapat memulai room.' });
      if (!canRoomStart(room)) return sendJson(res, 409, { error: 'Minimal 2 pemain untuk mulai operasi.' });
      room.startedAt = room.startedAt || now();
      room.countdownStartedAt = room.countdownStartedAt || now();
      room.lastActivityAt = now();
      broadcastToRoom(room.id, 'start_match', { roomId: room.id, startedAt: room.startedAt });
      broadcastRoomState(room.id);
      broadcastGlobalRoomsUpdated();
      return sendJson(res, 200, { success: true, room: snapshotRoom(room) });
    }
  }

  if (path === '/api/matches' && method === 'POST') {
    const body = await parseBody(req);
    const sessionToken = body.sessionToken || getSessionToken(req);
    if (!sessionToken) return sendJson(res, 401, { error: 'Unauthorized session' });
    markSessionActive(sessionToken);
    const user = ensureUser(sessionToken, body.codename || 'Agent');

    const row = {
      id: `match_${randomUUID().slice(0, 12)}`,
      userId: user.id,
      codename: sanitizeName(body.codename || user.codename, user.codename),
      operation: body.operation || 'Unknown Operation',
      success: Boolean(body.success),
      score: Number(body.score) || 0,
      wpm: Number(body.wpm) || 0,
      timestamp: Number(body.timestamp) || now(),
    };

    matches.push(row);
    if (matches.length > 2000) matches = matches.slice(-2000);
    await writeJson(MATCHES_FILE, matches);
    return sendJson(res, 201, { match: row });
  }

  if (path === '/api/leaderboard' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'global';
    const limit = Number(url.searchParams.get('limit') || 20);
    return sendJson(res, 200, { scope, rows: leaderboard(scope, limit) });
  }

  if (path === '/api/profile/me' && method === 'GET') {
    const sessionToken = getSessionToken(req);
    if (!sessionToken) return sendJson(res, 401, { error: 'Unauthorized session' });
    markSessionActive(sessionToken);
    const user = ensureUser(sessionToken);
    const profile = profileByUserId(user.id);
    return sendJson(res, 200, { profile });
  }

  const profileMatch = path.match(/^\/api\/profile\/([^/]+)(?:\/operations)?$/);
  if (profileMatch && method === 'GET') {
    const userId = profileMatch[1];
    const profile = profileByUserId(userId);
    if (!profile) return sendJson(res, 404, { error: 'Profile not found' });
    if (path.endsWith('/operations')) {
      const limit = Number(url.searchParams.get('limit') || 10);
      return sendJson(res, 200, { operations: profile.recentOperations.slice(0, limit) });
    }
    return sendJson(res, 200, { profile });
  }

  return sendJson(res, 404, { error: 'Not Found' });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionToken = url.searchParams.get('sessionToken');
  const roomId = url.searchParams.get('roomId')?.toUpperCase();

  if (!sessionToken) {
    ws.close(1008, 'sessionToken required');
    return;
  }

  ws.isRoomConnection = Boolean(roomId);
  if (!sessionToConnections.has(sessionToken)) {
    sessionToConnections.set(sessionToken, new Set());
  }
  sessionToConnections.get(sessionToken).add(ws);

  if (roomId) {
    sessionToRoomId.set(sessionToken, roomId);
  } else {
    globalConnections.add(ws);
  }
  markSessionActive(sessionToken);

  ws.on('message', (raw) => {
    let message = null;
    try { message = JSON.parse(raw.toString('utf-8')); } catch { return; }
    const currentRoomId = sessionToRoomId.get(sessionToken);
    if (!currentRoomId) return;
    markSessionActive(sessionToken);

    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.lastActivityAt = now();

    if (message.event === 'progress_update') {
      broadcastToRoom(currentRoomId, 'progress_update', {
        playerId: message.playerId,
        playerName: message.playerName,
        progress: Number(message.progress) || 0,
      });
      return;
    }

    if (message.event === 'match_over') {
      broadcastToRoom(currentRoomId, 'match_over', {
        by: message.by || sessionToken,
        payload: message.payload || null,
      });
    }
  });

  ws.on('close', () => {
    globalConnections.delete(ws);
    const connections = sessionToConnections.get(sessionToken);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        sessionToConnections.delete(sessionToken);
      }
    }

    if (!ws.isRoomConnection) {
      return;
    }

    const hasActiveRoomSocket = [...(sessionToConnections.get(sessionToken) || [])]
      .some((conn) => conn.isRoomConnection && conn.readyState === 1);
    if (!hasActiveRoomSocket) {
      disconnectPlayer(sessionToken);
    }
  });
});

const bootstrapUsers = await readJson(USERS_FILE, []);
for (const [token, user] of bootstrapUsers) users.set(token, user);
matches = await readJson(MATCHES_FILE, []);

setInterval(cleanupIdleRooms, 30 * 1000).unref();
setInterval(processAutoStarts, 1000).unref();

server.listen(port, () => {
  console.log(`Enigma Backend running on http://localhost:${port}`);
});
