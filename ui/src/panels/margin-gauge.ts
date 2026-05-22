export class MarginGauge {
  private renderRequested = false;
  private data: any | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly root: HTMLElement, private readonly pollDataFn?: () => void) {
    this.root.classList.add('panel-content', 'margin-gauge');
    if (this.pollDataFn) {
      this.timer = setInterval(this.pollDataFn, 5000);
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }

  update(data: any): void {
    this.data = data;
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      this.renderSync();
    });
  }

  private renderSync(): void {
    if (!this.data) {
      this.root.innerHTML = '<div class="empty-hint">Awaiting margin data...</div>';
      return;
    }

    const { used, available, span, exposure, totalInitial, var95 } = this.data;
    const total = used + available;
    const utilization = total > 0 ? (used / total) * 100 : 0;
    
    // Color band logic
    let color = '#2ebd85'; // green
    if (utilization > 80) color = '#f6465d'; // red
    else if (utilization > 60) color = '#ffaa00'; // amber

    const fmtCurrency = (n: number) => '₹' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    // CSS Arc logic (using conic-gradient for a simple arc, clipped)
    // Map 0-100% to -90deg to +90deg (or just a semi-circle from 270deg to 90deg)
    const angle = (utilization / 100) * 180;
    
    this.root.innerHTML = `
      <div class="margin-gauge-wrap" style="text-align: center; padding: 10px;">
        <div class="gauge-arc" style="
          width: 200px; 
          height: 100px; 
          margin: 0 auto 20px;
          border-top-left-radius: 100px;
          border-top-right-radius: 100px;
          background: conic-gradient(from 270deg, ${color} ${angle}deg, #333 ${angle}deg 180deg);
          position: relative;
        ">
          <div style="
            position: absolute;
            bottom: 0; left: 20px; right: 20px; top: 20px;
            background: #131722;
            border-top-left-radius: 80px;
            border-top-right-radius: 80px;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            padding-bottom: 10px;
          ">
            <div style="font-size: 24px; font-weight: bold; color: ${color};">
              ${utilization.toFixed(1)}%
            </div>
          </div>
        </div>
        
        <div class="margin-breakdown" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: left; font-size: 13px;">
          <div><span style="color: #888;">Used:</span> <strong>${fmtCurrency(used)}</strong></div>
          <div><span style="color: #888;">Available:</span> <strong>${fmtCurrency(available)}</strong></div>
          <div><span style="color: #888;">SPAN:</span> <strong>${fmtCurrency(span)}</strong></div>
          <div><span style="color: #888;">Exposure:</span> <strong>${fmtCurrency(exposure)}</strong></div>
          <div><span style="color: #888;">Total Initial:</span> <strong>${fmtCurrency(totalInitial)}</strong></div>
          <div><span style="color: #888;">VaR (95%):</span> <strong style="color: #f6465d;">${var95 ? fmtCurrency(var95) : '—'}</strong></div>
        </div>
      </div>
    `;
  }
}
