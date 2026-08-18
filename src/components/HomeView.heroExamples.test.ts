import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createHeroExampleActivation, HERO_EXAMPLES } from './HomeView';

describe('HomeView hero examples', () => {
  it('maps the four existing public assets without copying them into a second dataset', () => {
    expect(HERO_EXAMPLES).toEqual([
      { id: 'batiao-cat', name: '八条猫', url: '/images/batiao-cat.webp' },
      { id: 'boss-xiaoxin', name: '霸总小新', url: '/images/boss-xiaoxin.jpg' },
      { id: 'spiderman', name: '蜘蛛侠', url: '/images/spiderman.webp' },
      { id: 'chibi-character', name: 'Q版人物', url: '/images/chibi-character.jpg' },
    ]);
  });

  it('activates an example through the provided conversion callback', () => {
    const onLoadHeroExample = vi.fn();
    const example = HERO_EXAMPLES[2]!;

    createHeroExampleActivation(example, onLoadHeroExample)();

    expect(onLoadHeroExample).toHaveBeenCalledWith(example);
  });

  it('uses native buttons and wires hero activation to the existing App sample loader', () => {
    const homeSource = readFileSync(new URL('./HomeView.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(homeSource).toContain('HERO_EXAMPLES.map((example) =>');
    expect(homeSource).toContain('type="button"');
    expect(homeSource).toContain('createHeroExampleActivation(example, onLoadHeroExample)');
    expect(appSource).toContain('handleLoadSample(example.url, example.name)');
  });
});
