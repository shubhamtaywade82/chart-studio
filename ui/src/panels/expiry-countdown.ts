export class ExpiryCountdown {
  private timer: ReturnType<typeof setInterval> | null = null;
  private expiryTime: number = 0;

  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('expiry-countdown');
    this.render();
  }

  setExpiry(timestampMs: number, type: 'Weekly' | 'Monthly' = 'Weekly') {
    this.expiryTime = timestampMs;
    if (this.timer) clearInterval(this.timer);
    
    this.timer = setInterval(() => this.render(type), 1000);
    this.render(type);
  }

  reset() {
    if (this.timer) clearInterval(this.timer);
    this.expiryTime = 0;
    this.root.innerHTML = '';
  }

  private render(type: string = 'Weekly') {
    if (!this.expiryTime) return;

    const now = Date.now();
    const diff = Math.max(0, this.expiryTime - now);
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / 1000 / 60) % 60);
    const secs = Math.floor((diff / 1000) % 60);

    let colorState = 'var(--text-primary)';
    let pulseClass = '';
    
    if (days < 1) {
      colorState = 'var(--bear)'; // Red on expiry day
      pulseClass = 'pulse-text';
    } else if (days < 3) {
      colorState = 'var(--accent)'; // Amber within 3 days
    }

    this.root.innerHTML = `
      <style>
        .pulse-text { animation: pulse-red 2s infinite; }
        @keyframes pulse-red {
          0% { opacity: 1; }
          50% { opacity: 0.5; color: #ff1744; }
          100% { opacity: 1; }
        }
      </style>
      <div style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; background: var(--bg-card); border: 1px solid var(--border);">
        <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">${type} Expiry</span>
        <span class="${pulseClass}" style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: ${colorState};">
          ${days}d ${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}
        </span>
      </div>
    `;
  }
}
