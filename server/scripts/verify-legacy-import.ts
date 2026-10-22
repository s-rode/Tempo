import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { importLegacyDatabase } from '../src/services/tempoMigration';

const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 3000,
});
const suffix = randomUUID().replaceAll('-', '');
const sourceName = `tempo_test_import_source_${suffix}`;
const targetName = `tempo_test_import_target_${suffix}`;
const occupiedName = `tempo_test_import_occupied_${suffix}`;
const unsupportedName = `tempo_test_import_unsupported_${suffix}`;
const uri = (name: string) => `mongodb://127.0.0.1:27017/${name}`;
let connected = false;
try {
  await client.connect();
  connected = true;
  const id = new mongoose.Types.ObjectId();
  await client
    .db(sourceName)
    .collection('users')
    .insertOne({ _id: id, googleId: 'cronus-local-user', email: 'local@cronus.invalid' });
  await client
    .db(sourceName)
    .collection('activewindowevents')
    .insertOne({ userId: id, title: 'Synthetic event' });
  await client.db(occupiedName).collection('users').insertOne({ name: 'Existing user' });
  await client.db(unsupportedName).collection('users').insertOne({ name: 'Unknown identity' });
  await assert.rejects(
    importLegacyDatabase(uri(unsupportedName), uri(targetName)),
    /exactly one recognized local user/
  );
  assert.equal(await client.db(targetName).collection('users').countDocuments(), 0);
  await assert.rejects(importLegacyDatabase(uri(sourceName), uri(occupiedName)), /contains data/);
  assert.equal(
    (await client.db(occupiedName).collection('users').findOne())?.name,
    'Existing user'
  );
  const result = await importLegacyDatabase(uri(sourceName), uri(targetName));
  assert.equal(result.copied, 2);
  assert.equal(
    (await client.db(targetName).collection('users').findOne())?.googleId,
    'tempo-local-user'
  );
  assert.equal(
    (await client.db(targetName).collection('users').findOne())?._id.toString(),
    id.toString()
  );
  assert.equal(
    (await client.db(sourceName).collection('users').findOne())?.googleId,
    'cronus-local-user'
  );
  assert.equal((await importLegacyDatabase(uri(sourceName), uri(targetName))).resumed, true);
  await client
    .db(targetName)
    .collection('tempo_import_state')
    .updateOne({}, { $set: { state: 'copying' } });
  await client.db(targetName).collection('activewindowevents').deleteMany({});
  assert.equal((await importLegacyDatabase(uri(sourceName), uri(targetName))).copied, 2);
  await client
    .db(targetName)
    .collection('tempo_import_state')
    .updateOne({}, { $set: { state: 'copying' } });
  await client
    .db(targetName)
    .collection('users')
    .updateOne({}, { $set: { name: 'Changed after interruption' } });
  await assert.rejects(importLegacyDatabase(uri(sourceName), uri(targetName)), /changed since/);
  console.log(
    'PASS: empty-target and identity guards, immutable source, stable IDs, interrupted-copy recovery, conflict protection'
  );
} finally {
  for (const name of connected ? [sourceName, targetName, occupiedName, unsupportedName] : []) {
    assert.ok(name.startsWith('tempo_test_import_'));
    await client.db(name).dropDatabase();
  }
  await client.close();
}
