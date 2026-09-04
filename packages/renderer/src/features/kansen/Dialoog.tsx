/** Het omhulsel dat alle kansdialogen delen: overlay, kader en sluiten op Esc. */
import { useEffect, type JSX, type ReactNode } from 'react';

export function Dialoog({
  titel,
  onSluit,
  children,
}: {
  titel: string;
  onSluit: () => void;
  children: ReactNode;
}): JSX.Element {
  // Esc sluit de dialoog. Zonder dit blijft een gebruiker die met het
  // toetsenbord werkt in het venster hangen.
  useEffect(() => {
    const opToets = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onSluit();
    };
    window.addEventListener('keydown', opToets);
    return () => window.removeEventListener('keydown', opToets);
  }, [onSluit]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titel}
      onClick={onSluit}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / 0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          padding: 20,
          width: 'min(680px, 94vw)',
          maxHeight: '84vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{titel}</h2>
        {children}
      </div>
    </div>
  );
}

export const dialoogKnop: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 12px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 12,
};

export const invoerStijl: React.CSSProperties = {
  background: 'var(--oppervlak)',
  border: '1px solid var(--rand)',
  borderRadius: 4,
  color: 'var(--inkt)',
  fontSize: 12,
  padding: '4px 6px',
};

export const dialoogSelect: React.CSSProperties = { ...invoerStijl, width: '100%' };
