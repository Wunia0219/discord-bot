import test from 'node:test';
import assert from 'node:assert/strict';
import { discordAvatarUrl } from '../src/platform/discord-avatar.js';

test('avatar URLs preserve the exact Discord identity and support static previews of animated avatars', () => {
  const id='594548913961435138', hash='1269e74af4df7417b13759eae50c83dc';
  assert.equal(discordAvatarUrl({id,avatar:hash}),`https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`);
  assert.equal(discordAvatarUrl({id,avatar:`a_${hash}`}),`https://cdn.discordapp.com/avatars/${id}/a_${hash}.png?size=128`);
});

test('missing or malformed avatar data uses the local fallback instead of an arbitrary image URL', () => {
  const id='594548913961435138';
  for (const user of [null,{}, {id,avatar:null}, {id,avatar:'https://example.com/image'}, {id,avatar:'../private'}, {id:'invalid',avatar:'1'.repeat(32)}]) assert.equal(discordAvatarUrl(user),null);
});
