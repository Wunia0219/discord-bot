import {createServer} from 'node:http';
import {createActivityHandler} from './app-handler.js';
export function createActivityServer(options={}){
 const handler=createActivityHandler(options),server=createServer(handler);
 server.drainCommands=handler.drainCommands;return server;
}
