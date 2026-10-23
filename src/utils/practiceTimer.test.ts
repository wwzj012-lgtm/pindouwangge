import { describe, expect, it, vi } from 'vitest';
import { createPracticeTimer, formatPracticeDuration, practiceTimerStorageKey } from './practiceTimer';

function environment() {
  let timestamp = 100;
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value); }) };
  return { storage, data, now: () => timestamp, advance: (ms: number) => { timestamp += ms; } };
}

describe('persistent practice clock', () => {
  it('accumulates actual timestamps accurately across pauses without counting closed time', () => {
    const env = environment();
    const clock = createPracticeTimer('work', 'user', env);
    env.advance(10000);
    expect(clock.getElapsedMs()).toBe(0);
    clock.start();
    clock.start();
    env.advance(1573.25);
    expect(clock.getElapsedMs()).toBe(1573.25);
    clock.pause();
    env.advance(90000);
    expect(clock.getElapsedMs()).toBe(1573.25);
    clock.start();
    env.advance(250.5);
    clock.pause();
    expect(clock.getElapsedMs()).toBe(1823.75);
    const reopened = createPracticeTimer('work', 'user', env);
    expect(reopened.isRunning()).toBe(false);
    expect(reopened.getElapsedMs()).toBe(1823.75);
  });

  it('tracks a throttled background interval by elapsed time, not tick count', () => {
    const env = environment();
    const clock = createPracticeTimer('work', null, env);
    clock.start();
    env.advance(3_600_123);
    expect(clock.getElapsedMs()).toBe(3_600_123);
    expect(formatPracticeDuration(clock.getElapsedMs())).toBe('01:00:00');
    clock.checkpoint();
    expect(clock.isRunning()).toBe(true);
  });

  it('isolates users, anonymous sessions and work keys without separator collisions', () => {
    const env = environment();
    const one = createPracticeTimer('work', 'alice', env);
    one.start(); env.advance(1000); one.pause();
    for (const [work, user] of [['work', 'bob'], ['other', 'alice'], ['work', null]] as const) {
      expect(createPracticeTimer(work, user, env).getElapsedMs()).toBe(0);
    }
    expect(practiceTimerStorageKey('a:b', 'c')).not.toBe(practiceTimerStorageKey('b', 'c:a'));
    expect(practiceTimerStorageKey('作品 / #一')).toBe(practiceTimerStorageKey('作品 / #一', null));
  });

  it('resets only the active work and leaves it paused', () => {
    const env = environment();
    const first = createPracticeTimer('first', 'alice', env);
    const second = createPracticeTimer('second', 'alice', env);
    first.start(); second.start(); env.advance(999); first.pause(); second.reset();
    expect(second.getElapsedMs()).toBe(0);
    expect(second.isRunning()).toBe(false);
    expect(createPracticeTimer('first', 'alice', env).getElapsedMs()).toBe(999);
    expect(createPracticeTimer('second', 'alice', env).getElapsedMs()).toBe(0);
  });

  it.each(['{', 'null', '{"elapsedMs":-1}', '{"elapsedMs":"90"}', '{"elapsedMs":1e400}'])('tolerates invalid saved state: %s', raw => {
    const env = environment();
    env.data.set(practiceTimerStorageKey('work'), raw);
    expect(createPracticeTimer('work', undefined, env).getElapsedMs()).toBe(0);
  });

  it('continues in memory and reports unavailable persistence when storage is blocked', () => {
    const env = environment();
    env.storage.setItem.mockImplementation(() => { throw new Error('blocked'); });
    const clock = createPracticeTimer('work', 'alice', env);
    clock.start(); env.advance(500); clock.pause();
    expect(clock.getElapsedMs()).toBe(500);
    expect(clock.canPersist()).toBe(false);
    expect(clock.checkpoint()).toBe(false);
    const volatile = createPracticeTimer('work', null, { now: env.now, storage: null });
    expect(volatile.canPersist()).toBe(false);
  });

  it('formats hours beyond a day without wrapping', () => {
    expect(formatPracticeDuration(90_061_999)).toBe('25:01:01');
    expect(formatPracticeDuration(0)).toBe('00:00:00');
  });
});
