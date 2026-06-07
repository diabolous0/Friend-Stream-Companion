import { createRoot } from "react-dom/client";
import App from "./App";
import { applyServerConnection } from "./lib/server-connection";
import "./index.css";

// Point the API client at the active server (self-hosted or same-origin)
// before React renders, so the first request uses the right base URL.
applyServerConnection();

createRoot(document.getElementById("root")!).render(<App />);
