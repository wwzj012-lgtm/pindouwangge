import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MobileSelect, type MobileSelectOption } from './MobileSelect';
import '../../index.css';

interface FixtureState {
  value: string;
  options: MobileSelectOption[];
  disabled: boolean;
  mounted: boolean;
  second: boolean;
  acceptChange: boolean;
}

const initial: FixtureState = {
  value: 'c', disabled: false, mounted: true, second: true, acceptChange: true,
  options: [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', disabled: true },
    { value: 'c', label: 'Gamma' },
    { value: 'd', label: 'Delta' },
  ],
};

const probe = {
  changes: [] as string[], backgroundClicks: 0, ancestorEscapes: 0, documentEscapes: 0,
  configure: (_patch: Partial<FixtureState>) => {},
};
(window as unknown as { mobileSelectFixture: typeof probe }).mobileSelectFixture = probe;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') probe.documentEscapes++;
});

function Fixture() {
  const [state, setState] = useState(initial);
  probe.configure = patch => flushSync(() => setState(previous => ({ ...previous, ...patch })));
  const choose = (value: string) => {
    probe.changes.push(value);
    if (state.acceptChange) setState(previous => ({ ...previous, value }));
  };
  return (
    <main style={{ minHeight: 2500, padding: 16 }} onKeyDown={event => {
      if (event.key === 'Escape') probe.ancestorEscapes++;
    }}>
      <button id="background" onClick={() => probe.backgroundClicks++}>Background</button>
      {state.mounted && <MobileSelect {...state} ariaLabel="Primary" onChange={choose} isEn />}
      {state.second && <MobileSelect value="c" options={state.options} ariaLabel="Secondary" onChange={choose} />}
      <dialog id="peer"><button id="peer-button">Peer modal</button></dialog>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
