import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "../theme";

/* Sun in the dark theme (switch to light), moon in the light theme (switch to dark). */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  return (
    <button type="button" className="theme-toggle" title={label} aria-label={label} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
