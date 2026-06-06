import { useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export function useAuthInit() {
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    setAuthTokenGetter(() => {
      return localStorage.getItem("screencrew_token");
    });
    // Add dark mode class by default
    document.documentElement.classList.add('dark');
    setIsReady(true);
  }, []);

  return isReady;
}
