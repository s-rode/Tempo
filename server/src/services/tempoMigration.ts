import mongoose from 'mongoose';

const MongoClient = mongoose.mongo.MongoClient;

const markerId = 'explicit-kronus-import-v1';
const stateCollection = 'tempo_import_state';

function databaseName(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Legacy import supports loopback MongoDB only.');
  }
  const name = url.pathname.slice(1);
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('An explicit database name is required.');
  return name;
}

/** Explicit, resumable copy. Neither the source database nor its files are removed. */
export async function importLegacyDatabase(
  sourceUri: string,
  targetUri: string
): Promise<{ copied: number; resumed: boolean }> {
  const sourceName = databaseName(sourceUri);
  const targetName = databaseName(targetUri);
  const sourceEndpoint = new URL(sourceUri).host;
  if (sourceName === targetName) throw new Error('Source and destination databases must differ.');
  const sourceClient = new MongoClient(sourceUri);
  const targetClient = new MongoClient(targetUri);
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const source = sourceClient.db(sourceName);
    const target = targetClient.db(targetName);
    const states = target.collection<any>(stateCollection);
    const previous = await states.findOne({ _id: markerId });
    if (previous && previous.sourceName !== sourceName)
      throw new Error('This destination belongs to a different import.');
    if (previous?.sourceEndpoint && previous.sourceEndpoint !== sourceEndpoint)
      throw new Error('This destination belongs to a different import endpoint.');
    const targetCollections = await target.listCollections({}, { nameOnly: true }).toArray();
    if (!previous) {
      for (const collection of targetCollections) {
        if (await target.collection(collection.name).countDocuments()) {
          throw new Error(
            'Destination contains data. Import into an empty database before the first Tempo launch.'
          );
        }
      }
    }
    const collections = (await source.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('system.') && name !== stateCollection);
    if (!collections.includes('users') || !(await source.collection('users').countDocuments())) {
      throw new Error('No legacy user data was found.');
    }
    const localIdentities = await source.collection('users').countDocuments({
      $or: [
        { googleId: 'cronus-local-user' },
        { googleId: 'tempo-local-user' },
        { email: 'local@cronus.invalid' },
      ],
    });
    if (localIdentities !== 1)
      throw new Error('Import requires exactly one recognized local user; no identity was guessed.');
    if (previous?.state === 'completed') return { copied: previous.copied, resumed: true };
    await states.updateOne(
      { _id: markerId },
      { $set: { sourceName, sourceEndpoint, state: 'copying', startedAt: previous?.startedAt || new Date() } },
      { upsert: true }
    );
    let copied = 0;
    for (const name of collections) {
      for await (const original of source.collection(name).find({})) {
        const document = { ...original };
        if (
          name === 'users' &&
          (document.googleId === 'cronus-local-user' || document.email === 'local@cronus.invalid')
        ) {
          document.googleId = 'tempo-local-user';
          if (document.email === 'local@cronus.invalid') document.email = 'local@tempo.invalid';
        }
        const existing = await target.collection(name).findOne({ _id: document._id });
        if (existing && JSON.stringify(existing) !== JSON.stringify(document)) {
          throw new Error(
            'Destination changed since the interrupted import. No existing record was overwritten.'
          );
        }
        if (!existing) await target.collection(name).insertOne(document);
        copied++;
      }
      if (
        (await source.collection(name).countDocuments()) !==
        (await target.collection(name).countDocuments())
      ) {
        throw new Error(
          'Import count verification failed. Keep Tempo closed and retry the import.'
        );
      }
    }
    await states.updateOne(
      { _id: markerId },
      { $set: { state: 'completed', completedAt: new Date(), copied } }
    );
    return { copied, resumed: Boolean(previous) };
  } finally {
    await Promise.all([sourceClient.close(), targetClient.close()]);
  }
}
