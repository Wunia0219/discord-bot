import { fileURLToPath } from 'node:url';
import { createActivityServer } from './app.js';

const port = Number(process.env.PORT || 4188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const configured = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET?.trim());
const server = createActivityServer({
  clientId:process.env.DISCORD_CLIENT_ID,
  clientSecret:process.env.DISCORD_CLIENT_SECRET,
  distDir:fileURLToPath(new URL('../dist/', import.meta.url)),
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Activity server: http://127.0.0.1:${port} (OAuth ${configured ? 'configured' : 'not configured'})`);
});
