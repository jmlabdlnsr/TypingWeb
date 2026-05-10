'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const IDENTITY_STORAGE_KEY = 'enigma_agent_identity_v1';
const SESSION_KEY = 'enigma_client_session_v2';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

function resolveApiBaseUrl() {
  if (API_BASE_URL) {
    return API_BASE_URL;
  }
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

const PROFILE_MODES = [
  {
    id: 'radar',
    label: 'Radar Scan',
    accent: 'cyan',
  },
  {
    id: 'globe',
    label: 'Global Mesh',
    accent: 'purple',
  },
  {
    id: 'signal',
    label: 'Signal Wave',
    accent: 'amber',
  },
];

function loadIdentity() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveIdentity(identity) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

function toDisplayName(rawName) {
  return rawName?.replace(/^(agent|agen)\s+/i, '').trim() || '';
}

function RadarProfile({ reacting }) {
  return (
    <div className={`profile-visual profile-radar ${reacting ? 'reacting' : ''}`}>
      <span className="profile-ring ring-a" />
      <span className="profile-ring ring-b" />
      <span className="profile-ring ring-c" />
      <span className="profile-scan-line" />
      <span className="profile-core-dot" />
    </div>
  );
}

function GlobeProfile({ reacting }) {
  return (
    <div className={`profile-visual profile-globe ${reacting ? 'reacting' : ''}`}>
      <span className="globe-shell" />
      <span className="globe-lat lat-top" />
      <span className="globe-lat lat-mid" />
      <span className="globe-lat lat-bottom" />
      <span className="globe-long long-left" />
      <span className="globe-long long-right" />
      <span className="globe-long long-center" />
    </div>
  );
}

function SignalProfile({ reacting }) {
  return (
    <div className={`profile-visual profile-signal ${reacting ? 'reacting' : ''}`}>
      <span className="signal-bar signal-a" />
      <span className="signal-bar signal-b" />
      <span className="signal-bar signal-c" />
      <span className="signal-bar signal-d" />
      <span className="signal-bar signal-e" />
      <span className="signal-orbit orbit-a" />
      <span className="signal-orbit orbit-b" />
    </div>
  );
}

function ProfilePreview({ mode, reacting }) {
  if (mode === 'globe') {
    return <GlobeProfile reacting={reacting} />;
  }

  if (mode === 'signal') {
    return <SignalProfile reacting={reacting} />;
  }

  return <RadarProfile reacting={reacting} />;
}

export default function EnigmaLandingPage() {
  const router = useRouter();
  const [typedTitle, setTypedTitle] = useState('');
  const [codename, setCodename] = useState('');
  const [profileMode, setProfileMode] = useState(PROFILE_MODES[0].id);
  const [isReady, setIsReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const activeProfile = useMemo(
    () => PROFILE_MODES.find((item) => item.id === profileMode) || PROFILE_MODES[0],
    [profileMode],
  );

  useEffect(() => {
    const existingIdentity = loadIdentity();

    if (existingIdentity?.codename) {
      setCodename(toDisplayName(existingIdentity.codename));
    }

    if (existingIdentity?.profileMode) {
      setProfileMode(existingIdentity.profileMode);
    }

    setIsReady(true);
  }, []);

  useEffect(() => {
    const title = 'Enigma Protocol';
    setTypedTitle('');

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setTypedTitle(title.slice(0, index));
      if (index >= title.length) {
        window.clearInterval(interval);
      }
    }, 70);

    return () => window.clearInterval(interval);
  }, []);

  function cycleProfileMode() {
    const currentIndex = PROFILE_MODES.findIndex((item) => item.id === profileMode);
    const nextMode = PROFILE_MODES[(currentIndex + 1) % PROFILE_MODES.length];
    setProfileMode(nextMode.id);
  }

  async function initializeConnection() {
    const rawName = codename.trim();
    if (!rawName) {
      setErrorMessage('Nama agent wajib diisi.');
      return;
    }
    if (/\b(agent|agen)\b/i.test(rawName)) {
      setErrorMessage('Isi nama saja tanpa kata Agent/Agen.');
      return;
    }

    const normalizedCodename = `Agent ${rawName}`;
    const sessionToken =
      (typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY)) ||
      `sess_${Math.random().toString(36).slice(2, 12)}`;

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_KEY, sessionToken);
    }

    try {
      const response = await fetch(`${resolveApiBaseUrl()}/api/session/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, codename: normalizedCodename }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload.error || 'Gagal login. Coba nama lain.');
        return;
      }
    } catch {
      setErrorMessage('Server tidak merespons. Coba lagi.');
      return;
    }

    setErrorMessage('');
    saveIdentity({
      codename: normalizedCodename,
      profileMode,
      savedAt: Date.now(),
    });
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('enigma_entry_transition', 'landing-to-lobby');
    }
    router.push('/enigma-protocol/lobby');
  }

  return (
    <main className="landing-shell">
      <div className="landing-grid-overlay" />
      <div className="landing-particles">
        <span className="particle p-a" />
        <span className="particle p-b" />
        <span className="particle p-c" />
        <span className="particle p-d" />
        <span className="particle p-e" />
        <span className="particle p-f" />
      </div>

      <section className="landing-card">
        <div className="landing-badge-row">
          <div className="landing-brand-chip">
            <span className="brand-dot" />
            <div>
              <strong>Enigma Protocol</strong>
              <small>Simulation Deck</small>
            </div>
          </div>
        </div>

        <div className="landing-card-header landing-card-header-centered">
          <p className="section-tag cyan">MAIN LANGSUNG</p>
          <h1 className="landing-title">
            {typedTitle}
            <span className="type-caret" aria-hidden="true" />
          </h1>
          <p className="landing-subtitle">Secure Decryption &amp; Transmission Simulation</p>
        </div>

        <div className="identity-shell identity-shell-centered">
          <button
            type="button"
            className={`profile-switch profile-switch-large ${activeProfile.accent}`}
            onClick={cycleProfileMode}
            aria-label={`Ganti visual profil. Mode aktif: ${activeProfile.label}`}
            suppressHydrationWarning
          >
            <ProfilePreview mode={profileMode} reacting={codename.trim().length > 0} />
          </button>

          <div className="identity-copy landing-identity-copy">
            <strong>{activeProfile.label}</strong>
          </div>

          <label className="input-block landing-input-block compact">
            <span>Agent Codename</span>
            <input
              type="text"
              value={codename}
              onChange={(event) => {
                setCodename(event.target.value);
                if (errorMessage) setErrorMessage('');
              }}
              placeholder="Farhan"
              autoComplete="off"
              suppressHydrationWarning
            />
            {errorMessage ? (
              <small style={{ color: 'var(--danger)' }}>{errorMessage}</small>
            ) : (
              <small>{`Akan disimpan sebagai: Agent ${codename.trim() || '...'}`}</small>
            )}
          </label>
        </div>

        <div className="landing-footer landing-footer-centered">
          <button
            type="button"
            className="landing-button"
            onClick={initializeConnection}
            suppressHydrationWarning
          >
            Main
          </button>
        </div>
      </section>
    </main>
  );
}
