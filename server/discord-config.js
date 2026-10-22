export function discordConfigurationReady({ clientId, clientSecret, publicKey } = {}) {
  return /^\d{17,20}$/.test(clientId || '')
    && typeof clientSecret === 'string' && !!clientSecret.trim()
    && /^[a-f\d]{64}$/i.test(publicKey || '');
}

export function assertDiscordConfiguration(env) {
  if (!discordConfigurationReady({
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    publicKey: env.DISCORD_PUBLIC_KEY,
  })) throw new Error('Discord wallet requires valid DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_PUBLIC_KEY');
}
