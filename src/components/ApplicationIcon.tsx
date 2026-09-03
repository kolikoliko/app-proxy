import { useEffect, useRef, useState } from "react";
import { getAppIcon } from "../lib/bridge";

const iconCache = new Map<string, string | null>();
const pendingIcons = new Map<string, Promise<string | null>>();
const MAX_CACHED_ICONS = 64;
const MAX_LOAD_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;

function rememberIcon(key: string, value: string | null) {
  if (iconCache.size >= MAX_CACHED_ICONS && !iconCache.has(key)) {
    const oldest = iconCache.keys().next().value;
    if (oldest) iconCache.delete(oldest);
  }
  iconCache.set(key, value);
}
function wait(delay: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

async function requestIcon(executablePath: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt += 1) {
    try {
      const value = await getAppIcon(executablePath);
      if (value) rememberIcon(executablePath.toLocaleLowerCase(), value);
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_LOAD_ATTEMPTS) await wait(RETRY_DELAY_MS);
    }
  }
  console.warn(`读取应用图标失败：${executablePath}`, lastError);
  return null;
}

function loadIcon(executablePath: string) {
  const key = executablePath.toLocaleLowerCase();
  if (iconCache.has(key)) return Promise.resolve(iconCache.get(key) ?? null);
  const existing = pendingIcons.get(key);
  if (existing) return existing;
  const request = requestIcon(executablePath)
    .then((value) => {
      pendingIcons.delete(key);
      return value;
    }, (error) => {
      pendingIcons.delete(key);
      throw error;
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
        <img
          src={iconUrl}
          alt=""
          draggable={false}
          onError={() => {
            iconCache.delete(key);
            console.warn(`浏览器无法解码应用图标：${executablePath}`);
            setIconUrl(null);
          }}
        />
      ) : fallback}
    </span>
  );
}
