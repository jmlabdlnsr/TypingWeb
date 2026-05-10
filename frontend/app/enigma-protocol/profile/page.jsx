'use client';

import { useEffect, useMemo, useState } from 'react';
import EnigmaFrame from '../../../components/enigma-protocol/EnigmaFrame';
import { fetchMyProfile, loadAgentIdentity, loadMatchHistory } from '../../../lib/enigma-player-storage';

function formatRecordDate(timestamp) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export default function EnigmaProtocolProfilePage() {
  const [agentName, setAgentName] = useState('Agent Farhan');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const identity = loadAgentIdentity();
    const records = loadMatchHistory();

    if (identity?.codename) setAgentName(identity.codename);
    setHistory(records);

    fetchMyProfile().then((profile) => {
      if (!profile) return;
      setAgentName(profile.codename || identity?.codename || 'Agent Farhan');
      const normalized = (profile.recentOperations || []).map((item) => ({
        operation: item.operation,
        status: item.success ? 'Success' : 'Failed',
        score: item.score,
        wpm: item.wpm,
        date: item.timestamp,
      }));
      if (normalized.length > 0) setHistory(normalized);
    });
  }, []);

  const profileStats = useMemo(() => {
    if (history.length === 0) {
      return {
        totalScore: 0,
        bestWpm: 0,
        missionWin: 0,
      };
    }

    return {
      totalScore: history.reduce((sum, item) => sum + (item.score || 0), 0),
      bestWpm: history.reduce((best, item) => Math.max(best, item.wpm || 0), 0),
      missionWin: history.filter((item) => item.status === 'Success').length,
    };
  }, [history]);

  return (
    <EnigmaFrame activeKey="profile">
      <section className="shell-card page-header">
        <p className="section-tag magenta">PROFILE</p>
        <h1>{agentName}</h1>
        <p>Dossier singkat performa agen.</p>
        <div className="hero-actions" style={{ marginTop: '18px' }}>
          <span className="status-chip online">Field Analyst</span>
          <span className="status-chip offline">Offline Dummy</span>
        </div>
      </section>

      <section className="summary-grid page-summary-grid">
        <article className="shell-card mini-card">
          <p className="section-tag cyan">TOTAL SCORE</p>
          <h3>{profileStats.totalScore.toLocaleString('id-ID')}</h3>
          <p>Akumulasi dari hasil post-match lokal.</p>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag magenta">MISSION WIN</p>
          <h3>{profileStats.missionWin}</h3>
          <p>Jumlah operasi berhasil.</p>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag amber">PEAK WPM</p>
          <h3>{profileStats.bestWpm}</h3>
          <p>Kecepatan tertinggi.</p>
        </article>
      </section>

      <section className="arena-grid profile-grid profile-shell">
        <article className="shell-card side-card profile-dossier-card">
          <p className="section-tag cyan">AGENT DOSSIER</p>
          <h3>Field Analyst</h3>
          <p className="agent-summary">
            Clearance aktif untuk simulasi sektor utama. Semua hasil misi lokal akan
            direkap otomatis setelah post-match.
          </p>

          <div className="stat-grid" style={{ marginTop: '18px' }}>
            <article>
              <span>Clearance</span>
              <strong>Field Analyst</strong>
            </article>
            <article>
              <span>Mission Win</span>
              <strong>{profileStats.missionWin}</strong>
            </article>
          </div>
        </article>

        <article className="shell-card side-card profile-history-card">
          <p className="section-tag magenta">RECENT OPERATIONS</p>
          <h3>Recent runs</h3>
          {history.length === 0 ? (
            <div className="helper-box" style={{ marginTop: '18px' }}>
              <strong>No operation records found.</strong>
            </div>
          ) : (
            <div className="result-list">
              {history.map((operation, index) => (
                <div key={`${operation.operation}-${operation.date}-${index}`} className="result-item">
                  <div className="profile-history-main">
                    <strong>{operation.operation}</strong>
                    <p>{formatRecordDate(operation.date)}</p>
                  </div>
                  <div className="result-score profile-history-score">
                    <strong
                      className="profile-history-status"
                      style={{ color: operation.status === 'Success' ? 'var(--cyan)' : 'var(--danger)' }}
                    >
                      {operation.status}
                    </strong>
                    <span className="profile-history-meta">{`Score ${operation.score}`}</span>
                    <span className="profile-history-meta">{`${operation.wpm} WPM`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </EnigmaFrame>
  );
}
