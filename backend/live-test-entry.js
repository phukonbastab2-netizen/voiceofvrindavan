export { ChatRoom, ChatLobby } from './live-worker.js';
import { onRequest } from '../functions/api/community/[[path]].js';
// Local-only entry point for running the API and live objects in one runtime.
export default {fetch(request,env,ctx){return onRequest({request,env,waitUntil:p=>ctx.waitUntil(p)});}};
