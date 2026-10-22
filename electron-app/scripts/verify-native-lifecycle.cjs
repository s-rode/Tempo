const assert = require('node:assert/strict');
const path = require('node:path');

assert.ok(process.versions.electron, 'Run this check with the pinned Electron runtime.');
const native = require(path.join(
  __dirname,
  '../src/native-modules/native-windows/build/Release/nativeWindows.node'
));

// No observer is started and no permission or EventKit query is made. A fresh
// process owns these module globals, independently of any daily-use Tempo app.
assert.doesNotThrow(() => native.stopActiveWindowObserver());
assert.doesNotThrow(() => native.stopActiveWindowObserver());
assert.equal(native.refreshActiveWindow(), false);
assert.equal(native.resumeAfterSystemSuspension(), false);
assert.doesNotThrow(() => native.setActivityCapturePaused(true));
assert.doesNotThrow(() => native.setActivityCapturePaused(false));
assert.doesNotThrow(() => native.setFirefoxCompanionConnected(false));
assert.equal(typeof native.getShouldRequestPermissions(), 'boolean');
console.log('PASS: native addon loads; repeated inactive shutdown and recovery are safe.');
