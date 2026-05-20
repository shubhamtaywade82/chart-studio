import { ChartView } from './chart';
import { ProviderClient, type Candle, type SymbolRef } from './provider-client';
import { OrderBookPanel } from './panels/orderbook';
import { TradeTapePanel } from './panels/trade-tape';
import { SentimentPanel } from './panels/sentiment';
import { MicrostructurePanel } from './panels/microstructure';
import { GlobalSearch } from './search/global-search';
import { ProviderSettings } from './settings/providers';
import { WatchlistPanel } from './watchlist/watchlist';
import { IndicatorPicker } from './indicators/picker';
import { AlertEngine } from './alerts/alerts';
import { AlertsPanel } from './alerts/panel';
import { ScriptManager } from './scripts/editor';
import { DrawingLayer, type DrawingTool } from './drawings/drawings';
import { INDICATORS, type ActiveIndicator } from './indicators/registry';
import { AIBriefPanel } from './panels/ai-brief';
import { StrategySignalsPanel } from './panels/strategy-signals';
import { SmartSignalsPanel } from './panels/smart-signals';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

const parseIntervalMs = (interval: string): number => {
  const m = interval.match(/^(\d+)([mhd])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd') return n * 86_400_000;
  return 0;
};

interface AppState {
  provider: string;
  symbol: string;
  interval: string;
}

const parseHash = (): AppState | null => {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const m = h.match(/^([^:]+):(.+?)@(.+)$/);
  if (!m) return null;
  return { provider: m[1]!, symbol: m[2]!, interval: m[3]! };
};

const writeHash = (s: AppState): void => {
  const target = `#${s.provider}:${s.symbol}@${s.interval}`;
  if (location.hash !== target) location.hash = target;
};

const main = (): void => {
  const client = new ProviderClient();
  const chartContainer = document.getElementById('chart-container')! as HTMLDivElement;
  const obRoot = document.getElementById('orderbook')!;
  const obSpread = document.getElementById('ob-spread')!;
  const tapeRoot = document.getElementById('trade-tape')!;
  const sentimentRoot = document.getElementById('sentiment')!;
  const intervalBar = document.getElementById('interval-bar')!;
  const hdrSymbol = document.getElementById('hdr-symbol')!;
  const hdrVenue = document.getElementById('hdr-venue')!;
  const watchlistRoot = document.getElementById('watchlist')!;
  const wsStatus = document.getElementById('ws-status')!;
  const wsStatusText = document.getElementById('ws-status-text')!;
  const mainGrid = document.getElementById('main-grid')!;

  const chart = new ChartView(chartContainer);
  const ob = new OrderBookPanel(obRoot, obSpread);
  const tape = new TradeTapePanel(tapeRoot);
  const sentiment = new SentimentPanel(sentimentRoot);
  const microstructure = new MicrostructurePanel();
  const settings = new ProviderSettings(client);
  const watchlist = new WatchlistPanel(watchlistRoot, client);
  const indicatorPicker = new IndicatorPicker();
  const alertEngine = new AlertEngine(client);
  const scriptManager = new ScriptManager(chart, client);
  const drawings = new DrawingLayer(chart, chartContainer);
  const aiBrief = new AIBriefPanel();
  const strategySignals = new StrategySignalsPanel(client);
  const smartSignals = new SmartSignalsPanel();

  let activeState: AppState | null = parseHash();
  let currentCandles: Candle[] = [];
  const unsubs: Array<() => void> = [];
  // Trade-tape running counters (mirror sentiment buy/sell windowed counts roughly).
  let tapeBuys = 0;
  let tapeSells = 0;
  const tapeBuysEl = document.getElementById('tape-buys');
  const tapeSellsEl = document.getElementById('tape-sells');

  new AlertsPanel(alertEngine, () => (activeState ? { provider: activeState.provider, symbol: activeState.symbol } : null));

  const applyIndicators = (list: ActiveIndicator[]): void => {
    chart.setIndicators(list);
  };
  indicatorPicker.onChange(applyIndicators);

  // Drawings
  document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => drawings.setTool(btn.dataset.tool as DrawingTool));
  });
  document.getElementById('drawings-clear')?.addEventListener('click', () => drawings.clear());
  drawings.onToolChange((tool) => {
    document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  });

  // Candle theme picker
  const themeSelect = document.getElementById('candle-theme-select') as HTMLSelectElement | null;
  if (themeSelect) {
    const current = chart.currentTheme();
    themeSelect.innerHTML = chart.themes()
      .map((t) => `<option value="${t.id}" ${t.id === current.id ? 'selected' : ''}>${t.label}</option>`)
      .join('');
    themeSelect.addEventListener('change', () => chart.setTheme(themeSelect.value));
  }

  // Crosshair tooltip
  const tooltipEl = document.getElementById('chart-tooltip');
  chart.onCrosshair((info) => {
    if (!tooltipEl) return;
    if (!info) { tooltipEl.setAttribute('hidden', ''); return; }
    const dir = info.close >= info.open ? 'bull' : 'bear';
    const f = (n: number, d = 4): string => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    const change = ((info.close - info.open) / info.open) * 100;
    const changeDir = change >= 0 ? 'bull' : 'bear';
    const vol = info.volume !== null ? `<div class="tt-item"><span class="tt-k">V</span><span class="tt-v">${info.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>` : '';
    
    tooltipEl.innerHTML = `
      <div class="tt-item"><span class="tt-k">O</span><span class="tt-v">${f(info.open)}</span></div>
      <div class="tt-item"><span class="tt-k">H</span><span class="tt-v">${f(info.high)}</span></div>
      <div class="tt-item"><span class="tt-k">L</span><span class="tt-v">${f(info.low)}</span></div>
      <div class="tt-item"><span class="tt-k">C</span><span class="tt-v ${dir}">${f(info.close)}</span></div>
      <div class="tt-item"><span class="tt-k">CHG</span><span class="tt-v ${changeDir}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span></div>
      ${vol}`;
    tooltipEl.removeAttribute('hidden');
  });

  // Scroll-to-live FAB
  const scrollLiveBtn = document.getElementById('chart-scroll-live');
  scrollLiveBtn?.addEventListener('click', () => chart.scrollToRealtime());
  chart.onLiveStateChange((atLive) => {
    if (!scrollLiveBtn) return;
    if (atLive) scrollLiveBtn.setAttribute('hidden', '');
    else scrollLiveBtn.removeAttribute('hidden');
  });

  // WS connection state
  client.onConnectionChange((connected) => {
    wsStatus.classList.remove('connected', 'disconnected', 'connecting');
    if (connected) {
      wsStatus.classList.add('connected');
      wsStatusText.textContent = 'Live';
    } else {
      wsStatus.classList.add('disconnected');
      wsStatusText.textContent = 'Offline';
    }
  });

  // Sidebar / watchlist toggles
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
    mainGrid.classList.toggle('sidebar-hidden');
  });
  document.getElementById('watchlist-toggle')?.addEventListener('click', () => {
    mainGrid.classList.toggle('watchlist-hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); mainGrid.classList.toggle('sidebar-hidden'); }
    else if (k === 'l') { e.preventDefault(); mainGrid.classList.toggle('watchlist-hidden'); }
  });

  // Sidebar tab switching
  const sidebarTabs = document.querySelectorAll<HTMLButtonElement>('.sidebar-tab[data-tab]');
  const sidebarPanes = document.querySelectorAll<HTMLElement>('.sidebar-tab-pane[data-tab-pane]');
  sidebarTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      sidebarTabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      sidebarPanes.forEach((p) => {
        const on = p.dataset.tabPane === target;
        p.classList.toggle('is-active', on);
        if (on) p.removeAttribute('aria-hidden'); else p.setAttribute('aria-hidden', 'true');
      });
    });
  });

  // Settings modal tab switching
  const settingsNavItems = document.querySelectorAll<HTMLButtonElement>('.modal-nav-item[data-settings-tab]');
  const settingsPanes = document.querySelectorAll<HTMLElement>('.settings-tab-pane');
  const settingsTitle = document.getElementById('settings-tab-title');
  const tabTitles: Record<string, string> = {
    providers: 'Data Providers',
    indicators: 'Indicators & Overlays',
    system: 'System',
  };
  settingsNavItems.forEach((nav) => {
    nav.addEventListener('click', () => {
      const target = nav.dataset.settingsTab!;
      settingsNavItems.forEach((n) => {
        const on = n === nav;
        n.classList.toggle('active', on);
        n.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      settingsPanes.forEach((p) => p.classList.toggle('active', p.id === `tab-pane-${target}`));
      if (settingsTitle) settingsTitle.textContent = tabTitles[target] ?? 'Settings';
    });
  });

  // ── Topbar interval bar ─────────────────────────────────────────────
  const renderIntervals = (): void => {
    intervalBar.innerHTML = INTERVALS.map((i) =>
      `<button data-iv="${i}" class="${activeState?.interval === i ? 'active' : ''}">${i}</button>`
    ).join('');
    intervalBar.querySelectorAll<HTMLButtonElement>('button[data-iv]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!activeState) return;
        applyState({ ...activeState, interval: b.dataset.iv! });
      });
    });
  };

  const setSymbolLabels = (state: AppState | null): void => {
    if (!state) {
      hdrSymbol.textContent = 'No symbol';
      hdrVenue.textContent = '—';
      return;
    }
    hdrSymbol.textContent = state.symbol;
    hdrVenue.textContent = state.provider.toUpperCase();
  };

  const tearDown = (): void => {
    for (const fn of unsubs) try { fn(); } catch { /* noop */ }
    sentiment.reset();
    microstructure.reset();
    tape.reset();
    ob.reset(null);
    unsubs.length = 0;
  };

  // Header ticker (BID/ASK/SPREAD/price)
  let lastPrice: number | null = null;
  const fmt = (n: number): string => {
    const p = chart.getPrecision() ?? 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
  };

  const updateHeaderPrice = (price: number): void => {
    try {
      if (typeof price !== 'number' || !isFinite(price) || price <= 0) return;
      const hdrPrice = document.getElementById('hdr-price');
      const hdrChange = document.getElementById('hdr-change');
      if (hdrPrice) hdrPrice.textContent = fmt(price);
      if (hdrChange && lastPrice !== null && lastPrice > 0) {
        const pct = ((price - lastPrice) / lastPrice) * 100;
        hdrChange.classList.remove('bull', 'bear', 'neutral');
        hdrChange.classList.add(pct > 0 ? 'bull' : pct < 0 ? 'bear' : 'neutral');
        hdrChange.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%`;
      }
      lastPrice = price;
    } catch (e) {
      console.warn('[header] failed to update price', e);
    }
  };

  // updateHeaderTicker only writes bid/ask/spread — price/change are owned by updateHeaderPrice.
  const updateHeaderTicker = (bid: number, ask: number): void => {
    const hdrBid = document.getElementById('hdr-bid');
    const hdrAsk = document.getElementById('hdr-ask');
    const hdrSpread = document.getElementById('hdr-spread');
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return;
    const mid = (bid + ask) / 2;
    const spread = ask - bid;
    if (hdrBid) hdrBid.textContent = fmt(bid);
    if (hdrAsk) hdrAsk.textContent = fmt(ask);
    if (hdrSpread) hdrSpread.textContent = `${fmt(spread)} (${((spread / mid) * 10_000).toFixed(2)} bps)`;
  };

  const applyState = (state: AppState): void => {
    activeState = state;
    writeHash(state);
    setSymbolLabels(state);
    chart.setSymbol(state.symbol);
    chart.setIntervalMs(parseIntervalMs(state.interval));
    watchlist.setActive(state.provider, state.symbol);
    drawings.setSymbol(state.provider, state.symbol);
    renderIntervals();
    aiBrief.refresh(state.provider, state.symbol, state.interval);
    strategySignals.bind(state.provider, state.symbol, state.interval);
    tearDown();
    ob.reset({ lastUpdateId: 0, bids: [], asks: [], ts: 0 });
    tape.reset();
    sentiment.reset();
    tapeBuys = 0; tapeSells = 0;
    if (tapeBuysEl) tapeBuysEl.textContent = '0';
    if (tapeSellsEl) tapeSellsEl.textContent = '0';
    currentCandles = [];
    chart.clearLastTradePrice();
    lastPrice = null;
    scriptManager.setCandles([]);

    chart.setLoadOlderCallback(async (oldestOpenTime: number) => {
      try {
        const params = new URLSearchParams({
          provider: state.provider, symbol: state.symbol, interval: state.interval,
          endTime: String(oldestOpenTime - 1), limit: '500',
        });
        const res = await fetch(`/api/candles/history?${params.toString()}`);
        if (!res.ok) return;
        const older = await res.json() as Candle[];
        if (!Array.isArray(older) || older.length === 0) return;
        chart.prependHistory(older);
        currentCandles = [...older, ...currentCandles].sort((a, b) => a.openTime - b.openTime);
        scriptManager.setCandles(currentCandles);
      } catch { /* swallow */ }
    });

    unsubs.push(client.streamCandles(
      state.provider, state.symbol, state.interval,
      (history) => {
        currentCandles = history;
        chart.setHistory(history);
        applyIndicators(indicatorPicker.current());
        scriptManager.setCandles(history);
      },
      (upd) => {
        chart.updateCandle(upd.candle);
        updateHeaderPrice(upd.candle.close);
        const last = currentCandles[currentCandles.length - 1];
        if (last && last.openTime === upd.candle.openTime) currentCandles[currentCandles.length - 1] = upd.candle;
        else currentCandles.push(upd.candle);
        if (upd.isFinal) scriptManager.updateCandle(upd.candle, currentCandles);
      },
    ));
    unsubs.push(client.streamDepth(
      state.provider, state.symbol,
      (snap) => {
        ob.reset(snap);
        if (snap) {
          microstructure.updateDepth(snap.bids ?? [], snap.asks ?? []);
        }
      },
      (delta) => {
        ob.applyDelta(delta);
        const fullSnap = ob.getSnapshot();
        microstructure.updateDepth(fullSnap.bids, fullSnap.asks);
      },
    ));
    unsubs.push(client.streamTrades(state.provider, state.symbol, (t) => {
      updateHeaderPrice(t.price);
      tape.push(t);
      sentiment.push(t);
      microstructure.pushTrade(t);
      chart.setLastTradePrice(t.price, t.ts, t.qty);
      chart.updateVolumeProfile(t.price, t.qty);
      chart.renderVolumeProfile();
      if (t.makerSide) tapeSells += 1; else tapeBuys += 1;
      if (tapeBuysEl) tapeBuysEl.textContent = String(tapeBuys);
      if (tapeSellsEl) tapeSellsEl.textContent = String(tapeSells);
    }));

    unsubs.push(client.streamBookTicker(state.provider, state.symbol, (bt) => updateHeaderTicker(bt.bestBidPrice, bt.bestAskPrice)));
    unsubs.push(client.streamAnalytics(state.provider, state.symbol, (data) => {
      chart.updateAnalytics(data);
      chart.renderVolumeProfile();
      // Analytics stream often carries the latest LTP as well; use as fallback.
      updateHeaderPrice(data.ltp);
    }));
    unsubs.push(client.streamAISignals(state.provider, state.symbol, (sig) => {
      chart.applyAISignal(sig);
    }));
    unsubs.push(client.streamAIAnnotation(state.provider, state.symbol, (ann) => {
      chart.applyAIAnnotation(ann);
      if (ann.kind === 'reflex') {
        const data = ann.data as { derived?: { volatilityRegime?: string; toxicity?: number } };
        const reg = data.derived?.volatilityRegime;
        const tox = data.derived?.toxicity;
        microstructure.updateAI(reg, tox);
      }
    }));
  };

  // Global cross-instrument correlation: published to a fixed Redis topic
  // by the AI engine. We expose a tiny REST-less SSE-style listener via the
  // existing WS multiplexer.
  client.streamAIAnnotation('ai', 'GLOBAL', (ann) => {
    if (ann.kind === 'correlation') chart.applyAIAnnotation(ann);
  });

  new GlobalSearch(
    client,
    (ref) => applyState({ provider: ref.provider, symbol: ref.symbol, interval: activeState?.interval ?? '1m' }),
    (ref) => watchlist.add(ref),
  );

  watchlist.onSelect((ref: SymbolRef) => {
    applyState({ provider: ref.provider, symbol: ref.symbol, interval: activeState?.interval ?? '1m' });
  });

  window.addEventListener('hashchange', () => {
    const next = parseHash();
    if (next && (!activeState || next.provider !== activeState.provider || next.symbol !== activeState.symbol || next.interval !== activeState.interval)) {
      applyState(next);
    }
  });

  // Bootstrap
  setSymbolLabels(activeState);
  if (activeState) {
    applyState(activeState);
  } else {
    let bootstrapped = false;
    const tryBootstrap = (): void => {
      if (bootstrapped) return;
      const providers = settings.providers();
      const online = providers.find((p) => p.online);
      if (!online) return;
      bootstrapped = true;
      const defaultSymbol = online.provider.startsWith('binance') ? 'BTCUSDT' : null;
      if (defaultSymbol) {
        applyState({ provider: online.provider, symbol: defaultSymbol, interval: '1m' });
      } else {
        hdrSymbol.textContent = `Press ⌘K to search ${online.displayName}`;
        hdrVenue.textContent = online.provider.toUpperCase();
        renderIntervals();
      }
    };
    void settings.refresh().then(tryBootstrap);
    setInterval(tryBootstrap, 1500);
  }

  renderIntervals();
};

main();
