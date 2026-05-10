'use client';

import { useEffect, useMemo, useState } from 'react';
import EnigmaFrame from '../../../components/enigma-protocol/EnigmaFrame';
import { fetchLeaderboard } from '../../../lib/enigma-player-storage';

export default function EnigmaProtocolLeaderboardPage() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetchLeaderboard('global', 20).then(setRows).catch(() => setRows([]));
  }, []);

  const top = rows[0] || { codename: '-', score: 0, wpm: 0 };

  const rankedRows = useMemo(
    () => rows.map((row, index) => ({ ...row, rank: row.rank || index + 1 })),
    [rows],
  );

  return (
    <EnigmaFrame activeKey="leaderboard">
      <section className="shell-card page-header">
        <p className="section-tag cyan">LEADERBOARD</p>
        <h1>Field Ranking</h1>
        <p>Snapshot performa agen dari backend.</p>
      </section>

      <section className="summary-grid page-summary-grid">
        <article className="shell-card mini-card">
          <p className="section-tag cyan">TOP SCORE</p>
          <h3>{top.score}</h3>
          <p>{top.codename}</p>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag amber">PEAK WPM</p>
          <h3>{top.wpm}</h3>
          <p>Kecepatan tertinggi.</p>
        </article>
        <article className="shell-card mini-card">
          <p className="section-tag magenta">TOTAL AGENT</p>
          <h3>{rankedRows.length}</h3>
          <p>Global ranking aktif.</p>
        </article>
      </section>

      <section className="shell-card rooms-panel leaderboard-panel">
        <div className="rooms-head">
          <div>
            <p className="section-tag cyan">GLOBAL BOARD</p>
            <h2>Ranking agen</h2>
          </div>
          <span className="status-chip online">Server Sync</span>
        </div>

        <div className="leaderboard-table" style={{ marginTop: '20px' }}>
          <div className="leaderboard-head">
            <span>Rank</span>
            <span>Agent</span>
            <span>Ops</span>
            <span>Score</span>
            <span>WPM</span>
          </div>
          {rankedRows.map((entry) => (
            <div key={`${entry.rank}-${entry.codename}-${entry.timestamp}`} className="leaderboard-row">
              <span className="result-score"><strong>#{entry.rank}</strong></span>
              <span><strong>{entry.codename}</strong></span>
              <span>{entry.operation}</span>
              <span>{entry.score}</span>
              <span>{entry.wpm}</span>
            </div>
          ))}
        </div>
      </section>
    </EnigmaFrame>
  );
}
