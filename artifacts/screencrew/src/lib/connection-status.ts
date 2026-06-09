export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    default:
      return "Connecting";
  }
}

export function connectionDescription(state: ConnectionState): string {
  switch (state) {
    case "reconnecting":
      return "LynxDock is trying to reach the server again.";
    case "offline":
      return "Your device appears offline. Messages and calls resume when the network returns.";
    case "connecting":
      return "Opening the live server connection.";
    default:
      return "";
  }
}
