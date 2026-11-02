// packages/sdk-ui/src/index.ts: Custom Elements registration & export
import { StreakPill } from './streak-pill.js';
import { StreakModal } from './streak-modal.js';

export { StreakPill, StreakModal };

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streak-pill')) {
    customElements.define('streak-pill', StreakPill);
  }
  if (!customElements.get('streak-modal')) {
    customElements.define('streak-modal', StreakModal);
  }
}
