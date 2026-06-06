import { createContext, useContext, useEffect, useState } from "react";

export type UITheme = "lynx" | "classic";

interface ThemeCtx {
  theme: UITheme;
  setTheme: (t: UITheme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: "lynx", setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<UITheme>(() => {
    return (localStorage.getItem("screencrew_ui") as UITheme) ?? "lynx";
  });

  const setTheme = (t: UITheme) => {
    setThemeState(t);
    localStorage.setItem("screencrew_ui", t);
    document.documentElement.dataset.ui = t;
  };

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.ui = theme;
  }, [theme]);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {(["lynx", "classic"] as const).map(t => (
        <button key={t} onClick={() => setTheme(t)}
          className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all ${
            theme === t
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground/40 hover:text-muted-foreground/70 border border-transparent"
          }`}>
          {t === "lynx" ? "Lynx" : "Classic"}
        </button>
      ))}
    </div>
  );
}
