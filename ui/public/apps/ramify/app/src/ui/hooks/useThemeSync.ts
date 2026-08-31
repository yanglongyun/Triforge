import { useEffect, useLayoutEffect, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { api } from '../api';
import { resolveTheme } from '../lib/theme';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useSettingsSync() {
  const [settings, setSettings] = useState<AppSettings>({ theme: 'system', locale: 'zh-CN' });
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolved = resolveTheme(settings.theme, prefersDark);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = settings.theme;
  }, [settings.theme, resolved]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    // 设置本身很小(几十字节),没必要为它单独开一条 version 接口,
    // 直接每秒轮询一次 /api/settings,变了才 setState,免去 SSE 长连接。
    let cancelled = false;
    const poll = () => {
      void api.settings().then((next) => {
        if (cancelled) return;
        setSettings((prev) => (prev.theme === next.theme && prev.locale === next.locale ? prev : next));
      }).catch(console.error);
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return settings;
}
