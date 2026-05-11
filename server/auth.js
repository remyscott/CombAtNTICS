// auth.js
import basicAuth from "express-basic-auth";
import parseBasic from "basic-auth";

/**
 * Create HTTP middleware for basic auth.
 * If authDisabled is true, returns a no-op middleware.
 *
 * @param {{[user:string]:string}|null} users - object map username => password, or null to disable auth
 * @param {object} [opts]
 * @returns {function} express middleware
 */
export function httpAuthMiddleware(users, opts = {}) {
  const realm = opts.realm || "Game Demo";

  if (!users || Object.keys(users).length === 0) {
    // No-op middleware that just calls next()
    return (req, res, next) => next();
  }

  return basicAuth({
    users,
    challenge: true,
    realm
  });
}

/**
 * Create an upgrade handler that enforces the same basic auth for WebSocket upgrade requests.
 * If users is falsy, returns a handler that just passes through the upgrade to the provided wss.
 *
 * Usage:
 *   const upgradeHandler = upgradeAuthHandler(AUTH_USERS, wss);
 *   server.on('upgrade', upgradeHandler);
 *
 * @param {{[user:string]:string}|null} users
 * @param {import('ws').WebSocketServer} wss
 * @param {object} [opts]
 * @returns {function} (req, socket, head) => void
 */
export function upgradeAuthHandler(users, wss, opts = {}) {
  const realm = opts.realm || "Game Demo";

  // If auth is disabled, just accept all upgrades
  if (!users || Object.keys(users).length === 0) {
    return (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    };
  }

  // Helper to validate Authorization header (Basic)
  function validateBasicAuthHeader(authHeader) {
    // parseBasic expects an object shaped like a request; pass a dummy
    const credentials = parseBasic(authHeader ? { headers: { authorization: authHeader } } : {});
    if (!credentials) return false;
    const { name, pass } = credentials;
    // simple compare; ok for demo. Use constant-time compare in prod.
    return users[name] && users[name] === pass;
  }

  // The handler that enforces auth before upgrading
  return (req, socket, head) => {
    try {
      const authHeader = req.headers['authorization'];
      if (!validateBasicAuthHeader(authHeader)) {
        // Send 401 and close the socket
        const body = 'HTTP/1.1 401 Unauthorized\r\n' +
                     `WWW-Authenticate: Basic realm="${realm}"\r\n` +
                     'Content-Length: 0\r\n\r\n';
        socket.write(body);
        socket.destroy();
        return;
      }

      // If authenticated, perform upgrade
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      // In case of errors, ensure socket is closed
      try { socket.destroy(); } catch (e) {}
    }
  };
}