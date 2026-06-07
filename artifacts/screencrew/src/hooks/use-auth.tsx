import { useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getActiveToken, applyServerConnection } from "@/lib/server-connection";

export function useAuthInit() {
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    // Point the API client at the active backend and use its per-backend token.
    applyServerConnection();
    setAuthTokenGetter(() => getActiveToken());
    // Add dark mode class by default
    document.documentElement.classList.add('dark');
    setIsReady(true);
  }, []);

  return isReady;
}
