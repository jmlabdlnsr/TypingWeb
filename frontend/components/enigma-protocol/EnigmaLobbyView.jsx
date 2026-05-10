'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnigmaFrame from './EnigmaFrame';
import {
  ENIGMA_OPERATION_CHOICES,
  ENIGMA_OPPONENT_CHOICES,
  createRoom,
  getClientSessionId,
  isRoomPubliclyVisible,
  joinRoom,
  loadRooms,
  subscribeRoomStore,
} from '../../lib/enigma-room-store';

const ROOM_CAPACITY = 5;

export default function EnigmaLobbyView() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('Agent Raka');
  const [roomAccess, setRoomAccess] = useState('public');
  const [opponentMode, setOpponentMode] = useState('training-ai');
  const [operationChoice, setOperationChoice] = useState(ENIGMA_OPERATION_CHOICES[3].id);
  const [roomCode, setRoomCode] = useState('');
  const [rooms, setRooms] = useState([]);
  const [helperMessage, setHelperMessage] = useState(
    'Pilih mode room lalu mulai.',
  );
  const [enteringFromLanding, setEnteringFromLanding] = useState(false);

  useEffect(() => {
    try {
      const rawIdentity = window.localStorage.getItem('enigma_agent_identity_v1');
      if (rawIdentity) {
        const parsedIdentity = JSON.parse(rawIdentity);
        if (parsedIdentity?.codename) {
          setPlayerName(parsedIdentity.codename);
        }
      }

      const transitionFlag = window.sessionStorage.getItem('enigma_entry_transition');
      if (transitionFlag === 'landing-to-lobby') {
        setEnteringFromLanding(true);
        window.sessionStorage.removeItem('enigma_entry_transition');
        window.setTimeout(() => setEnteringFromLanding(false), 1200);
      }
    } catch {}

    const syncRooms = async () => {
      const nextRooms = await loadRooms();
      setRooms(nextRooms);
    };

    syncRooms();
    return subscribeRoomStore(() => {
      syncRooms();
    });
  }, []);

  const publicRooms = useMemo(
    () => rooms.filter((room) => isRoomPubliclyVisible(room)),
    [rooms],
  );

  function navigateToRoom(room, nextPlayerName, role) {
    const params = new URLSearchParams({
      roomId: room.id,
      player: nextPlayerName,
      role,
    });
    router.push(`/enigma-protocol/room?${params.toString()}`);
  }

  async function handleCreateRoom() {
    const clientId = getClientSessionId();
    let room = null;
    try {
      room = await createRoom({
        hostName: playerName,
        access: roomAccess,
        operationChoiceId: operationChoice,
        clientId,
        opponentMode,
      });
    } catch (error) {
      setHelperMessage(error?.message || 'Gagal membuat room. Pastikan backend aktif.');
      return;
    }

    setHelperMessage(
      room.access === 'public'
        ? `Room public ${room.id} dibuat untuk ${room.opponentMode === 'local-network' ? 'PvP 2 tab' : 'Training AI'}.`
        : `Room private ${room.id} dibuat. Bagikan Room ID ke lawan jika memakai Local Network.`,
    );
    navigateToRoom(room, playerName.trim() || 'Agent Host', 'host');
  }

  async function handleJoinByCode() {
    const nextName = playerName.trim() || 'Agent Guest';
    const { room, error } = await joinRoom(roomCode, nextName, getClientSessionId());

    if (error || !room) {
      setHelperMessage(error || 'Room tidak ditemukan.');
      return;
    }

    setHelperMessage(`Berhasil masuk ke ${room.id}.`);
    navigateToRoom(room, nextName, 'guest');
  }

  async function handleJoinPublic(roomId) {
    const nextName = playerName.trim() || 'Agent Guest';
    const { room, error } = await joinRoom(roomId, nextName, getClientSessionId());

    if (error || !room) {
      setHelperMessage(error || 'Room tidak dapat dimasuki.');
      return;
    }

    setHelperMessage(`Masuk ke room public ${room.id}.`);
    navigateToRoom(room, nextName, 'guest');
  }

  return (
    <EnigmaFrame activeKey="lobby">
      <section className={`hero-shell ${enteringFromLanding ? 'lobby-enter lobby-enter-active' : ''}`}>
        <div>
          <p className="section-tag cyan">LOBBY</p>
          <h1>Translate Arena</h1>
          <p>Buat room atau masuk lewat Room ID.</p>
        </div>
        <div className="hero-actions">
          <span className="status-chip offline">Offline</span>
          <button
            type="button"
            className="shell-button subtle"
            onClick={async () => setRooms(await loadRooms())}
            suppressHydrationWarning
          >
            Refresh Room
          </button>
        </div>
      </section>

      <section className={`summary-grid ${enteringFromLanding ? 'lobby-enter lobby-enter-active' : ''}`}>
        <article className="shell-card mini-card">
          <p className="section-tag cyan">SERVER</p>
          <h3>Offline</h3>
          <div className="inline-meta">
            <span className="status-chip offline">Offline</span>
          </div>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag magenta">ROOM</p>
          <h3>{roomAccess === 'public' ? 'Public' : 'Private'}</h3>
          <p>Akses room aktif.</p>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag amber">MULAI</p>
          <h3>Minimal 2 pemain</h3>
          <p>Host memulai saat room siap.</p>
        </article>
      </section>

      <section className={`lobby-grid ${enteringFromLanding ? 'lobby-enter lobby-enter-active' : ''}`}>
        <article className="shell-card form-panel">
          <p className="section-tag magenta">MASUK GAME</p>
          <h2>Setup room</h2>

          <div className="helper-box" style={{ marginTop: '18px' }}>
            <strong>Agent aktif</strong>
            <p>{playerName}</p>
          </div>

          <div className="helper-box" style={{ marginTop: '18px' }}>
            <strong>Akses room</strong>
            <div className="player-stack" style={{ marginTop: '12px' }}>
              {['public', 'private'].map((access) => (
                <label key={access} className="player-row" style={{ cursor: 'pointer' }}>
                  <div>
                    <strong>{access === 'public' ? 'Room Public' : 'Room Private'}</strong>
                    <p>{access === 'public' ? 'Muncul di lobby.' : 'Masuk lewat Room ID.'}</p>
                  </div>
                  <input
                    type="radio"
                    name="room-access"
                    checked={roomAccess === access}
                    onChange={() => setRoomAccess(access)}
                    aria-label={access}
                    suppressHydrationWarning
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="helper-box" style={{ marginTop: '18px' }}>
            <strong>Mode lawan</strong>
            <div className="player-stack" style={{ marginTop: '12px' }}>
              {ENIGMA_OPPONENT_CHOICES.map((option) => (
                <label key={option.id} className="player-row" style={{ cursor: 'pointer' }}>
                  <div>
                    <strong>{option.label}</strong>
                    <p>
                      {option.id === 'training-ai'
                        ? 'Simulasi lawan bot lokal.'
                        : 'Sinkronisasi 2 tab via BroadcastChannel.'}
                    </p>
                  </div>
                  <input
                    type="radio"
                    name="opponent-mode"
                    checked={opponentMode === option.id}
                    onChange={() => setOpponentMode(option.id)}
                    aria-label={option.label}
                    suppressHydrationWarning
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="warning-box">Dummy room sync aktif untuk simulasi lokal.</div>

          <div className="input-block">
            <span>Target operasi</span>
            <div className="helper-box" style={{ marginTop: '0' }}>
              <strong>Pilih sektor misi</strong>
              <select
                value={operationChoice}
                onChange={(event) => setOperationChoice(event.target.value)}
                aria-label="Target operasi"
                suppressHydrationWarning
                style={{
                  marginTop: '12px',
                  width: '100%',
                  borderRadius: '16px',
                  border: '1px solid rgba(32, 170, 216, 0.34)',
                  background: 'rgba(5, 10, 28, 0.78)',
                  color: 'var(--text-main)',
                  padding: '0.95rem 1rem',
                }}
              >
                {ENIGMA_OPERATION_CHOICES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreateRoom}
            className="shell-button gradient"
            suppressHydrationWarning
            style={{
              display: 'inline-flex',
              justifyContent: 'center',
              width: '100%',
              marginTop: '22px',
            }}
          >
            {roomAccess === 'public' ? 'Buat Public Room' : 'Buat Private Room'}
          </button>

          <div className="divider" />

          <label className="input-block">
            <span>Kode room</span>
            <div className="join-row">
              <input
                type="text"
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                placeholder="PUB-104"
                suppressHydrationWarning
              />
              <button
                type="button"
                onClick={handleJoinByCode}
                className="shell-button join"
                suppressHydrationWarning
                style={{
                  display: 'inline-flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                Gabung
              </button>
            </div>
          </label>

          <div className="helper-box">
            <strong>Status</strong>
            <p>{helperMessage}</p>
          </div>
        </article>

        <article className="shell-card rooms-panel">
          <div className="rooms-head">
            <div>
              <p className="section-tag cyan">ROOM TERSEDIA</p>
              <h2>Public room</h2>
              <p>{publicRooms.length} room aktif</p>
            </div>
            <button
              type="button"
              className="shell-button subtle"
              onClick={async () => setRooms(await loadRooms())}
              suppressHydrationWarning
            >
              Refresh
            </button>
          </div>

          {publicRooms.length === 0 ? (
            <div className="empty-room">
              <div>
                <p className="section-tag cyan">KOSONG</p>
                <h3>Belum ada room public</h3>
                <p>Buat room public dari panel kiri agar pemain lain bisa langsung join.</p>
              </div>
            </div>
          ) : (
            <div className="room-list">
              {publicRooms.map((room) => (
                <div key={room.id} className="room-card">
                  <div>
                    <strong>{`Room ID: ${room.id}`}</strong>
                    <p>{`Host: ${room.hostName}`}</p>
                    <p>{room.opponentMode === 'local-network' ? 'Local Network' : 'Training AI'}</p>
                    <p>{`${room.players.length}/${ROOM_CAPACITY} ${room.players.length < 2 ? 'Waiting' : 'Ready'}`}</p>
                  </div>
                  <button
                    type="button"
                    className="shell-button join"
                    onClick={() => handleJoinPublic(room.id)}
                    disabled={room.players.length >= ROOM_CAPACITY}
                    suppressHydrationWarning
                    style={{
                      opacity: room.players.length >= ROOM_CAPACITY ? 0.52 : 1,
                      cursor: room.players.length >= ROOM_CAPACITY ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {room.players.length >= ROOM_CAPACITY ? 'Full' : 'Join'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </EnigmaFrame>
  );
}
