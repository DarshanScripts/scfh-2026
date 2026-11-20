import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopActionGuard } from '../desktop-harness.mjs';

const success = () => 'ok';
const observe = (guard) => guard.run('Snapshot', {}, success);
const click = (guard) => guard.run('Click', { loc: [10, 20] }, success);

test('each input consumes its screen observation', async () => {
  const guard = createDesktopActionGuard();
  await assert.rejects(click(guard), /fresh Snapshot/);
  await observe(guard);
  assert.equal(await click(guard), 'ok');
  await assert.rejects(click(guard), /fresh Snapshot/);
});

test('control takeover blocks input until the next user command', async () => {
  const guard = createDesktopActionGuard();
  await observe(guard);
  await assert.rejects(guard.run('Click', {}, () => { throw new Error('USER_CONTROL'); }), /USER_CONTROL/);
  await observe(guard);
  await assert.rejects(click(guard), /interrupted or denied/);
  guard.beginTurn();
  await assert.rejects(click(guard), /fresh Snapshot/);
  await observe(guard);
  assert.equal(await click(guard), 'ok');
});

test('only one tool runs at a time and UI waits have a deadline', async () => {
  const guard = createDesktopActionGuard();
  const deferred = Promise.withResolvers();
  const pending = guard.run('WaitFor', { timeout: 60 }, (args) => {
    assert.equal(args.timeout, 8);
    return deferred.promise;
  });
  await assert.rejects(observe(guard), /still running/);
  deferred.resolve('ready');
  await pending;
  await assert.rejects(click(guard), /fresh Snapshot/);
});

test('a late observation cannot carry over to the next user command', async () => {
  const guard = createDesktopActionGuard();
  const deferred = Promise.withResolvers();
  const pending = guard.run('Snapshot', {}, () => deferred.promise);
  guard.beginTurn();
  deferred.resolve('old screen');
  await pending;
  await assert.rejects(click(guard), /fresh Snapshot/);
});
