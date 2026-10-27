export function commandChannels(env){
  const ids=(env.DISCORD_COMMAND_CHANNEL_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(ids.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Invalid DISCORD_COMMAND_CHANNEL_IDS');
  return [...new Set(ids)];
}
