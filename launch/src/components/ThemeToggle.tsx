"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("otf-launch-theme");
    const next = saved === "light";
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
  }, []);
  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
    localStorage.setItem("otf-launch-theme", next ? "light" : "dark");
  }
  return <button className="iconButton" type="button" onClick={toggle} aria-label={`Use ${light ? "dark" : "light"} theme`}>{light ? <Moon size={16} /> : <Sun size={16} />}</button>;
}
