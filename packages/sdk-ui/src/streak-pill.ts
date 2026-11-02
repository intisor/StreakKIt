// packages/sdk-ui/src/streak-pill.ts: <streak-pill> custom element
import { StreakStateDTO } from '@streakkit/sdk-core';

export class StreakPill extends HTMLElement {
  private unsubscribe?: () => void;
  private state: StreakStateDTO | null = null;
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return ['rule', 'theme'];
  }

  connectedCallback() {
    this.render();
    this.connectSdk();
    this.addEventListener('click', () => this.openModal());
  }

  disconnectedCallback() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue) {
      if (name === 'rule') {
        this.connectSdk();
      }
      this.render();
    }
  }

  private connectSdk() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    const rule = this.getAttribute('rule');
    if (!rule) return;

    const sdk = (window as any).StreakSDK;
    if (sdk && sdk.subscribe) {
      this.unsubscribe = sdk.subscribe(rule, (state: StreakStateDTO) => {
        this.state = state;
        this.render();
      });
    }
  }

  private openModal() {
    const rule = this.getAttribute('rule');
    if (!rule) return;

    let modal = document.querySelector(`streak-modal[rule="${rule}"]`) as any;
    if (!modal) {
      modal = document.createElement('streak-modal');
      modal.setAttribute('rule', rule);
      document.body.appendChild(modal);
    }
    if (modal && typeof modal.open === 'function') {
      modal.open(this.state);
    }
  }

  public setState(state: StreakStateDTO) {
    this.state = state;
    this.render();
  }

  private formatCountdown(seconds: number): string {
    if (seconds <= 0) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  private render() {
    const theme = this.getAttribute('theme') || 'dark';
    const isDark = theme === 'dark';
    const status = this.state?.status || 'PENDING_TODAY';
    const streak = this.state?.currentStreak ?? 0;
    const progress = this.state?.todayProgress ?? { current: 0, target: 1, completed: false };
    const secondsLeft = this.state?.timing?.secondsUntilExpiry ?? 0;

    // Progress circle stroke math
    const radius = 12;
    const circumference = 2 * Math.PI * radius;
    const ratio = Math.min(1, progress.current / Math.max(1, progress.target));
    const strokeDashoffset = circumference - ratio * circumference;

    let flameColor = '#94a3b8'; // grey
    let flameGlow = 'none';
    let pulseClass = '';

    if (status === 'ACTIVE_TODAY') {
      flameColor = '#f59e0b'; // gold/orange
      flameGlow = '0 0 12px rgba(245, 158, 11, 0.6)';
      pulseClass = 'bounce';
    } else if (status === 'AT_RISK') {
      flameColor = '#ef4444'; // red
      flameGlow = '0 0 10px rgba(239, 68, 68, 0.7)';
      pulseClass = 'pulse-at-risk';
    } else if (status === 'FROZEN') {
      flameColor = '#38bdf8'; // icy blue
      flameGlow = '0 0 10px rgba(56, 189, 248, 0.6)';
    }

    const bg = isDark ? '#1e293b' : '#f8fafc';
    const text = isDark ? '#f8fafc' : '#0f172a';
    const border = isDark ? '#334155' : '#e2e8f0';

    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          cursor: pointer;
          user-select: none;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: ${bg};
          color: ${text};
          border: 1px solid ${border};
          border-radius: 9999px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .pill:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .flame-container {
          position: relative;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .progress-ring {
          position: absolute;
          top: 0;
          left: 0;
          transform: rotate(-90deg);
        }
        .progress-ring-circle {
          stroke: #f59e0b;
          stroke-dasharray: ${circumference};
          stroke-dashoffset: ${strokeDashoffset};
          transition: stroke-dashoffset 0.35s ease;
        }
        .flame-icon {
          width: 18px;
          height: 18px;
          fill: ${flameColor};
          filter: drop-shadow(${flameGlow});
          transition: fill 0.3s ease, filter 0.3s ease;
        }
        .count {
          font-size: 14px;
          font-weight: 700;
          line-height: 1;
        }
        .countdown {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          background: #ef4444;
          color: #ffffff;
          border-radius: 9999px;
          animation: pulse 1.5s infinite;
        }
        .bounce {
          animation: bounce 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .pulse-at-risk {
          animation: pulse 1.5s infinite;
        }
        @keyframes bounce {
          0% { transform: scale(0.8); }
          50% { transform: scale(1.25); }
          100% { transform: scale(1); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      </style>

      <div class="pill">
        <div class="flame-container ${pulseClass}">
          <svg class="progress-ring" width="28" height="28">
            <circle
              stroke="${isDark ? '#334155' : '#e2e8f0'}"
              stroke-width="2"
              fill="transparent"
              r="${radius}"
              cx="14"
              cy="14"
            />
            <circle
              class="progress-ring-circle"
              stroke-width="2.5"
              stroke-linecap="round"
              fill="transparent"
              r="${radius}"
              cx="14"
              cy="14"
            />
          </svg>
          <svg class="flame-icon" viewBox="0 0 24 24">
            <path d="M17.556 7.847C16.828 6.536 15.65 5.56 14.5 4.5c-.38-.35-.76-.71-1.12-1.09-.32-.34-.84-.34-1.16 0C11.16 4.54 9.9 5.86 9.07 7.37 7.78 9.72 7.75 12.35 8.99 14.71c.28.53.64 1.02 1.07 1.44.38.38.99.38 1.37 0 .28-.28.41-.67.35-1.06-.18-1.13.14-2.28.84-3.15.22-.27.6-.33.88-.13.29.2.37.58.21.9-.53 1.05-.56 2.27-.08 3.35.43.97 1.22 1.74 2.2 2.15.54.23 1.15.11 1.56-.29.47-.46.85-1.01 1.12-1.62 1.02-2.31.84-4.99-.44-7.46zM12 22C6.48 22 2 17.52 2 12c0-3.31 1.62-6.24 4.1-8.03.43-.31 1.02-.2 1.32.23.3.43.2 1.02-.23 1.32C5.03 7.08 3.75 9.4 3.75 12c0 4.56 3.69 8.25 8.25 8.25s8.25-3.69 8.25-8.25c0-1.87-.63-3.6-1.7-4.99-.35-.45-.27-1.1.18-1.45.45-.35 1.1-.27 1.45.18 1.32 1.71 2.07 3.84 2.07 6.26 0 5.52-4.48 10-10 10z"/>
          </svg>
        </div>

        <span class="count">${streak}</span>

        ${status === 'AT_RISK' ? `<span class="countdown">${this.formatCountdown(secondsLeft)}</span>` : ''}
      </div>
    `;
  }
}
