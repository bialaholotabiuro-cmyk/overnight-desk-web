(function (global) {
  'use strict';

  const REDUCED_MOTION = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setupCanvas(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(rect.width || 358));
    const h = Math.max(120, Math.round(rect.height || 190));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  let _lastPointCount = 0;

  function drawBalanceChart(canvas, chartData, nightStart) {
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const pts = (chartData && Array.isArray(chartData.points)) ? chartData.points : [];
    const marks = (chartData && Array.isArray(chartData.marks)) ? chartData.marks : [];

    if (!pts.length) {
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(235,235,245,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.6);
      ctx.lineTo(w, h * 0.6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,235,245,0.45)';
      ctx.font = '500 13px -apple-system, system-ui, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for the first trade', w / 2, h * 0.45);
      ctx.restore();
      _lastPointCount = 0;
      return;
    }

    const padTop = 44;
    const padBot = 14;
    const padX = 4;
    const vals = pts.map((p) => Number(p.value));
    if (nightStart != null && Number.isFinite(Number(nightStart))) {
      vals.push(Number(nightStart));
    }
    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    if (maxV - minV < 1e-6) {
      minV -= 1;
      maxV += 1;
    }
    const minT = pts[0].ts;
    const maxT = pts[pts.length - 1].ts === minT ? minT + 60 : pts[pts.length - 1].ts;

    const xOf = (t) => padX + ((t - minT) / (maxT - minT)) * (w - padX * 2);
    const yOf = (v) => padTop + (1 - (v - minV) / (maxV - minV)) * (h - padTop - padBot);

    const animateNew = pts.length > _lastPointCount && _lastPointCount > 0 && !REDUCED_MOTION();
    _lastPointCount = pts.length;

    const renderFrame = (progress) => {
      ctx.clearRect(0, 0, w, h);

      // Dashed start line
      if (nightStart != null && Number.isFinite(Number(nightStart))) {
        const sy = yOf(Number(nightStart));
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(235,235,245,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
        ctx.restore();
      }

      const coords = pts.map((p, i) => {
        if (animateNew && i === pts.length - 1 && pts.length >= 2) {
          const prev = pts[i - 1];
          const px = xOf(prev.ts) + (xOf(p.ts) - xOf(prev.ts)) * progress;
          const py = yOf(prev.value) + (yOf(p.value) - yOf(prev.value)) * progress;
          return { x: px, y: py };
        }
        return { x: xOf(p.ts), y: yOf(p.value) };
      });

      // Area gradient under line
      const grad = ctx.createLinearGradient(0, padTop, 0, h);
      grad.addColorStop(0, 'rgba(0, 211, 90, 0.24)');
      grad.addColorStop(1, 'rgba(0, 211, 90, 0.0)');
      ctx.beginPath();
      ctx.moveTo(coords[0].x, h - padBot);
      coords.forEach((c) => ctx.lineTo(c.x, c.y));
      ctx.lineTo(coords[coords.length - 1].x, h - padBot);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Main green line
      ctx.beginPath();
      coords.forEach((c, idx) => (idx === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.strokeStyle = '#00d35a';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Marks above the line — step up a row if overlapping
      ctx.font = '600 11px ui-monospace, "SF Mono", "Roboto Mono", monospace';
      const placed = []; // {x1, x2, row}
      marks.forEach((m) => {
        if (m.kind !== 'bought' && m.kind !== 'sold' && m.kind !== 'stopped') return;
        const mx = Math.max(32, Math.min(w - 32, xOf(m.ts || maxT)));
        let label = m.title || '';
        let color = '#64d2ff';
        if (m.kind === 'bought') {
          label = label || 'Bought';
          color = '#64d2ff';
        } else if (m.kind === 'sold') {
          const val = m.value != null ? `+$${Math.abs(Number(m.value)).toFixed(0)}` : '+$';
          label = label || val;
          color = '#00d35a';
        } else if (m.kind === 'stopped') {
          const val = m.value != null ? `-$${Math.abs(Number(m.value)).toFixed(0)}` : '-25%';
          label = label || `-25% · ${val}`;
          color = '#ff453a';
        }
        const tw = ctx.measureText(label).width + 12;
        const x1 = mx - tw / 2;
        const x2 = mx + tw / 2;
        let row = 0;
        while (placed.some((p) => p.row === row && !(x2 < p.x1 - 4 || x1 > p.x2 + 4))) {
          row += 1;
        }
        placed.push({ x1, x2, row });
        const ly = Math.max(12, 34 - row * 16);

        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(label, mx, ly);

        ctx.beginPath();
        ctx.arc(mx, yOf(pts[pts.length - 1].value), 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    };

    if (animateNew) {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 250);
        renderFrame(t);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      renderFrame(1);
    }
  }

  function drawCoinCandles(canvas, candles, exitPrice) {
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const list = Array.isArray(candles) ? candles : [];
    if (!list.length) {
      ctx.fillStyle = 'rgba(235,235,245,0.45)';
      ctx.font = '500 13px -apple-system, system-ui, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Brak świec cenowych w db.prices', w / 2, h / 2);
      return;
    }
    const prices = list.map((c) => Number(c.price)).filter((n) => Number.isFinite(n));
    if (exitPrice != null && Number.isFinite(Number(exitPrice))) prices.push(Number(exitPrice));
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    if (maxP - minP < 1e-12) {
      minP *= 0.95;
      maxP *= 1.05;
    }
    const padY = 18;
    const yOf = (p) => padY + (1 - (p - minP) / (maxP - minP)) * (h - padY * 2);

    // Orange dashed exit line
    if (exitPrice != null && Number.isFinite(Number(exitPrice))) {
      const ey = yOf(Number(exitPrice));
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ff9f0a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, ey);
      ctx.lineTo(w, ey);
      ctx.stroke();
      ctx.restore();
    }

    const stepW = w / Math.max(list.length, 1);
    const barW = Math.max(3, Math.min(10, stepW * 0.65));
    list.forEach((c, i) => {
      const p = Number(c.price);
      const prev = i > 0 ? Number(list[i - 1].price) : p;
      const up = p >= prev;
      const x = i * stepW + stepW / 2;
      const y1 = yOf(prev);
      const y2 = yOf(p);
      const top = Math.min(y1, y2);
      const bodyH = Math.max(3, Math.abs(y2 - y1));
      ctx.fillStyle = up ? '#00d35a' : '#ff453a';
      ctx.fillRect(x - barW / 2, top, barW, bodyH);
    });
  }

  global.DeskCharts = { drawBalanceChart, drawCoinCandles };
})(window);
