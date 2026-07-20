import { useEffect, useRef, useState } from "react";
import { getAppIcon } from "../lib/bridge";

const iconCache = new Map<string, string | null>();
const pendingIcons = new Map<string, Promise<string | null>>();
const MAX_CACHED_ICONS = 64;

function rememberIcon(key: string, value: string | null) {
  if (iconCache.size >= MAX_CACHED_ICONS && !iconCache.has(key)) {
    const oldest = iconCache.keys().next().value;
    if (oldest) iconCache.delete(oldest);
  }
  iconCache.set(key, value);
}
function loadIcon(executablePath: string) {
  const key = executablePath.toLocaleLowerCase();
  if (iconCache.has(key)) return Promise.resolve(iconCache.get(key) ?? null);
  const existing = pendingIcons.get(key);
  if (existing) return existing;
  const request = getAppIcon(executablePath)
    .catch(() => null)
    .then((value) => {
      rememberIcon(key, value);
      pendingIcons.delete(key);
      return value;
    });
  pendingIcons.set(key, request);
  return request;
}

type ApplicationIconProps = {
  displayName: string;
  executablePath: string;
};

export function ApplicationIcon({ displayName, executablePath }: ApplicationIconProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const key = executablePath.toLocaleLowerCase();
  const [visible, setVisible] = useState(() => iconCache.has(key));
  const [iconUrl, setIconUrl] = useState<string | null>(() => iconCache.get(key) ?? null);
  const fallback = Array.from(displayName.trim())[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    const element = containerRef.current;
    if (!element || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadIcon(executablePath).then((value) => {
      if (!cancelled) setIconUrl(value);
    });
    return () => { cancelled = true; };
  }, [executablePath, visible]);

  return (
    <span ref={containerRef} className="app-glyph app-glyph--native" aria-hidden="true">
      {iconUrl ? (
        <img src={iconUrl} alt="" draggable={false} onError={() => setIconUrl(null)} />
      ) : fallback}
    </span>
  );
}
