(() => {
  const STORAGE_KEY = 'dice-tracker-session';
  const VERSION = 1;
  const RECENT_LIMIT = 20;
  const DEFAULT_SETTINGS = Object.freeze({
    mode: 'single',
    dieType: '6',
    dieSides: 6,
    diceCount: 2,
    trackingMode: 'individual',
    customSides: 6,
  });

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    rolls: [],
    pendingValues: [],
    lastRollValues: [],
    chart: null,
    suppressResetConfirm: false,
  };

  const dom = {};

  // ---------- Utilities ----------
  const $ = (id) => document.getElementById(id);

  function generateRollId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clampInt(value, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function safeInt(value, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function rollToLabel(value) {
    return String(value);
  }

  function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function formatPrecise(value, digits = 3) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(digits);
  }

  function dash(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function currentSides(settings = state.settings) {
    if (settings.dieType === 'custom') {
      return clampInt(settings.customSides, 2, 1000000);
    }
    return clampInt(settings.dieSides, 2, 1000000);
  }

  function schemaSnapshot(settings) {
    return {
      mode: settings.mode,
      dieType: settings.dieType,
      dieSides: currentSides(settings),
      diceCount: settings.diceCount,
      trackingMode: settings.trackingMode,
      customSides: settings.customSides,
    };
  }

  function settingsChanged(a, b) {
    return JSON.stringify(schemaSnapshot(a)) !== JSON.stringify(schemaSnapshot(b));
  }

  function activeObservationInfo() {
    const { mode, trackingMode } = state.settings;
    if (mode === 'single') {
      const values = state.rolls.map((r) => r.value).filter((v) => Number.isFinite(v));
      return {
        values,
        label: 'face values',
        chartLabel: 'Face frequency',
        totalLabel: 'rolls',
        domainMin: 1,
        domainMax: currentSides(),
        exploratory: false,
      };
    }

    if (trackingMode === 'individual') {
      const values = state.rolls.flatMap((r) => r.values || []).filter((v) => Number.isFinite(v));
      return {
        values,
        label: 'face values',
        chartLabel: 'Face frequency',
        totalLabel: 'dice results',
        domainMin: 1,
        domainMax: currentSides(),
        exploratory: false,
      };
    }

    const values = state.rolls.map((r) => r.sum).filter((v) => Number.isFinite(v));
    return {
      values,
      label: 'sums',
      chartLabel: 'Sum distribution',
      totalLabel: 'rolls',
      domainMin: state.settings.diceCount,
      domainMax: state.settings.diceCount * currentSides(),
      exploratory: true,
    };
  }

  function frequencies(values) {
    const map = new Map();
    for (const value of values) {
      map.set(value, (map.get(value) || 0) + 1);
    }
    return map;
  }

  function mapToSortedArray(freqMap) {
    return Array.from(freqMap.entries()).sort((a, b) => a[0] - b[0]);
  }

  function topEntries(freqMap, direction = 'desc') {
    const entries = Array.from(freqMap.entries());
    if (!entries.length) return [];
    const sorted = entries.sort((a, b) => {
      if (a[1] !== b[1]) return direction === 'desc' ? b[1] - a[1] : a[1] - b[1];
      return a[0] - b[0];
    });
    const bestCount = sorted[0][1];
    return sorted.filter(([, count]) => count === bestCount).map(([value]) => value).sort((a, b) => a - b);
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function populationStdDev(values) {
    if (!values.length) return null;
    const m = mean(values);
    const variance = values.reduce((acc, value) => acc + ((value - m) ** 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  // Regularized lower incomplete gamma P(a, x)
  function gammaP(a, x) {
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) {
      let ap = a;
      let sum = 1 / a;
      let del = sum;
      for (let n = 1; n <= 1000; n += 1) {
        ap += 1;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    return 1 - gammaQ(a, x);
  }

  // Regularized upper incomplete gamma Q(a, x)
  function gammaQ(a, x) {
    if (x < 0 || a <= 0) return NaN;
    if (x < a + 1) return 1 - gammaP(a, x);
    let b = x + 1 - a;
    let c = 1 / 1e-30;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i <= 1000; i += 1) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1.0) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }

  // Lanczos approximation
  function logGamma(z) {
    const coeffs = [
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];

    if (z < 0.5) {
      return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    }

    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < coeffs.length; i += 1) x += coeffs[i] / (z + i + 1);
    const t = z + coeffs.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function chiSquaredPValue(statistic, degreesOfFreedom) {
    if (!Number.isFinite(statistic) || !Number.isFinite(degreesOfFreedom) || statistic < 0 || degreesOfFreedom <= 0) {
      return null;
    }
    return gammaQ(degreesOfFreedom / 2, statistic / 2);
  }

  function chiLabel(p) {
    if (p === null || Number.isNaN(p)) return '—';
    if (p > 0.05) return 'Looks fair';
    if (p > 0.01) return 'Slightly biased';
    return 'Strongly biased';
  }

  function computeChiSquare(values, domainMin, domainMax) {
    const total = values.length;
    const domainSize = Math.max(0, domainMax - domainMin + 1);
    if (!total || !domainSize) {
      return { statistic: null, df: null, pValue: null, label: '—' };
    }
    const freq = frequencies(values);
    const expected = total / domainSize;
    let statistic = 0;
    for (let face = domainMin; face <= domainMax; face += 1) {
      const observed = freq.get(face) || 0;
      statistic += ((observed - expected) ** 2) / expected;
    }
    const df = domainSize - 1;
    const pValue = chiSquaredPValue(statistic, df);
    return { statistic, df, pValue, label: chiLabel(pValue) };
  }

  function sortedComboKey(values) {
    return [...values].sort((a, b) => a - b).join('+');
  }

  function formatCombo(values) {
    return values.join(', ');
  }

  function buildRollSummary(roll) {
    if (roll.mode === 'single') {
      return `${rollToLabel(roll.value)}`;
    }
    const values = roll.values || [];
    if (roll.trackingMode === 'sum') {
      return `${formatCombo(values)} → ${roll.sum}`;
    }
    return formatCombo(values);
  }

  function rollTitle(roll) {
    if (roll.mode === 'single') return `Single D${roll.dieSides}`;
    const base = `Multi D${roll.dieSides} ×${roll.diceCount}`;
    return roll.trackingMode === 'sum' ? `${base} sum` : `${base} individual`;
  }

  function recentRollMeta(roll) {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(roll.timestamp));
    return `${time} • ${roll.mode === 'single' ? '1 roll' : `${roll.diceCount} dice`}`;
  }

  function createPipLayout(value) {
    const layouts = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    const active = layouts[value] || [];
    const wrap = document.createElement('span');
    wrap.className = 'pips';
    const positions = [
      [1, 1], [1, 2], [1, 3],
      [2, 1], [2, 2], [2, 3],
      [3, 1], [3, 2], [3, 3],
    ];
    for (let i = 0; i < 9; i += 1) {
      const pip = document.createElement('span');
      pip.className = `pip${active.includes(i) ? '' : ' inactive'}`;
      pip.style.gridRow = String(positions[i][0]);
      pip.style.gridColumn = String(positions[i][1]);
      wrap.appendChild(pip);
    }
    return wrap;
  }

  function makeDiceFaceContent(value, sides) {
    const face = document.createElement('span');
    face.className = 'die-face';
    if (sides === 6) {
      face.appendChild(createPipLayout(value));
      const label = document.createElement('span');
      label.className = 'face-caption';
      label.textContent = `D6 ${value}`;
      face.appendChild(label);
      return face;
    }

    const number = document.createElement('span');
    number.className = 'face-number';
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.className = 'face-caption';
    caption.textContent = `D${sides}`;
    face.append(number, caption);
    return face;
  }

  function normalizeSettingsFromForm() {
    const mode = dom.modeMulti.getAttribute('aria-pressed') === 'true' ? 'multi' : 'single';
    const dieType = dom.dieType.value;
    const customSides = clampInt(dom.customSides.value, 2, 1000000);
    const dieSides = dieType === 'custom' ? customSides : clampInt(dieType, 2, 1000000);
    return {
      mode,
      dieType,
      dieSides,
      diceCount: clampInt(dom.diceCount.value, 2, 10),
      trackingMode: dom.trackingSum.getAttribute('aria-pressed') === 'true' ? 'sum' : 'individual',
      customSides,
    };
  }

  function syncFormFromState() {
    const { settings } = state;
    dom.modeSingle.setAttribute('aria-pressed', String(settings.mode === 'single'));
    dom.modeMulti.setAttribute('aria-pressed', String(settings.mode === 'multi'));

    dom.dieType.value = settings.dieType === 'custom' ? 'custom' : String(settings.dieSides);
    dom.customSides.value = String(settings.customSides || settings.dieSides || 6);
    dom.diceCount.value = String(settings.diceCount);
    dom.trackingIndividual.setAttribute('aria-pressed', String(settings.trackingMode === 'individual'));
    dom.trackingSum.setAttribute('aria-pressed', String(settings.trackingMode === 'sum'));

    dom.multiOnly.forEach((el) => el.classList.toggle('hidden', settings.mode !== 'multi'));
    dom.customSidesWrap.classList.toggle('hidden', dom.dieType.value !== 'custom');

    dom.sessionStatus.textContent = settings.mode === 'single'
      ? `Single mode · D${currentSides()}`
      : `Multi mode · D${currentSides()} · ${settings.diceCount} dice · ${settings.trackingMode}`;
  }

  function updateModeUi() {
    syncFormFromState();
    renderMultiStatus();
  }

  function loadSession() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION) return;
      const settings = parsed.settings || {};
      const dieType = settings.dieType === 'custom'
        ? 'custom'
        : (['4', '6', '8', '10', '12', '20'].includes(String(settings.dieType))
          ? String(settings.dieType)
          : (settings.dieSides === 'custom' || !['4', '6', '8', '10', '12', '20'].includes(String(settings.dieSides ?? 6))
            ? 'custom'
            : String(settings.dieSides || 6)));
      const loadedSettings = {
        mode: settings.mode === 'multi' ? 'multi' : 'single',
        dieType: dieType === 'custom' ? 'custom' : String(clampInt(settings.dieSides ?? 6, 2, 1000000)),
        dieSides: settings.dieSides === 'custom' ? 6 : clampInt(settings.dieSides ?? 6, 2, 1000000),
        diceCount: clampInt(settings.diceCount ?? 2, 2, 10),
        trackingMode: settings.trackingMode === 'sum' ? 'sum' : 'individual',
        customSides: clampInt(settings.customSides ?? 6, 2, 1000000),
      };
      if (loadedSettings.dieType === 'custom') loadedSettings.dieSides = loadedSettings.customSides;
      state.settings = loadedSettings;
      state.rolls = Array.isArray(parsed.rolls) ? parsed.rolls.filter(Boolean) : [];
    } catch {
      // Ignore corrupt storage and start fresh.
    }
  }

  function saveSession() {
    const payload = {
      version: VERSION,
      settings: deepClone(state.settings),
      rolls: deepClone(state.rolls),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function resetSession() {
    state.rolls = [];
    state.pendingValues = [];
    state.lastRollValues = [];
    state.settings = { ...DEFAULT_SETTINGS };
    saveSession();
    renderAll();
    announce('Session reset.');
  }

  function attemptSettingsUpdate(nextSettings) {
    const previous = deepClone(state.settings);
    const schemaChanged = settingsChanged(previous, nextSettings);
    if (state.rolls.length && schemaChanged) {
      const ok = window.confirm('Changing roll settings will reset the current session. Continue?');
      if (!ok) {
        syncFormFromState();
        return false;
      }
      state.rolls = [];
    }
    if (schemaChanged) { state.pendingValues = []; state.lastRollValues = []; }
    state.settings = { ...nextSettings };
    saveSession();
    renderAll();
    return true;
  }

  function announce(message) {
    dom.liveRegion.textContent = message;
  }

  function flashButton(value) {
    const btn = dom.diceGrid.querySelector(`button[data-value="${value}"]`);
    if (!btn) return;
    btn.classList.add('flash');
    window.requestAnimationFrame(() => btn.classList.add('pressed'));
    window.setTimeout(() => {
      btn.classList.remove('pressed', 'flash');
    }, 280);
  }

  function recordRoll(roll) {
    state.rolls.push(roll);
    state.pendingValues = [];
    state.lastRollValues = roll.mode === 'single' ? [roll.value] : [...(roll.values || [])];
    saveSession();
    renderAll();
    announce(`Recorded ${rollTitle(roll)}: ${buildRollSummary(roll)}.`);
  }

  function handleFaceTap(value) {
    const sides = currentSides();
    if (!Number.isFinite(value) || value < 1 || value > sides) return;

    // Clear last-roll highlight on first tap of a new roll
    state.lastRollValues = [];

    if (state.settings.mode === 'single') {
      recordRoll({
        id: generateRollId(),
        timestamp: Date.now(),
        mode: 'single',
        dieSides: sides,
        value,
      });
      return;
    }

    state.pendingValues = [...state.pendingValues, value];
    renderMultiStatus();
    renderDiceGrid();
    if (state.pendingValues.length < state.settings.diceCount) {
      announce(`Selected die ${state.pendingValues.length}: ${value}.`);
      return;
    }

    const values = [...state.pendingValues];
    const roll = {
      id: generateRollId(),
      timestamp: Date.now(),
      mode: 'multi',
      dieSides: sides,
      diceCount: state.settings.diceCount,
      trackingMode: state.settings.trackingMode,
      values,
    };
    if (state.settings.trackingMode === 'sum') {
      roll.sum = values.reduce((sum, n) => sum + n, 0);
      roll.comboKey = sortedComboKey(values);
    }
    recordRoll(roll);
  }

  function renderDiceGrid() {
    const sides = currentSides();
    dom.diceGrid.innerHTML = '';
    dom.diceGrid.style.gridTemplateColumns = sides <= 6 ? 'repeat(auto-fit, minmax(96px, 1fr))' : '';
    for (let value = 1; value <= sides; value += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dice-btn';
      btn.dataset.value = String(value);
      btn.setAttribute('aria-label', `Record face ${value}`);
      if (state.pendingValues.includes(value)) btn.classList.add('selected');
      if (state.lastRollValues.includes(value)) {
        // Count how many times value appears up to this index in lastRollValues
        const usedCount = state.lastRollValues.slice(0, state.lastRollValues.indexOf(value) + 1).filter(v => v === value).length;
        const prevCount = Array.from(dom.diceGrid.children).filter(b => b !== btn && b.classList.contains('last-roll') && Number(b.dataset.value) === value).length;
        if (prevCount < usedCount) btn.classList.add('last-roll');
      }
      btn.appendChild(makeDiceFaceContent(value, sides));
      dom.diceGrid.appendChild(btn);
    }
  }

  function renderMultiStatus() {
    if (state.settings.mode === 'single') {
      dom.multiStatus.textContent = `Single mode: tap a face to record.`;
      return;
    }

    const parts = [];
    for (let i = 0; i < state.settings.diceCount; i += 1) {
      const value = state.pendingValues[i];
      parts.push(`Die ${i + 1}: ${value ? `✓${value}` : '?'}`);
    }
    dom.multiStatus.textContent = state.settings.trackingMode === 'sum'
      ? `${parts.join(', ')} · Sum records after the last die.`
      : `${parts.join(', ')} · Rolls record after the last die.`;
  }

  function statCard(label, value, subtext = '') {
    const card = document.createElement('article');
    card.className = 'stat-card';

    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = value;

    card.append(labelEl, valueEl);
    if (subtext) {
      const sub = document.createElement('div');
      sub.className = 'stat-subtext';
      sub.textContent = subtext;
      card.appendChild(sub);
    }
    return card;
  }

  function computeFairnessScore(chiResult, totalObservations, domainSize) {
    if (!totalObservations || !domainSize || chiResult.statistic === null) return null;
    if (totalObservations < 2) return 100;
    // Normalise: worst-case chi² is roughly totalObs * (1 - 1/domainSize)
    // Scale so that chi² ≈ df (expected for fair) → ~100%, and it decays smoothly
    const df = domainSize - 1;
    const worstCase = totalObservations * (1 - 1 / domainSize);
    const score = Math.max(0, Math.min(100, 100 * (1 - chiResult.statistic / worstCase)));
    return Math.round(score);
  }

  function fairnessLabel(score) {
    if (score === null) return '';
    if (score >= 90) return 'Excellent — very uniform';
    if (score >= 75) return 'Good — fairly uniform';
    if (score >= 50) return 'Fair — some deviation';
    if (score >= 25) return 'Poor — clearly biased';
    return 'Very poor — heavily skewed';
  }

  function renderStats() {
    const info = activeObservationInfo();
    const values = info.values;
    const totalRolls = state.rolls.length;
    const freq = frequencies(values);
    const sortedFreq = mapToSortedArray(freq);
    const totalObservations = values.length;
    const most = topEntries(freq, 'desc');
    const least = topEntries(freq, 'asc');
    const meanValue = mean(values);
    const medianValue = median(values);
    const stdDev = populationStdDev(values);
    const chi = computeChiSquare(values, info.domainMin, info.domainMax);
    const domainSize = info.domainMax - info.domainMin + 1;
    const fairness = computeFairnessScore(chi, totalObservations, domainSize);

    const mostText = most.length ? `${most.map(rollToLabel).join(', ')} (${freq.get(most[0])})` : '—';
    const leastText = least.length ? `${least.map(rollToLabel).join(', ')} (${freq.get(least[0])})` : '—';

    const cards = [
      statCard('Total rolls', values.length ? String(totalRolls) : '—', values.length ? `${totalObservations} ${info.totalLabel}` : 'No rolls yet'),
      statCard('Fairness', fairness !== null ? `${fairness}%` : '—', fairness !== null ? fairnessLabel(fairness) : 'No rolls yet'),
      statCard('Most common', mostText, values.length ? `Across ${info.label}` : 'No rolls yet'),
      statCard('Least common', leastText, values.length ? `Across ${info.label}` : 'No rolls yet'),
      statCard('Mean', values.length ? formatPrecise(meanValue) : '—', values.length ? `Population mean` : 'No rolls yet'),
      statCard('Median', values.length ? formatPrecise(medianValue) : '—', values.length ? `Middle value` : 'No rolls yet'),
      statCard('Std dev', values.length ? formatPrecise(stdDev) : '—', values.length ? 'Population standard deviation' : 'No rolls yet'),
      statCard('Chi-squared', chi.statistic === null ? '—' : formatPrecise(chi.statistic), chi.statistic === null ? 'No rolls yet' : `df ${chi.df} · ${chi.label}${info.exploratory ? ' · exploratory on sums' : ''}`),
    ];

    if (state.settings.mode === 'multi' && state.settings.trackingMode === 'sum') {
      const comboFreq = frequencies(state.rolls.map((roll) => roll.comboKey).filter(Boolean));
      const comboMost = topEntries(comboFreq, 'desc');
      const comboLeast = topEntries(comboFreq, 'asc');
      cards.push(statCard('Most common combo', comboMost.length ? `${comboMost.join(', ')} (${comboFreq.get(comboMost[0])})` : '—', 'Sorted combo key'));
      cards.push(statCard('Least common combo', comboLeast.length ? `${comboLeast.join(', ')} (${comboFreq.get(comboLeast[0])})` : '—', 'Sorted combo key'));
    }

    dom.statsGrid.innerHTML = '';
    cards.forEach((card) => dom.statsGrid.appendChild(card));
  }

  function chartDataset() {
    const info = activeObservationInfo();
    const values = info.values;
    const freq = frequencies(values);
    const labels = [];
    const data = [];
    for (let value = info.domainMin; value <= info.domainMax; value += 1) {
      labels.push(String(value));
      data.push(freq.get(value) || 0);
    }
    return { labels, data, total: values.length, info };
  }

  function ensureChart() {
    if (!window.Chart) return null;
    if (state.chart) return state.chart;
    const ctx = dom.chartCanvas.getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Frequency',
            data: [],
            borderWidth: 1,
            borderColor: 'rgba(41, 199, 199, 0.9)',
            backgroundColor: 'rgba(41, 199, 199, 0.42)',
            hoverBackgroundColor: 'rgba(77, 163, 255, 0.58)',
            borderRadius: 8,
            order: 2,
          },
          {
            label: 'Expected (fair die)',
            type: 'line',
            data: [],
            borderColor: 'rgba(255, 210, 80, 0.7)',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHitRadius: 0,
            fill: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 180 },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: '#9fb0c3',
              boxWidth: 16,
              boxHeight: 2,
              padding: 12,
              font: { size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const total = context.chart.$totalObservations || 0;
                const count = context.parsed.y || 0;
                const pct = total ? (count / total) * 100 : 0;
                return ` ${context.dataset.label}: ${count}${context.datasetIndex === 0 ? ` (${pct.toFixed(1)}%)` : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(148, 163, 184, 0.08)' },
            ticks: { color: '#9fb0c3' },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
            ticks: { color: '#9fb0c3', precision: 0 },
          },
        },
      },
    });
    return state.chart;
  }

  function renderChart() {
    const chart = ensureChart();
    const { labels, data, total, info } = chartDataset();
    dom.chartSubtitle.textContent = info.chartLabel;
    if (!chart) {
      dom.chartEmpty.classList.remove('hidden');
      dom.chartEmpty.textContent = 'Chart.js did not load.';
      return;
    }
    dom.chartEmpty.classList.toggle('hidden', total > 0);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = info.chartLabel;
    // Expected frequency line: flat line at total / numberOfBuckets
    const expectedPerFace = total / labels.length;
    chart.data.datasets[1].data = labels.map(() => expectedPerFace);
    chart.$totalObservations = total;
    chart.update();
  }

  function renderRecentRolls() {
    dom.recentRolls.innerHTML = '';
    const recent = [...state.rolls].slice(-RECENT_LIMIT).reverse();
    if (!recent.length) {
      const empty = document.createElement('li');
      empty.className = 'recent-roll-item';
      empty.innerHTML = '<div class="recent-main"><div class="recent-title">No rolls yet</div><div class="recent-meta">Tap a die face to start.</div></div><div class="recent-value">—</div>';
      dom.recentRolls.appendChild(empty);
      return;
    }

    for (const roll of recent) {
      const item = document.createElement('li');
      item.className = 'recent-roll-item';
      const main = document.createElement('div');
      main.className = 'recent-main';
      const title = document.createElement('div');
      title.className = 'recent-title';
      title.textContent = rollTitle(roll);
      const meta = document.createElement('div');
      meta.className = 'recent-meta';
      meta.textContent = recentRollMeta(roll);
      main.append(title, meta);
      const value = document.createElement('div');
      value.className = 'recent-value';
      value.textContent = buildRollSummary(roll);
      item.append(main, value);
      dom.recentRolls.appendChild(item);
    }
  }

  function renderAll() {
    syncFormFromState();
    renderMultiStatus();
    renderDiceGrid();
    renderStats();
    renderChart();
    renderRecentRolls();
    dom.diceError.classList.add('hidden');
    dom.diceError.textContent = '';
  }

  function buildDiceCountOptions() {
    dom.diceCount.innerHTML = '';
    for (let i = 2; i <= 10; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `${i} dice`;
      dom.diceCount.appendChild(option);
    }
  }

  function bindEvents() {
    dom.modeSingle.addEventListener('click', () => {
      const next = normalizeSettingsFromForm();
      next.mode = 'single';
      attemptSettingsUpdate(next);
    });

    dom.modeMulti.addEventListener('click', () => {
      const next = normalizeSettingsFromForm();
      next.mode = 'multi';
      attemptSettingsUpdate(next);
    });

    dom.trackingIndividual.addEventListener('click', () => {
      const next = normalizeSettingsFromForm();
      next.trackingMode = 'individual';
      attemptSettingsUpdate(next);
    });

    dom.trackingSum.addEventListener('click', () => {
      const next = normalizeSettingsFromForm();
      next.trackingMode = 'sum';
      attemptSettingsUpdate(next);
    });

    dom.dieType.addEventListener('change', () => {
      const next = normalizeSettingsFromForm();
      if (dom.dieType.value === 'custom') {
        next.dieType = 'custom';
        next.dieSides = clampInt(dom.customSides.value, 2, 1000000);
      } else {
        next.dieType = dom.dieType.value;
        next.dieSides = clampInt(dom.dieType.value, 2, 1000000);
      }
      attemptSettingsUpdate(next);
    });

    dom.customSides.addEventListener('change', () => {
      const next = normalizeSettingsFromForm();
      next.dieType = 'custom';
      next.dieSides = clampInt(dom.customSides.value, 2, 1000000);
      if (dom.dieType.value === 'custom') attemptSettingsUpdate(next);
    });

    dom.diceCount.addEventListener('change', () => {
      const next = normalizeSettingsFromForm();
      attemptSettingsUpdate(next);
    });

    dom.diceGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      const value = Number.parseInt(button.dataset.value, 10);
      handleFaceTap(value);
    });

    dom.resetBtn.addEventListener('click', () => {
      if (!state.rolls.length) {
        resetSession();
        return;
      }
      const ok = window.confirm('Reset this session and clear saved rolls?');
      if (ok) resetSession();
    });

    // Stats help modal
    dom.statsHelpBtn = $('stats-help-btn');
    dom.statsHelpModal = $('stats-help-modal');
    dom.statsHelpClose = $('stats-help-close');

    dom.statsHelpBtn.addEventListener('click', () => {
      dom.statsHelpModal.classList.remove('hidden');
      dom.statsHelpClose.focus();
    });

    dom.statsHelpClose.addEventListener('click', () => {
      dom.statsHelpModal.classList.add('hidden');
      dom.statsHelpBtn.focus();
    });

    dom.statsHelpModal.addEventListener('click', (e) => {
      if (e.target === dom.statsHelpModal) {
        dom.statsHelpModal.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.statsHelpModal.classList.contains('hidden')) {
        dom.statsHelpModal.classList.add('hidden');
        dom.statsHelpBtn.focus();
      }
    });
  }

  function validateLoadedState() {
    if (state.settings.dieType !== 'custom' && !['4', '6', '8', '10', '12', '20'].includes(String(state.settings.dieType))) {
      state.settings.dieType = String(state.settings.dieSides || 6);
    }
    if (!Number.isFinite(state.settings.dieSides) || state.settings.dieSides < 2) state.settings.dieSides = 6;
    if (!Number.isFinite(state.settings.diceCount) || state.settings.diceCount < 2) state.settings.diceCount = 2;
    if (state.settings.mode !== 'single' && state.settings.mode !== 'multi') state.settings.mode = 'single';
    if (state.settings.trackingMode !== 'sum' && state.settings.trackingMode !== 'individual') state.settings.trackingMode = 'individual';
    if (!Number.isFinite(state.settings.customSides) || state.settings.customSides < 2) state.settings.customSides = 6;
  }

  function bootstrap() {
    dom.sessionStatus = $('session-status');
    dom.resetBtn = $('reset-btn');
    dom.modeSingle = $('mode-single');
    dom.modeMulti = $('mode-multi');
    dom.dieType = $('die-type');
    dom.customSidesWrap = $('custom-sides-wrap');
    dom.customSides = $('custom-sides');
    dom.diceCountWrap = $('dice-count-wrap');
    dom.diceCount = $('dice-count');
    dom.trackingModeWrap = $('tracking-mode-wrap');
    dom.trackingIndividual = $('tracking-individual');
    dom.trackingSum = $('tracking-sum');
    dom.multiOnly = [dom.diceCountWrap, dom.trackingModeWrap];
    dom.multiStatus = $('multi-status');
    dom.diceGrid = $('dice-grid');
    dom.diceError = $('dice-error');
    dom.statsGrid = $('stats-grid');
    dom.chartCanvas = $('distribution-chart');
    dom.chartSubtitle = $('chart-subtitle');
    dom.chartEmpty = $('chart-empty');
    dom.recentRolls = $('recent-rolls');
    dom.liveRegion = $('live-region');

    buildDiceCountOptions();
    loadSession();
    validateLoadedState();
    syncFormFromState();
    bindEvents();
    renderAll();
    announce('Dice tracker ready.');
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
