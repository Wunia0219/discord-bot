// Discord's User Avatar CDN format. The existing identify scope supplies this hash.
// https://docs.discord.com/developers/reference#image-formatting
export function discordAvatarUrl(user) {
  if (!/^\d{17,20}$/.test(user?.id || '') || !/^(?:a_)?[a-f0-9]{32}$/i.test(user?.avatar || '')) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}
