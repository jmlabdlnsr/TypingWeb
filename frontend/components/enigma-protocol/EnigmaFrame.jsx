import Link from 'next/link';
import { ENIGMA_NAV_ITEMS } from './enigma-data';
import EnigmaStatusPill from './EnigmaStatusPill';

export default function EnigmaFrame({ activeKey, children, hideNav = false, className = '' }) {
  return (
    <main className={`page-shell ${className}`}>
      <div className="bg-glow bg-glow-left" />
      <div className="bg-glow bg-glow-right" />
      {!hideNav ? (
        <nav className="top-nav">
          {ENIGMA_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{ textDecoration: 'none' }}
              className={item.key === activeKey ? 'shell-button' : 'shell-button subtle'}
            >
              {item.label}
            </Link>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <EnigmaStatusPill tone="emerald">Offline Dummy</EnigmaStatusPill>
          </div>
        </nav>
      ) : null}
      {children}
    </main>
  );
}
