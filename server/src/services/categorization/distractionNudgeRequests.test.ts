import { afterEach, expect, test } from 'bun:test';
import { cancelDistractionNudge, requestDistractionNudge } from './distractionNudgeRequests';

afterEach(() => cancelDistractionNudge('test'));
const copy = { title: 'Put the chat aside', body: 'Work through the next exercise for your statistics sheet.' };

test('concurrent and recurring reminders share one generation attempt', async () => {
  let calls = 0;
  let resolve!: (value: typeof copy) => void;
  const generate = async () => { calls++; return new Promise<typeof copy>(done => { resolve = done; }); };
  const first = requestDistractionNudge('test', 'event:goal', generate);
  const second = requestDistractionNudge('test', 'event:goal', generate);
  await Promise.resolve();
  expect(calls).toBe(1);
  resolve(copy);
  expect(await first).toEqual(copy);
  expect(await second).toEqual(copy);
  expect(await requestDistractionNudge('test', 'event:goal', generate)).toEqual(copy);
  expect(calls).toBe(1);
});

test('a failed model call is remembered without retrying on every reminder', async () => {
  let calls = 0;
  const generate = async () => { calls++; throw new Error('offline'); };
  expect(await requestDistractionNudge('test', 'event:goal', generate)).toBeNull();
  expect(await requestDistractionNudge('test', 'event:goal', generate)).toBeNull();
  expect(calls).toBe(1);
});

test('changing activity or goal aborts old inference and discards its late result', async () => {
  let resolve!: (value: typeof copy) => void;
  let signal!: AbortSignal;
  const old = requestDistractionNudge('test', 'old:goal', async current => {
    signal = current;
    return new Promise<typeof copy>(done => { resolve = done; });
  });
  await Promise.resolve();
  const newer = requestDistractionNudge('test', 'new:goal', async () => copy);
  expect(signal.aborted).toBe(true);
  resolve(copy);
  expect(await old).toBeNull();
  expect(await newer).toEqual(copy);
});
