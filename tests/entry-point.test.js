import test from 'node:test';
import assert from 'node:assert/strict';
import { configureQuietLaunch } from '../server/entry-point.js';

const clientId = '100000000000000001', entryId = '100000000000000002';
test('quiet launch patches only the global Activity handler and verifies the result', async () => {
  const calls = []; let handler = 2;
  const result = await configureQuietLaunch({ clientId, clientSecret: 'fake-secret', fetchImpl: async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fake-command-token' });
    if (opts.method === 'PATCH') {
      assert.equal(url, `https://discord.com/api/v10/applications/${clientId}/commands/${entryId}`);
      assert.deepEqual(JSON.parse(opts.body), { handler: 1 }); handler = 1;
      return Response.json({ id: entryId, type: 4, handler });
    }
    return Response.json([{ id: '100000000000000003', type: 1, name: '籌碼' }, { id: entryId, type: 4, handler, name: '啟動' }]);
  } });
  assert.deepEqual(result, { id: entryId, name: '啟動', handler: 1, changed: true });
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'POST only obtains the application token');
});

test('quiet launch is idempotent and does not create a missing entry or overwrite other commands', async () => {
  const stub = commands => async (url, opts) => {
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fake-command-token' });
    assert.equal(opts.method, undefined);
    return Response.json(commands);
  };
  assert.equal((await configureQuietLaunch({ clientId, clientSecret: 'fake', fetchImpl: stub([{ id: entryId, type: 4, handler: 1 }]) })).changed, false);
  await assert.rejects(configureQuietLaunch({ clientId, clientSecret: 'fake', fetchImpl: stub([{ id: entryId, type: 1 }]) }), /唯一/);
});
