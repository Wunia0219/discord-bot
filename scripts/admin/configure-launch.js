import { configureQuietLaunch } from '../../server/entry-point.js';

const result = await configureQuietLaunch({ clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET });
console.log(JSON.stringify({ ...result, status: '已確認使用安靜啟動；不自動張貼遊戲邀請。' }));
