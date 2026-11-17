"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { themeCookie } from "../lib/theme-cookie";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    const maxAge = next === "dark" ? 31536000 : 0;
    document.documentElement.dataset.theme = next;
    document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    setTheme(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is missing");
  return value;
}
