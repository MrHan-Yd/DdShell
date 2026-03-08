import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app";

export function Logo({ size = 32 }: { size?: number }) {
  const theme = useAppStore((s) => s.theme);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      setIsDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      setIsDark(theme === "dark");
    }
  }, [theme]);

  return (
    <img
      src={isDark ? "/logo-dark.svg" : "/logo.svg"}
      alt="DdShell"
      width={size}
      height={size}
    />
  );
}
