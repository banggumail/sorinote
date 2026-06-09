const isProd = import.meta.env.PROD;

// In production, we proxy /api and WebSocket socket.io via Nginx on the same domain
export const API_BASE = isProd ? '' : 'http://localhost:3000';
export const SOCKET_URL = isProd ? '' : 'http://localhost:3000';
