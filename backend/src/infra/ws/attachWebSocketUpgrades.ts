import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";

/**
 * Multiple `WebSocketServer({ server, path })` instances on one `http.Server` each register `upgrade`;
 * the first handler aborts non-matching paths and destroys the socket. Route upgrades here instead.
 */
export function attachWebSocketUpgrades(
  httpServer: HttpServer,
  routes: ReadonlyArray<{ pathname: string; wss: WebSocketServer }>
): void {
  httpServer.on("upgrade", (request, socket, head) => {
    try {
      const host = request.headers.host ?? "localhost";
      const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
      const match = routes.find((r) => r.pathname === pathname);
      if (!match) {
        socket.destroy();
        return;
      }
      match.wss.handleUpgrade(request, socket, head, (ws) => {
        match.wss.emit("connection", ws, request);
      });
    } catch {
      socket.destroy();
    }
  });
}
