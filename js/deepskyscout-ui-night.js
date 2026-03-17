/* js/deepskyscout-ui-night.js */
/* DeepSkyScout planner UI: tonight and monthly chart drawing */

  // -----------------------------
  // Chart drawing (Tonight)
  // -----------------------------
  function prepareCanvas(canvas, minCssH) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;

    // On desktop we set canvas height via CSS (var(--viewerH)), so respect it.
    const desktop = isDesktopWide();
    let cssH = rect.height;

    // Fallback: if height isn't meaningful (mobile or not yet laid out), use old logic.
    if (!desktop || !(cssH > 80)) {
      const isPhone = isMobileNarrow();
      const isLandscape = window.matchMedia("(orientation: landscape)").matches;

      let maxH = 9999;
      if (isPhone && !isLandscape) maxH = Math.min(280, Math.floor(window.innerHeight * 0.34));
      if (isPhone && isLandscape)  maxH = Math.min(260, Math.floor(window.innerHeight * 0.68));

      const desired = Math.floor(cssW);
      cssH = Math.min(
        maxH,
        Math.max(isPhone ? 220 : minCssH, Math.min(desired, minCssH))
      );

      canvas.style.height = cssH + "px"; // only set inline on mobile fallback
    } else {
      cssH = Math.floor(cssH);
    }

    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  }

  function projectAltAz(altDeg, azDeg, cx, cy, radiusMax) {
    const z = 90 - altDeg;
    const r = (z / 90) * radiusMax;
    const a = azDeg * RAD;
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
  }

  function sunAltitudeDegAtMs(msUtc, loc) {
    if (!loc) return -90;
    const dt = new Date(msUtc);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const utcMinutes = dt.getUTCHours() * 60 + dt.getUTCMinutes() + (dt.getUTCSeconds() / 60) + (dt.getUTCMilliseconds() / 60000);
    const latDeg = Number(loc.latitude);
    const lonDeg = Number(loc.longitude);
    const lat = latDeg * RAD;
    const { decl, eqTimeMin } = sunParamsForDate(y, m, d);

    let trueSolarTimeMin = utcMinutes + eqTimeMin + (4 * lonDeg);
    trueSolarTimeMin = ((trueSolarTimeMin % 1440) + 1440) % 1440;

    let hourAngleDeg = (trueSolarTimeMin / 4) - 180;
    if (hourAngleDeg < -180) hourAngleDeg += 360;
    const ha = hourAngleDeg * RAD;

    const sinAlt = (Math.sin(lat) * Math.sin(decl)) + (Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
    return Math.asin(clamp(sinAlt, -1, 1)) * DEG;
  }

  function getSkyPhaseAtMs(msUtc, loc) {
    const sunAltDeg = sunAltitudeDegAtMs(msUtc, loc);
    if (sunAltDeg >= -0.833) {
      return { key: "day", label: "Day", color: "rgba(255,200,90,0.78)", sunAltDeg };
    }
    if (sunAltDeg >= -6) {
      return { key: "civil", label: "Civil twilight", color: "rgba(255,154,92,0.84)", sunAltDeg };
    }
    if (sunAltDeg >= -12) {
      return { key: "nautical", label: "Nautical twilight", color: "rgba(170,120,255,0.88)", sunAltDeg };
    }
    if (sunAltDeg >= -18) {
      return { key: "astronomical", label: "Astronomical twilight", color: "rgba(92,145,255,0.92)", sunAltDeg };
    }
    return { key: "night", label: "Astronomical night", color: "rgba(40,110,255,0.98)", sunAltDeg };
  }

  function drawAltAzGrid(ctx, cx, cy, radiusMax) {
    ctx.save();

    ctx.strokeStyle = chartVar("--chart-grid", "rgba(255,255,255,0.16)");
    ctx.lineWidth = 2.2;
    ctx.setLineDash([7, 7]);
    for (let alt = 15; alt <= 75; alt += 15) {
      const r = ((90-alt)/90) * radiusMax;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.stroke();
    }

    ctx.lineWidth = 2.0;
    ctx.setLineDash([6, 9]);
    for (let az = 0; az < 360; az += 45) {
      if (az === 0 || az === 90 || az === 180 || az === 270) continue;
      const edge = projectAltAz(0, az, cx, cy, radiusMax);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(edge.x, edge.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = chartVar("--chart-text-muted", "rgba(255,255,255,0.82)");
    ctx.font = "15px ui-sans-serif, system-ui";

    for (let alt = 15; alt <= 75; alt += 15) {
      const r = ((90-alt)/90) * radiusMax;
      ctx.fillText(`${alt}°`, cx + 8, cy - r - 8);
    }

    const labelR = radiusMax + 22;
    for (let az = 0; az < 360; az += 45) {
      if (az === 0 || az === 90 || az === 180 || az === 270) continue;
      const a = az * RAD;
      const x = cx + labelR * Math.sin(a);
      const y = cy - labelR * Math.cos(a);
      ctx.fillText(String(az), x - 10, y + 5);
    }

    ctx.restore();
  }

  function drawEquatorialGrid(ctx, cx, cy, radiusMax, loc){
    // Projected RA/Dec grid at a reference time (use "now" clamped to the night window)
    const latDeg = Number(loc.latitude);
    const lonDeg = Number(loc.longitude);

    const now = Date.now();
    const start = NIGHT_WINDOW?.startUtc?.getTime?.() ?? now;
    const end = NIGHT_WINDOW?.endUtc?.getTime?.() ?? now;
    const refMs = (now < start) ? start : (now > end ? end : now);
    const refDate = new Date(refMs);

    ctx.save();

    // Clip to the sky circle so below-horizon parts don't spill outside
    ctx.beginPath();
    ctx.arc(cx, cy, radiusMax, 0, Math.PI*2);
    ctx.clip();

    ctx.strokeStyle = chartVar("--chart-grid", "rgba(255,255,255,0.16)");
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 7]);

    // Declination curves (degrees)
    const decLines = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
    const raStep = 3; // deg

    for (const decDeg of decLines) {
      let first = true;
      ctx.beginPath();
      for (let raDeg = 0; raDeg <= 360; raDeg += raStep) {
        const aa = raDecToAltAz(refDate, raDeg % 360, decDeg, latDeg, lonDeg);
        if (aa.altDeg <= 0) { first = true; continue; }
        const p = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Right Ascension curves (hours)
    const raLines = [];
    for (let h = 0; h < 24; h += 2) raLines.push(h * 15);

    const decStep = 3; // deg
    ctx.setLineDash([6, 9]);

    for (const raDeg0 of raLines) {
      let first = true;
      ctx.beginPath();
      for (let decDeg = -75; decDeg <= 75; decDeg += decStep) {
        const aa = raDecToAltAz(refDate, raDeg0, decDeg, latDeg, lonDeg);
        if (aa.altDeg <= 0) { first = true; continue; }
        const p = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Labels (simple declination labels near the top of the chart where visible)
    ctx.setLineDash([]);
    ctx.fillStyle = chartVar("--chart-text-muted", "rgba(255,255,255,0.82)");
    ctx.font = "14px ui-sans-serif, system-ui";

    for (const decDeg of [-60, -30, 0, 30, 60]) {
      // Sample at RA = LST so it's near the meridian (often highest/most visible)
      const jd = jdFromDate(refDate);
      const lstDeg = clamp360(gmstDeg(jd) + lonDeg);
      const aa = raDecToAltAz(refDate, lstDeg, decDeg, latDeg, lonDeg);
      if (aa.altDeg <= 5) continue;
      const p = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);
      ctx.fillText(`${decDeg}°`, p.x + 6, p.y - 6);
    }

    ctx.restore();
  }

  function drawCustomHorizon(ctx, cx, cy, radiusMax, horizonAtAzFn) {
    ctx.save();
    ctx.strokeStyle = "rgba(160,200,140,0.98)";
    ctx.lineWidth = 3.0;
    ctx.setLineDash([]);
    ctx.beginPath();

    let first = true;
    for (let az = 0; az <= 360; az += 2) {
      const alt = horizonAtAzFn(az);
      const p = projectAltAz(alt, az, cx, cy, radiusMax);
      if (first) { ctx.moveTo(p.x, p.y); first = false; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawNumericHorizonCircle(ctx, cx, cy, radiusMax, horizonDeg) {
    const rH = ((90 - horizonDeg)/90) * radiusMax;
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = "rgba(160,200,140,0.92)";
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(cx, cy, rH, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Simple moon phase icon using two circles:
  // - draw a white disk
  // - clip to that disk
  // - draw a black disk offset by illumination fraction
  // This shows the shadowed portion as the overlap of the black disk.
  function drawMoonPhaseIconOnCanvas(ctx, x, y, r, phase) {
    if (!phase || !Number.isFinite(phase.illumFrac)) return;
    const f = clamp(Number(phase.illumFrac), 0, 1);
    const waxing = !!phase.waxing;

    // Base (lit) disk
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = chartVar("--chart-moon-lit", "rgba(255,255,255,0.92)");
    ctx.fill();

    // Clip to the base disk so only the overlap is visible
    ctx.clip();

    // Shadow disk: at new moon (f=0) it's centered => fully dark.
    // At full moon (f=1) it's shifted by ~2r => no overlap => fully lit.
    const eps = 0.6;
    const d = f * 2 * r + eps;
    const sign = waxing ? -1 : 1; // UK: waxing lit on right, waning lit on left
    ctx.beginPath();
    ctx.arc(x + sign * d, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.fill();
    ctx.restore();

    // Outline
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.strokeStyle = chartVar("--chart-icon-stroke", "rgba(255,255,255,0.55)");
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function drawNightLegend(ctx, w, h) {
    const entries = [
      { type: "ring",  color: "rgba(255,80,80,0.95)", label: "Current object location" },
      { type: "line",  color: "rgba(255,200,90,0.78)", label: "Day path" },
      { type: "line",  color: "rgba(255,154,92,0.84)", label: "Civil twilight" },
      { type: "line",  color: "rgba(170,120,255,0.88)", label: "Nautical twilight" },
      { type: "line",  color: "rgba(92,145,255,0.92)", label: "Astronomical twilight" },
      { type: "line",  color: "rgba(40,110,255,0.98)", label: "Astronomical night" },
      { type: "dash",  color: "rgba(80,220,140,0.95)", label: "Horizon" },
      { type: "line",  color: "#e6e6e6", label: "Moon" },
      { type: "dot",   color: "rgba(255,215,0,0.95)", text: "SS", label: "Sunset / Sunrise" },
      { type: "dot",   color: "rgba(220,80,220,0.95)", text: "M", label: "Meridian" },
    ];

    ctx.save();
    const fontPx = Math.max(11, Math.min(13, Math.round(Math.min(w, h) * 0.022)));
    const lineH = fontPx + 6;
    const boxPadX = 10;
    const boxPadY = 8;
    const swatchW = 24;
    const gap = 10;
    ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let maxTextW = 0;
    for (const e of entries) maxTextW = Math.max(maxTextW, ctx.measureText(e.label).width);
    const boxW = Math.ceil(boxPadX * 2 + swatchW + gap + maxTextW);
    const boxH = Math.ceil(boxPadY * 2 + entries.length * lineH - 6);

    const x = 14;
    const y = h - boxH - 14;
    const textCol = chartVar('--chart-text', 'rgba(255,255,255,0.88)');

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

    entries.forEach((e, i) => {
      const yy = y + boxPadY + i * lineH + lineH / 2 - 2;
      const sx = x + boxPadX;
      const ex = sx + swatchW;

      ctx.save();
      if (e.type === 'line') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(sx, yy);
        ctx.lineTo(ex, yy);
        ctx.stroke();
      } else if (e.type === 'dash') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(sx, yy);
        ctx.lineTo(ex, yy);
        ctx.stroke();
      } else if (e.type === 'ring') {
        const cx = sx + swatchW / 2;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cx, yy, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'dot') {
        const cx = sx + swatchW / 2;
        ctx.fillStyle = e.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.70)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, yy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        ctx.font = `${Math.max(10, fontPx - 1)}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(e.text || '', cx, yy + 0.5);
        ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'left';
      }
      ctx.restore();

      ctx.fillStyle = textCol;
      ctx.fillText(e.label, ex + gap, yy);
    });
    ctx.restore();
  }

  function drawNightChart() {
    if (viewMode !== "night") return;

    const canvas = $("skyCanvas");
    const loc = getSelected($("locationSelect"), LOCATIONS);
    const horizonAtAzFn = getHorizonAtAzFn();

    if (!canvas || !loc || selectedObjectIdx == null || !OBJECTS[selectedObjectIdx] || !NIGHT_WINDOW) return;

    const obj = OBJECTS[selectedObjectIdx];
    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) return;

    enforceMobileAltAz();

    const { ctx, w, h } = prepareCanvas(canvas, 380);
    NIGHT_PATH_SEGMENTS = [];
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(0, 0, w, h);

    const cx = w/2;
    const cy = h/2;
    const radiusMax = 0.46 * Math.min(w, h);

    ctx.strokeStyle = chartVar("--chart-ring", "rgba(255,255,255,0.28)");
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusMax, 0, Math.PI*2);
    ctx.stroke();

    ctx.fillStyle = chartVar("--chart-text", "rgba(255,255,255,0.86)");
    ctx.font = "16px ui-sans-serif, system-ui";
    const pad = 12;
    ctx.fillText("N", cx - 6, cy - radiusMax - pad);
    ctx.fillText("S", cx - 6, cy + radiusMax + pad + 16);
    ctx.fillText("E", cx + radiusMax + pad, cy + 6);
    ctx.fillText("W", cx - radiusMax - pad - 14, cy + 6);

    // Grid
    const gridMode = getGridMode();
    if (gridMode === "equ") drawEquatorialGrid(ctx, cx, cy, radiusMax, loc);
    else drawAltAzGrid(ctx, cx, cy, radiusMax);

    // Horizon visualisation
    if (HORIZON_MODE === "custom" && HORIZON_PROFILE) drawCustomHorizon(ctx, cx, cy, radiusMax, horizonAtAzFn);
    else drawNumericHorizonCircle(ctx, cx, cy, radiusMax, getHorizonFloorDeg());

    let moonPhaseForIcon = null;


    // Moon track (always show, for context + separation)
    {
      const sunsetMs = NIGHT_WINDOW.startUtc.getTime();
      const sunriseMs = NIGHT_WINDOW.endUtc.getTime();

      let trackStart = sunsetMs;
      let trackEnd = sunriseMs;
      const minSpan = 24*3600000;
      const span = trackEnd - trackStart;

      if (span < minSpan) {
        const extra = Math.floor((minSpan - span) / 2);
        trackStart -= extra;
        trackEnd += extra;
      }

      const stepMsMoon = Math.max(1, VIS_STEP_MIN) * 60 * 1000;
      const moonTrack = getMoonTrackForWindow(loc, trackStart, trackEnd, stepMsMoon);
      moonPhaseForIcon = moonTrack.phase;

      // Draw dashed path above horizon
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = 2.2;

      function strokeMoonSeg(p0, p1){
        const a0 = projectAltAz(p0.altDeg, p0.azDeg, cx, cy, radiusMax);
        const a1 = projectAltAz(p1.altDeg, p1.azDeg, cx, cy, radiusMax);
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        ctx.stroke();
      }

      for (let i = 1; i < moonTrack.pts.length; i++) {
        const A = moonTrack.pts[i-1];
        const B = moonTrack.pts[i];
        const midT = (A.t + B.t) / 2;
        const mid = { altDeg: (A.altDeg + B.altDeg) / 2, azDeg: (A.azDeg + B.azDeg) / 2 };
        if (mid.altDeg < 0) continue;

        const day = isDayMs(midT);
        ctx.strokeStyle = "#e6e6e6";
        strokeMoonSeg(A, B);
      }

      // Current position marker
      {
        const now = Date.now();
        const mm = moonRaDecFromUtcDate(new Date(now));
        const latDegMoon = Number(loc.latitude);
        const lonDegMoon = Number(loc.longitude);
        const aa = raDecToAltAz(new Date(now), mm.raDeg, mm.decDeg, latDegMoon, lonDegMoon);
        if (aa.altDeg >= 0) {
          const xy = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(250,250,250,0.95)";
          ctx.beginPath();
          ctx.arc(xy.x, xy.y, 5.5, 0, Math.PI*2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    const sunsetMs = NIGHT_WINDOW.startUtc.getTime();
    const sunriseMs = NIGHT_WINDOW.endUtc.getTime();

    let trackStart = sunsetMs;
    let trackEnd = sunriseMs;
    const minSpan = 24*3600000;
    const span = trackEnd - trackStart;

    if (span < minSpan) {
      const extra = Math.floor((minSpan - span) / 2);
      trackStart -= extra;
      trackEnd += extra;
    }

    const latDeg = Number(loc.latitude);
    const lonDeg = Number(loc.longitude);
    const stepMs = Math.max(1, VIS_STEP_MIN) * 60 * 1000;

    const pts = [];
    for (let t = trackStart; t <= trackEnd; t += stepMs) {
      const { altDeg, azDeg } = raDecToAltAz(new Date(t), raDeg, decDeg, latDeg, lonDeg);
      pts.push({ t, altDeg, azDeg });
    }
    if (pts.length === 0 || pts[pts.length-1].t !== trackEnd) {
      const { altDeg, azDeg } = raDecToAltAz(new Date(trackEnd), raDeg, decDeg, latDeg, lonDeg);
      pts.push({ t: trackEnd, altDeg, azDeg });
    }

    function strokeSegment(p0, p1, color){
      const a0 = projectAltAz(p0.altDeg, p0.azDeg, cx, cy, radiusMax);
      const a1 = projectAltAz(p1.altDeg, p1.azDeg, cx, cy, radiusMax);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.9;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();
      return { a0, a1 };
    }

    for (let i = 1; i < pts.length; i++) {
      const A = pts[i-1];
      const B = pts[i];
      const midT = (A.t + B.t) / 2;

      const mid = raDecToAltAz(new Date(midT), raDeg, decDeg, latDeg, lonDeg);
      const hMid = horizonAtAzFn(mid.azDeg);
      if (mid.altDeg < hMid) continue;

      const skyPhase = getSkyPhaseAtMs(midT, loc);
      const segXY = strokeSegment(A, B, skyPhase.color);
      NIGHT_PATH_SEGMENTS.push({
        x0: segXY.a0.x, y0: segXY.a0.y,
        x1: segXY.a1.x, y1: segXY.a1.y,
        A, B
      });
    }

    // Event times: sunset/sunrise, horizon rise/set (custom horizon), meridian (actual transit; can be in daytime)
    {
      const tz = NIGHT_WINDOW.tz || "UTC";
      const nightStartMs = NIGHT_WINDOW.startUtc.getTime();
      const nightEndMs   = NIGHT_WINDOW.endUtc.getTime();

      // Build points inside the real night window (even if we expanded the drawn span)
      const nightPts = [];
      const pushPt = (tMs) => {
        const aa = raDecToAltAz(new Date(tMs), raDeg, decDeg, latDeg, lonDeg);
        nightPts.push({ t: tMs, altDeg: aa.altDeg, azDeg: aa.azDeg });
      };

      pushPt(nightStartMs);
      for (const p of pts) {
        if (p.t > nightStartMs && p.t < nightEndMs) nightPts.push(p);
      }
      pushPt(nightEndMs);
      nightPts.sort((a,b)=>a.t-b.t);

      let riseMs = null;
      let setMs = null;

      // Meridian = actual upper transit time across the plotted span.
      // This can fall in daytime, so do not clamp it to the night window.
      const meridianMs = findMeridianTransitMsForSpan(raDeg, lonDeg, trackStart, trackEnd);

      // Horizon crossings (custom horizon profile)
      // Only show "Horizon rise/set" if the object actually crosses your horizon during the night window.
      // If it stays above all night (or stays below all night), omit these labels.
      let anyAbove = false;
      let anyBelow = false;

      for (let i = 0; i < nightPts.length - 1; i++) {
        const A = nightPts[i];
        const B = nightPts[i+1];
        const d0 = A.altDeg - horizonAtAzFn(A.azDeg);
        const d1 = B.altDeg - horizonAtAzFn(B.azDeg);

        if (d0 >= 0 || d1 >= 0) anyAbove = true;
        if (d0 < 0 || d1 < 0)  anyBelow = true;

        if (d0 < 0 && d1 >= 0) {
          const denom = (d0 - d1);
          let u = (denom === 0) ? 0.5 : (d0 / denom);
          u = clamp(u, 0, 1);
          const tCross = A.t + u * (B.t - A.t);
          if (riseMs == null || tCross < riseMs) riseMs = tCross;
        } else if (d0 >= 0 && d1 < 0) {
          const denom = (d0 - d1);
          let u = (denom === 0) ? 0.5 : (d0 / denom);
          u = clamp(u, 0, 1);
          const tCross = A.t + u * (B.t - A.t);
          if (setMs == null || tCross > setMs) setMs = tCross;
        }
      }

      // No crossings -> no rise/set shown
      if (!(anyAbove && anyBelow)) {
        riseMs = null;
        setMs = null;
      }

      const fmt = (tMs) => (tMs == null) ? "—" : formatLocalHM(new Date(tMs), tz);

      // Marker/label colors (used in chart + overlay)
      const COL_SUN = "rgba(255, 215, 0, 0.95)";     // yellow
      const COL_HZN = "rgba(80, 220, 140, 0.95)";    // green
      const COL_MER = "rgba(220, 80, 220, 0.95)";    // magenta

      // Text overlay (top-left)
      ctx.save();
      ctx.font = "13px ui-sans-serif, system-ui";

      const WHITE = chartVar("--chart-text-strong", chartVar("--chart-text-strong", "rgba(255,255,255,0.95)"));
      const line1Seg = [
        { text: "Sunset ", color: COL_SUN },
        { text: fmt(nightStartMs), color: WHITE },
        { text: "  •  ", color: WHITE },
        { text: "Sunrise ", color: COL_SUN },
        { text: fmt(nightEndMs), color: WHITE },
      ];

      const line2Seg = [];
      if (riseMs != null) {
        line2Seg.push({ text: "Horizon rise ", color: COL_HZN });
        line2Seg.push({ text: fmt(riseMs), color: WHITE });
        line2Seg.push({ text: "  •  ", color: WHITE });
      }
      line2Seg.push({ text: "Meridian ", color: COL_MER });
      line2Seg.push({ text: fmt(meridianMs), color: WHITE });
      if (setMs != null) {
        line2Seg.push({ text: "  •  ", color: WHITE });
        line2Seg.push({ text: "Horizon set ", color: COL_HZN });
        line2Seg.push({ text: fmt(setMs), color: WHITE });
      }

      const line1 = line1Seg.map(s => s.text).join("");
      const line2 = line2Seg.map(s => s.text).join("");

      const padX = 10, padY = 8;
      const tw1 = ctx.measureText(line1).width;
      const tw2 = ctx.measureText(line2).width;
      const boxW = Math.max(tw1, tw2) + padX * 2;
      const boxH = 44;

      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(12, 12, boxW, boxH);

      const drawSegLine = (x, y, segs) => {
        let cx = x;
        for (const s of segs) {
          ctx.fillStyle = s.color || WHITE;
          ctx.fillText(s.text, cx, y);
          cx += ctx.measureText(s.text).width;
        }
      };

      drawSegLine(12 + padX, 12 + padY + 12, line1Seg);
      drawSegLine(12 + padX, 12 + padY + 28, line2Seg);
      ctx.restore();


      // Marker helper (draw a labelled marker on the object track)
      // Sunset/Sunrise are shown if the object is above 0° altitude at that moment.
      // Horizon rise/set markers are placed on the horizon crossing itself with a small tolerance,
      // because recomputing the coordinates at tCross can land a tiny fraction below the horizon.
      const drawMarker = (tMs, label, fillStyle, textStyle, mode = "object") => {
        if (tMs == null) return;

        const aa = raDecToAltAz(new Date(tMs), raDeg, decDeg, latDeg, lonDeg);
        const hz = horizonAtAzFn(aa.azDeg);
        const EPS_ALT = 0.35;

        let plotAlt = aa.altDeg;

        if (mode === "sky") {
          if (aa.altDeg < hz - EPS_ALT) return;
          plotAlt = Math.max(hz, aa.altDeg);
        } else if (mode === "horizon") {
          if (Math.max(aa.altDeg, hz) < -EPS_ALT) return;
          plotAlt = hz;
        } else {
          if (aa.altDeg < hz - EPS_ALT) return;
          plotAlt = aa.altDeg;
        }

        const xy = projectAltAz(plotAlt, aa.azDeg, cx, cy, radiusMax);

        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0,0,0,0.70)";
        ctx.fillStyle = fillStyle;

        const r = 8;
        ctx.beginPath();
        ctx.arc(xy.x, xy.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = "11px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = textStyle;
        ctx.fillText(label, xy.x, xy.y + 0.5);
        ctx.restore();
      };
      // Sunset / Sunrise markers (yellow)
      drawMarker(nightStartMs, "SS", COL_SUN, "rgba(0,0,0,0.92)", "sky");
      drawMarker(nightEndMs,   "SR", COL_SUN, "rgba(0,0,0,0.92)", "sky");

      // Horizon rise / set (green triangles) and meridian (magenta)
      drawMarker(riseMs,     "▲", COL_HZN, "rgba(0,0,0,0.92)", "horizon");
      drawMarker(meridianMs, "M", COL_MER, "rgba(0,0,0,0.92)", "object");
      drawMarker(setMs,      "▼", COL_HZN, "rgba(0,0,0,0.92)", "horizon");
}

    // current position marker (only if above horizon)
    {
      const now = Date.now();
      const { altDeg, azDeg } = raDecToAltAz(new Date(now), raDeg, decDeg, latDeg, lonDeg);
      const hNow = horizonAtAzFn(azDeg);

      if (altDeg >= hNow) {
        const xy = projectAltAz(altDeg, azDeg, cx, cy, radiusMax);
        ctx.strokeStyle = "rgba(255,80,80,0.95)";
        ctx.lineWidth = 2.3;
        ctx.beginPath();
        ctx.arc(xy.x, xy.y, 7, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    drawNightLegend(ctx, w, h);
    drawNightPathOverlay(ctx, w, h, cx, cy, radiusMax, loc, raDeg, decDeg, latDeg, lonDeg);

    // Moon phase icon (top-right)
    {
      const rMoon = clamp(Math.floor(Math.min(w, h) * 0.05), 14, 20);
      const moonX = w - 12 - rMoon;
      const moonY = 12 + rMoon;
      drawMoonPhaseIconOnCanvas(ctx, moonX, moonY, rMoon, moonPhaseForIcon);

      const moonInfo = buildTonightData(loc)?.moon || null;
      const moonLines = ["Moon"];
      if (moonInfo && moonInfo.phase) {
        moonLines.push(`${moonInfo.phase.illumPct}%`);
        moonLines.push(String(moonInfo.phase.name || ""));
        if (moonInfo.minSepDeg != null) moonLines.push(`Closest ${moonInfo.minSepDeg.toFixed(0)}°`);
      }

      // Label the phase icon: place text to the LEFT of the moon, vertically centred.
      // This keeps the layout tidy on narrow screens and avoids text running off-canvas.
      ctx.save();
      ctx.fillStyle = chartVar("--chart-text", "rgba(255,255,255,0.86)");
      ctx.textAlign = "right";
      ctx.textBaseline = "top";

      const usableLines = [];
      for (const line of moonLines) {
        const s = String(line || "").trim();
        if (!s) continue;
        if (s.toLowerCase() === "waxing gibbous") usableLines.push("Waxing gibbous");
        else if (s.toLowerCase() === "waning gibbous") usableLines.push("Waning gibbous");
        else usableLines.push(s);
      }

      let labelFontPx = 12;
      let lineH = 13;
      ctx.font = `${labelFontPx}px Roboto, sans-serif`;

      const maxAllowedWidth = Math.max(70, moonX - rMoon - 12);
      const widest = () => Math.max(...usableLines.map(line => ctx.measureText(line).width), 0);
      while (labelFontPx > 10 && widest() > maxAllowedWidth) {
        labelFontPx -= 1;
        lineH = Math.max(11, labelFontPx + 1);
        ctx.font = `${labelFontPx}px Roboto, sans-serif`;
      }

      const totalH = usableLines.length * lineH;
      const labelRightX = moonX - rMoon - 8;
      const minTop = 6;
      const maxTop = Math.max(minTop, h - totalH - 6);
      const labelTopY = clamp(moonY - totalH / 2, minTop, maxTop);

      usableLines.forEach((line, i) => {
        ctx.fillText(line, labelRightX, labelTopY + i * lineH);
      });
      ctx.restore();
    }
  }

  // -----------------------------
  // Monthly visibility
  // -----------------------------
  function computeYearIfPossible() {
    const loc = getSelected($("locationSelect"), LOCATIONS);
    if (!loc || selectedObjectIdx == null || !OBJECTS[selectedObjectIdx]) { YEAR_DATA = null; return; }

    const obj = OBJECTS[selectedObjectIdx];
    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) { YEAR_DATA = null; return; }

    const base = getBaseYmdForLocation(loc);
    const year = base.y;
    const currentMonthIdx = clamp(base.m - 1, 0, 11);

    const horizonAtAzFn = getHorizonAtAzFn();
    const months = [];
    const maxAltByMonth = [];

    for (let month = 1; month <= 12; month++) {
      const day = 15;
      const win = buildNightWindowUtcForYMD(loc, year, month, day);
      const r = computeVisibilityForObjectInWindow(loc, horizonAtAzFn, raDeg, decDeg, win.startUtc, win.endUtc);
      months.push(Math.max(0, r.totalMinutes || 0));
      maxAltByMonth.push((r.maxAltDeg != null && Number.isFinite(r.maxAltDeg)) ? r.maxAltDeg : null);
    }

    YEAR_DATA = { year, months, maxAltByMonth, currentMonthIdx };
  }

  function drawYearChart() {
    if (viewMode !== "year") return;

    const canvas = $("yearCanvas");
    if (!canvas) return;

    const { ctx, w, h } = prepareCanvas(canvas, 380);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(0, 0, w, h);

    YEAR_BAR_HITBOXES = [];

    if (!YEAR_DATA) {
      ctx.fillStyle = chartVar("--chart-text-muted2", "rgba(255,255,255,0.75)");
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText("Select an object to compute Monthly Visibility.", 18, 34);
      return;
    }

    const mins = YEAR_DATA.months;
    const maxMins = Math.max(0, ...mins);
    const bestMonthIdx = mins.indexOf(maxMins);
    const highlightColor = "#2F6F51";
    const currentMonthLineColor = "rgba(255,200,90,0.95)";
    const currentMonthIdx = (YEAR_DATA.currentMonthIdx != null) ? clamp(YEAR_DATA.currentMonthIdx, 0, 11) : null;
    const currentMonthMins = (currentMonthIdx != null) ? Math.max(0, mins[currentMonthIdx] || 0) : 0;

    const maxH = maxMins / 60;
    const yMaxH = Math.max(2, Math.ceil(maxH / 2) * 2);
    const yMaxMins = yMaxH * 60;

    const left = 64;
    const top = 34;
    const right = w - 18;
    const bottom = h - 54;

    ctx.strokeStyle = chartVar("--chart-grid2", "rgba(255,255,255,0.18)");
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.fillStyle = chartVar("--chart-text2", "rgba(255,255,255,0.78)");
    ctx.font = "13px ui-sans-serif, system-ui";

    for (let hh = 0; hh <= yMaxH; hh += 2) {
      const f = (hh / yMaxH);
      const y = bottom - f * (bottom - top);

      ctx.strokeStyle = chartVar("--chart-grid3", "rgba(255,255,255,0.10)");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      ctx.fillText(`${hh}h`, 12, y + 4);
    }

    const tickYs = [];
    for (let hh = 0; hh <= yMaxH; hh += 2) {
      const f = (hh / yMaxH);
      tickYs.push(bottom - f * (bottom - top));
    }

    const occupiedLabelYs = [];
    function resolveAxisLabelY(yTarget) {
      let y = yTarget;
      const tooCloseToTick = (yy) => tickYs.some(t => Math.abs(t - yy) < 10);
      const tooCloseToOther = (yy) => occupiedLabelYs.some(o => Math.abs(o - yy) < 14);

      let guard = 0;
      while ((tooCloseToTick(y) || tooCloseToOther(y)) && guard < 12) {
        const pushDown = (y - top < 18);
        y += pushDown ? 10 : -10;
        y = Math.max(top + 8, Math.min(bottom - 8, y));
        guard++;
      }
      occupiedLabelYs.push(y);
      return y;
    }

    function drawHorizontalReferenceLine(yValue, labelText, strokeColor, lineDash, lineWidth, bold=false) {
      if (!Number.isFinite(yValue)) return;
      ctx.save();
      ctx.setLineDash(lineDash);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(left, yValue);
      ctx.lineTo(right, yValue);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left - 6, yValue);
      ctx.lineTo(left, yValue);
      ctx.stroke();
      ctx.restore();

      const labelY = resolveAxisLabelY(yValue);
      ctx.save();
      ctx.fillStyle = strokeColor;
      ctx.font = `${bold ? "bold " : ""}13px ui-sans-serif, system-ui`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, left - 14, labelY);
      ctx.restore();
    }

    if (maxMins > 0) {
      const yBest = bottom - (maxMins / yMaxMins) * (bottom - top);
      const bestHours = (maxMins / 60);
      const bestHoursLabel = `${bestHours.toFixed(1).replace(/\.0$/, "")}h`;
      drawHorizontalReferenceLine(yBest, bestHoursLabel, highlightColor, [6, 6], 1.6, true);
    }

    if (currentMonthIdx != null && currentMonthMins > 0) {
      const yNow = bottom - (currentMonthMins / yMaxMins) * (bottom - top);
      const nowHours = (currentMonthMins / 60);
      const nowHoursLabel = `${nowHours.toFixed(1).replace(/\.0$/, "")}h`;
      drawHorizontalReferenceLine(yNow, nowHoursLabel, currentMonthLineColor, [4, 5], 1.5, true);
    }

    const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const gap = 8;
    const barW = Math.max(10, ((right - left) - gap*11) / 12);

    for (let i = 0; i < 12; i++) {
      const x = left + i*(barW + gap);
      const barH = (mins[i] / yMaxMins) * (bottom - top);
      const y = bottom - barH;

      const isNow = (i === currentMonthIdx);
      const isBest = (i === bestMonthIdx && maxMins > 0);
      ctx.fillStyle = isBest
        ? highlightColor
        : (isNow ? "rgba(255,200,90,0.80)" : "rgba(120,170,255,0.70)");
      ctx.fillRect(x, y, barW, barH);

      YEAR_BAR_HITBOXES.push({ idx: i, x, w: barW, top, bottom });

      ctx.fillStyle = isBest ? highlightColor : chartVar("--chart-text-muted", "rgba(255,255,255,0.82)");
      ctx.font = isBest ? "bold 12px ui-sans-serif, system-ui" : "12px ui-sans-serif, system-ui";
      const label = monthsShort[i];
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, x + (barW - tw)/2, bottom + 18);
    }

    ctx.fillStyle = chartVar("--chart-text4", "rgba(255,255,255,0.88)");
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText(`Monthly Visibility (${YEAR_DATA.year})`, left, 20);

  }

