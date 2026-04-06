import { API_BASE_URL } from "./api";

export function createProjectLogsSocket({ projectId, token, onMessage, onOpen, onClose, onError }) {
  const wsBase = API_BASE_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const wsUrl = `${wsBase}/api/v1/ws/projects/${projectId}/logs?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    if (onOpen) {
      onOpen();
    }
  });

  socket.addEventListener("message", (event) => {
    if (!onMessage) {
      return;
    }

    try {
      const payload = JSON.parse(event.data);
      onMessage(payload);
    } catch (_error) {
      onMessage({
        id: Date.now(),
        level: "INFO",
        source: "ws",
        message: event.data,
        created_at: new Date().toISOString(),
      });
    }
  });

  socket.addEventListener("close", () => {
    if (onClose) {
      onClose();
    }
  });

  socket.addEventListener("error", () => {
    if (onError) {
      onError();
    }
  });

  return socket;
}
