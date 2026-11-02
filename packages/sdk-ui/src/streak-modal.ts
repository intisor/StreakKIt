// packages/sdk-ui/src/streak-modal.ts: <streak-modal> custom element
import { StreakStateDTO } from '@streakkit/sdk-core';

export class StreakModal extends HTMLElement {
  private state: StreakStateDTO | null = null;
  private isOpen = false;
  private shadow: ShadowRoot;
  private unsubscribe?: () => void;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return ['rule'];
  }

  connectedCallback() {
    this.render();
    this.connectSdk();
  }

  disconnectedCallback() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue && name === 'rule') {
      this.connectSdk();
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
        const prevJustReached = this.state?.milestone?.justReached;
        this.state = state;
        // Auto-open modal when a new milestone is reached!
        if (state.milestone?.justReached && state.milestone.justReached !== prevJustReached) {
          this.isOpen = true;
        }
        this.render();
      });
    }
  }

  public open(state?: StreakStateDTO) {
    if (state) this.state = state;
    this.isOpen = true;
    this.render();
  }

  public close() {
    this.isOpen = false;
    this.render();
  }

  private shareMilestone() {
    const streak = this.state?.currentStreak ?? 0;
    const text = `🔥 I'm on a ${streak}-day streak on ${this.state?.ruleSlug || 'StreakKit'}! Can you beat me?`;

    if (navigator.share) {
      navigator.share({ title: 'My Streak Milestone', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Streak milestone copied to clipboard!');
      });
    }
  }

  private renderHistoryIcon(state: string): string {
    switch (state) {
      case 'COMPLETED':
        return `<span style="color:#22c55e;">✓</span>`;
      case 'FROZEN':
        return `<span style="color:#38bdf8;">❄</span>`;
      case 'EXEMPT':
        return `<span style="color:#94a3b8;">—</span>`;
      case 'MISSED':
        return `<span style="color:#ef4444;">✕</span>`;
      default:
        return `<span style="color:#64748b;">•</span>`;
    }
  }

  private render() {
    if (!this.isOpen) {
      this.shadow.innerHTML = '';
      return;
    }

    const streak = this.state?.currentStreak ?? 0;
    const highest = this.state?.highestStreak ?? streak;
    const freezesAvail = this.state?.freezes?.available ?? 0;
    const freezesMax = this.state?.freezes?.max ?? 2;
    const history = this.state?.historyLast14Days ?? [];
    const milestone = this.state?.milestone;

    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: fadeIn 0.2s ease;
        }
        .card {
          width: 100%;
          max-width: 420px;
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 20px;
          padding: 24px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }
        .close-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 20px;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .close-btn:hover {
          background: #1e293b;
          color: #ffffff;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .flame-hero {
          font-size: 48px;
          line-height: 1;
          margin-bottom: 8px;
        }
        .streak-number {
          font-size: 36px;
          font-weight: 800;
          color: #f59e0b;
        }
        .streak-label {
          font-size: 14px;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 20px;
        }
        .stat-box {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 12px;
          text-align: center;
        }
        .stat-value {
          font-size: 18px;
          font-weight: 700;
          color: #f8fafc;
        }
        .stat-name {
          font-size: 12px;
          color: #94a3b8;
        }
        .history-section {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 20px;
        }
        .section-title {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin-bottom: 10px;
        }
        .history-strip {
          display: flex;
          justify-content: space-between;
          overflow-x: auto;
          gap: 6px;
        }
        .day-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          font-size: 11px;
          gap: 4px;
        }
        .day-icon {
          width: 24px;
          height: 24px;
          background: #0f172a;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: bold;
        }
        .milestone-box {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(234, 88, 12, 0.15));
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 20px;
          text-align: center;
        }
        .share-btn {
          width: 100%;
          padding: 12px;
          background: #f59e0b;
          color: #0f172a;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s;
        }
        .share-btn:hover {
          background: #d97706;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px) scale(0.96); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      </style>

      <div class="backdrop" id="backdrop">
        <div class="card">
          <button class="close-btn" id="closeBtn">✕</button>

          <div class="header">
            <div class="flame-hero">🔥</div>
            <div class="streak-number">${streak}</div>
            <div class="streak-label">Day Streak</div>
          </div>

          <div class="stat-grid">
            <div class="stat-box">
              <div class="stat-value">🏆 ${highest}</div>
              <div class="stat-name">Highest Streak</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">🛡️ ${freezesAvail} / ${freezesMax}</div>
              <div class="stat-name">Freezes Left</div>
            </div>
          </div>

          <div class="history-section">
            <div class="section-title">Last 14 Days Activity</div>
            <div class="history-strip">
              ${history
                .slice(-10)
                .map((item) => {
                  const dayName = item.date.slice(8);
                  return `
                  <div class="day-col">
                    <span style="color:#64748b;">${dayName}</span>
                    <div class="day-icon">${this.renderHistoryIcon(item.state)}</div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>

          ${
            milestone?.nextMilestone
              ? `
            <div class="milestone-box">
              <div style="font-size: 14px; font-weight: 600; color: #f59e0b;">
                🎯 ${milestone.daysToNextMilestone} days to Day ${milestone.nextMilestone}!
              </div>
            </div>
          `
              : ''
          }

          <button class="share-btn" id="shareBtn">
            Share Milestone 🚀
          </button>
        </div>
      </div>
    `;

    this.shadow.getElementById('closeBtn')?.addEventListener('click', () => this.close());
    this.shadow.getElementById('backdrop')?.addEventListener('click', (e) => {
      if (e.target === this.shadow.getElementById('backdrop')) {
        this.close();
      }
    });
    this.shadow.getElementById('shareBtn')?.addEventListener('click', () => this.shareMilestone());
  }
}
