// packages/sdk-core/src/micro.ts: Universal Micro-Client (< 35 lines)
export interface MicroPingOptions {
  endpoint?: string;
  publicKey: string;
  ruleSlug: string;
  userId: string;
  value?: number;
  timezone?: string;
}

export async function pingStreak(options: MicroPingOptions) {
  const endpoint = (options.endpoint || 'http://localhost:3000').replace(/\/+$/, '');
  const res = await fetch(`${endpoint}/v1/ping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.publicKey}`
    },
    body: JSON.stringify({
      ruleSlug: options.ruleSlug,
      externalUserId: options.userId,
      value: options.value || 1,
      timezone: options.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
    })
  });
  return res.json();
}

export function openStreakModal(options: { endpoint?: string; ruleSlug: string; userId: string }) {
  const endpoint = (options.endpoint || 'http://localhost:3000').replace(/\/+$/, '');
  const url = `${endpoint}/v1/embed/${encodeURIComponent(options.ruleSlug)}/${encodeURIComponent(options.userId)}`;

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:none;z-index:999999;background:rgba(15,23,42,0.8);';

  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'STREAKKIT_CLOSE') {
      iframe.remove();
      window.removeEventListener('message', handler);
    }
  };
  window.addEventListener('message', handler);
  document.body.appendChild(iframe);
}
