export const securityHeaders = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
});

// Discord embeds the game; SAMEORIGIN/X-Frame-Options would block that entry.
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com",
].join('; ');

export function secureResponse(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
  if (secured.headers.get('Content-Type')?.startsWith('text/html')) {
    secured.headers.set('Content-Security-Policy', contentSecurityPolicy);
  }
  return secured;
}
