/* js/deepskyscout-ui.js */
/* DeepSkyScout planner UI: table, charts, Aladin, events, init */

function formatSize(o) {
    const { major, minor } = getObjectArcmin(o);
    if (major > 0) {
      if (minor > 0 && minor !== major) return `${major.toFixed(1)}′ × ${minor.toFixed(1)}′`;
      return `${major.toFixed(1)}′`;
    }
    return "—";
  }

  function sizeNumeric(o) {
    const { major } = getObjectArcmin(o);
    return Number.isFinite(major) ? major : 0;
  }

  function setHeaderArrows() {
    updateMagnitudeColumnHeader();

    const keys = ["name","common_name","magnitude","size","type","subtype","notes","snr","visibility"];

    for (const k of keys) {
      const el = document.getElementById(`arrow-${k}`);
      if (el) el.textContent = (sortState.key === k) ? ((sortState.dir === "asc") ? "▲" : "▼") : "";
    }
    // mobile visibility arrow (second col)
    const vm = document.getElementById("arrow-visibility-m");
    if (vm) vm.textContent = (sortState.key === "visibility") ? ((sortState.dir === "asc") ? "▲" : "▼") : "";

    // mobile SNR arrow (if present)
    const sm = document.getElementById("arrow-snr-m");
    if (sm) sm.textContent = (sortState.key === "snr") ? ((sortState.dir === "asc") ? "▲" : "▼") : "";

    updateSortedColumnHighlight();
  }

  function updateSortedColumnHighlight() {
    const table = $("objectsTable");
    if (!table) return;

    table.querySelectorAll("thead th.sorted-col, tbody td.sorted-col").forEach(el => {
      el.classList.remove("sorted-col");
    });

    table.querySelectorAll(`thead th[data-key="${sortState.key}"]`).forEach(th => {
      th.classList.add("sorted-col");
    });

    table.querySelectorAll(`tbody td[data-col-key="${sortState.key}"]`).forEach(td => {
      td.classList.add("sorted-col");
    });
  }

  function updateMagnitudeColumnHeader() {
    const th = document.querySelector('th[data-key="magnitude"]');
    if (!th) return;

    const mode = (typeof getSelectedMagnitudeMode === 'function')
      ? getSelectedMagnitudeMode()
      : 'V';

    const label = (mode === 'AUTO') ? 'Mag (Auto)' : `Mag (${mode})`;
    th.innerHTML = `${label} <span class="arrow" id="arrow-magnitude"></span>`;
  }

  function sortLabel() {
    const map = { name:"Name", common_name:"Common Name", magnitude:"Mag", size:"Size", type:"Type", subtype:"Subtype", notes:"Notes", snr:"SNR", visibility:"Visibility" };
    return `${map[sortState.key] || sortState.key} (${sortState.dir === "asc" ? "ascending" : "descending"})`;
  }

  // Interactive sky-path click overlay state
  let NIGHT_PATH_SEGMENTS = [];
  let NIGHT_PATH_OVERLAY = null;

  function clearNightPathOverlay(opts = {}) {
    const { redraw = false } = opts;
    NIGHT_PATH_OVERLAY = null;
    if (redraw && viewMode === "night") drawNightChart();
  }

  function pointToSegmentDistancePx(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx*dx + dy*dy;
    let u = 0;
    if (len2 > 0) u = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
    const x = x0 + u * dx;
    const y = y0 + u * dy;
    const ddx = px - x;
    const ddy = py - y;
    return { d2: ddx*ddx + ddy*ddy, u, x, y };
  }

  function findNearestNightPathPointPx(px, py) {
    if (!Array.isArray(NIGHT_PATH_SEGMENTS) || !NIGHT_PATH_SEGMENTS.length) return null;

    const maxDistPx = 18;
    const maxD2 = maxDistPx * maxDistPx;

    let best = null;
    for (const seg of NIGHT_PATH_SEGMENTS) {
      const hit = pointToSegmentDistancePx(px, py, seg.x0, seg.y0, seg.x1, seg.y1);
      if (hit.d2 > maxD2) continue;
      if (!best || hit.d2 < best.d2) {
        const tMs = seg.A.t + hit.u * (seg.B.t - seg.A.t);
        best = {
          d2: hit.d2,
          u: hit.u,
          x: hit.x,
          y: hit.y,
          tMs,
          altDeg: seg.A.altDeg + hit.u * (seg.B.altDeg - seg.A.altDeg),
          azDeg: seg.A.azDeg + hit.u * (seg.B.azDeg - seg.A.azDeg),
        };
      }
    }
    return best;
  }

  function drawNightPathOverlay(ctx, w, h, cx, cy, radiusMax, loc, raDeg, decDeg, latDeg, lonDeg) {
    const overlay = NIGHT_PATH_OVERLAY;
    if (!overlay) return;
    if (overlay.objectIdx !== selectedObjectIdx) return;
    if (overlay.dateIso !== SELECTED_DATE_ISO) return;

    const aa = raDecToAltAz(new Date(overlay.tMs), raDeg, decDeg, latDeg, lonDeg);
    if (!Number.isFinite(aa.altDeg) || !Number.isFinite(aa.azDeg)) return;

    const xy = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);
    const tz = loc?.timezone || NIGHT_WINDOW?.tz || "UTC";
    const line = `Time: ${formatLocalHM(new Date(overlay.tMs), tz)}, Alt: ${Math.round(aa.altDeg)}°`;

    ctx.save();
    const fontPx = isMobileNarrow() ? 12 : 13;
    ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
    const padX = 10;
    const padY = 7;
    const boxW = ctx.measureText(line).width + padX * 2;
    const boxH = fontPx + padY * 2;

    let boxX = xy.x - boxW / 2;
    let boxY = xy.y - boxH - 14;

    boxX = clamp(boxX, 8, w - boxW - 8);
    boxY = clamp(boxY, 8, h - boxH - 8);

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.2;

    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 10);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = chartVar("--chart-text-strong", "rgba(255,255,255,0.95)");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(line, boxX + padX, boxY + boxH / 2 + 0.5);

    ctx.strokeStyle = "rgba(255,255,255,0.26)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(xy.x, xy.y, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Display label used in the table's "Type" column:
  // - show refined subtype if present (e.g. "Spiral Galaxy")
  // - fall back to the broad type (e.g. "Galaxy")
  function displayTypeForTable(o){
    const st = String(o?.subtype ?? "").trim();
    if (st) return st;
    return String(o?.type ?? "").trim();
  }

  function beginnerFramingLabel(o){
    const { major } = getObjectArcmin(o);
    const axes = (typeof computeRigFovAxesNullable === "function") ? computeRigFovAxesNullable(1) : null;
    const frameShortArcmin = axes ? (Math.min(axes.fovW, axes.fovH) * 60) : NaN;

    if (!(Number.isFinite(major) && major > 0) || !(Number.isFinite(frameShortArcmin) && frameShortArcmin > 0)) {
      return "slightly small";
    }

    const ratio = major / frameShortArcmin;
    if (ratio >= 0.92) return "ideal for mosaic";
    if (ratio >= 0.28) return "fills frame well";
    if (ratio >= 0.14) return "slightly small";
    if (ratio >= 0.06) return "very small";
    return "too small";
  }

  function beginnerExposureScore(idx){
    const o = OBJECTS[idx];
    let score = 0;

    const mag = parseMagnitude(getMagnitudeForSort(o));
    if (Number.isFinite(mag)) {
      if (mag <= 7.5) score += 0;
      else if (mag <= 8.8) score += 1;
      else if (mag <= 10.2) score += 2;
      else if (mag <= 11.8) score += 3;
      else score += 4;
    } else {
      const t = `${o?.type || ""} ${o?.subtype || ""}`.toLowerCase();
      if (t.includes("open cluster")) score += 1;
      else if (t.includes("globular")) score += 2;
      else if (t.includes("emission") || t.includes("reflection") || t.includes("planetary") || t.includes("nebula")) score += 2;
      else if (t.includes("galaxy")) score += 3;
      else score += 2;
    }

    const { major } = getObjectArcmin(o);
    const axes = (typeof computeRigFovAxesNullable === "function") ? computeRigFovAxesNullable(1) : null;
    const frameShortArcmin = axes ? (Math.min(axes.fovW, axes.fovH) * 60) : NaN;
    if (Number.isFinite(major) && major > 0 && Number.isFinite(frameShortArcmin) && frameShortArcmin > 0) {
      const ratio = major / frameShortArcmin;
      if (ratio < 0.04) score += 2;
      else if (ratio < 0.08) score += 1;
    }

    // Beginner guidance assumes roughly a 3-hour imaging session.
    // Brightness still dominates, but short visibility gets a real penalty.
    const visH = (VIS_RESULTS.get(idx)?.visibleSec ?? 0) / 3600;
    if (visH > 0 && visH < 1.0) score += 3;
    else if (visH < 2.0) score += 2;
    else if (visH < 3.0) score += 1;

    return score;
  }

  function beginnerExposureLabel(idx){
    const score = beginnerExposureScore(idx);
    if (score <= 1) return "good target";
    if (score <= 3) return "moderate";
    return "difficult";
  }

  function beginnerFramingRank(label){
    switch (label) {
      case "fills frame well": return 0;
      case "slightly small": return 1;
      case "ideal for mosaic": return 2;
      case "very small": return 3;
      case "too small": return 4;
      default: return 5;
    }
  }

  function beginnerExposureRank(label){
    switch (label) {
      case "good target": return 0;
      case "moderate": return 1;
      case "difficult": return 2;
      default: return 3;
    }
  }

  function beginnerVisibilityRank(idx){
    const visH = (VIS_RESULTS.get(idx)?.visibleSec ?? 0) / 3600;
    if (visH >= 3.0) return 0;
    if (visH >= 2.0) return 1;
    if (visH > 0) return 2;
    return 3;
  }

  function beginnerNotesSortScore(idx){
    const o = OBJECTS[idx];
    const framing = beginnerFramingLabel(o);
    const exposure = beginnerExposureLabel(idx);
    const expRank = beginnerExposureRank(exposure);
    const visRank = beginnerVisibilityRank(idx);
    const frameRank = beginnerFramingRank(framing);

    const mag = parseMagnitude(getMagnitudeForSort(o));
    const magRank = Number.isFinite(mag) ? mag : 99;
    const visSec = VIS_RESULTS.get(idx)?.visibleSec ?? 0;
    const { major } = getObjectArcmin(o);
    const invSize = Number.isFinite(major) && major > 0 ? (1 / major) : 9999;

    return [expRank, visRank, frameRank, magRank, -visSec, invSize, String(o?.name ?? "").toLowerCase()];
  }

  function beginnerNotesHtml(idx){
    const o = OBJECTS[idx];
    const framing = beginnerFramingLabel(o);
    const exposure = beginnerExposureLabel(idx);
    return `
      <div style="display:flex; flex-direction:column; gap:4px; line-height:1.2;">
        <div><span class="muted">Framing:</span> ${safe(framing)}</div>
        <div><span class="muted">Exposure:</span> ${safe(exposure)}</div>
      </div>
    `;
  }


function getSortValue(idx, key) {
    const o = OBJECTS[idx];
    switch (key) {
      case "snr": return computeSNRScoreForIdx(idx) ?? 0;
        case "visibility": return VIS_RESULTS.get(idx)?.visibleSec ?? 0;
      case "magnitude": {
        const m = parseMagnitude(getMagnitudeForSort(o));
        return Number.isFinite(m) ? m : 99;
      }
      case "size": return sizeNumeric(o);
      case "name": return String(o?.name ?? "").toLowerCase();
      case "common_name": return String(o?.common_name ?? "").toLowerCase();
      case "type": return String(displayTypeForTable(o) || "").toLowerCase();
      case "subtype": return String(o?.subtype ?? "").toLowerCase();
      case "notes": return beginnerNotesSortScore(idx);
      default: return "";
    }
  }

  function compareIdx(a, b) {
    if (sortState.key === "visibility") {
      const ra = Math.round(VIS_RESULTS.get(a)?.visibleSec ?? 0);
      const rb = Math.round(VIS_RESULTS.get(b)?.visibleSec ?? 0);
      if (ra !== rb) return (sortState.dir === "asc") ? (ra - rb) : (rb - ra);

      const aa = VIS_RESULTS.get(a)?.avgAltDeg;
      const ab = VIS_RESULTS.get(b)?.avgAltDeg;
      const aAvg = Number.isFinite(aa) ? aa : -1e9;
      const bAvg = Number.isFinite(ab) ? ab : -1e9;
      if (aAvg !== bAvg) return (bAvg - aAvg);

      const ma = VIS_RESULTS.get(a)?.maxAltDeg;
      const mb = VIS_RESULTS.get(b)?.maxAltDeg;
      const aMax = Number.isFinite(ma) ? ma : -1e9;
      const bMax = Number.isFinite(mb) ? mb : -1e9;
      if (aMax !== bMax) return (bMax - aMax);

      return String(OBJECTS[a]?.name ?? "").localeCompare(String(OBJECTS[b]?.name ?? ""));
    }

    const ka = getSortValue(a, sortState.key);
    const kb = getSortValue(b, sortState.key);

    let cmp = 0;
    if (Array.isArray(ka) && Array.isArray(kb)) {
      const n = Math.max(ka.length, kb.length);
      for (let i = 0; i < n; i++) {
        const va = ka[i];
        const vb = kb[i];
        if (va === vb) continue;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        if (cmp !== 0) break;
      }
    } else if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
    else cmp = String(ka).localeCompare(String(kb));

    if (cmp === 0) {
      const va = VIS_RESULTS.get(a)?.visibleSec ?? 0;
      const vb = VIS_RESULTS.get(b)?.visibleSec ?? 0;
      cmp = vb - va;
      if (cmp === 0) cmp = String(OBJECTS[a]?.name ?? "").localeCompare(String(OBJECTS[b]?.name ?? ""));
    }

    return (sortState.dir === "asc") ? cmp : -cmp;
  }

  function formatMobileMergedName(o){
    const n = safe(o?.name);
    const cn = String(o?.common_name ?? "").trim();
    if (isMobileNarrow() && cn) return `${n} (${cn})`;
    return n;
  }

  function bestDisplayLabelForSearch(o, toks){
    if (!toks?.length) return null;

    const candidates = [];
    const pushCandidate = (raw, kind, order) => {
      const v = String(raw ?? "").trim();
      if (!v) return;
      const h = normSearch(v);
      if (!h) return;
      if (!toks.every(t => h.includes(normSearch(t)))) return;

      const firstTok = normSearch(toks[0] || "");
      const starts = (firstTok && h.startsWith(firstTok)) ? 0 : 1;
      const exact = (h === normSearch(toks.join("")) || h === normSearch(NAME_QUERY)) ? 0 : 1;

      candidates.push({
        raw: v,
        kind,
        order,
        exact,
        starts,
        len: v.length,
        h
      });
    };

    // Prefer a matching common name when the user searched for the object's main/common label.
    pushCandidate(o?.common_name, "common", 0);
    pushCandidate(o?.name, "name", 1);

    const alts = alternativeSearchLabelsForObject(o);
    for (let i = 0; i < alts.length; i++) pushCandidate(alts[i], "alt", i);

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact - b.exact;
      if (a.kind !== b.kind) {
        const rank = { common: 0, name: 1, alt: 2 };
        return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
      }
      if (a.starts !== b.starts) return a.starts - b.starts;
      if (a.len !== b.len) return a.len - b.len;
      return a.order - b.order;
    });

    return candidates[0]?.raw || null;
  }

  function formatNameStackHtml(o){
    const toks = queryTokens(NAME_QUERY);

    // Choose the best matching display label from common name, canonical name, aliases,
    // and alternate catalog labels. This keeps normal browsing canonical, but when
    // searching for something like "Thor's Helmet" the common name becomes the main line.
    const matchedLabel = toks.length ? bestDisplayLabelForSearch(o, toks) : null;

    const defaultPrimary = String(o?.name ?? "").trim();
    const primaryRaw = matchedLabel || defaultPrimary;
    const primary = safe(primaryRaw);

    const canonicalName = String(o?.name ?? "").trim();
    const commonName = String(o?.common_name ?? "").trim();

    let subRaw = "";
    const pNorm = normSearch(primaryRaw);

    if (commonName && pNorm !== normSearch(commonName)) {
      // If primary is the catalog/canonical name or an alias, show common name underneath.
      subRaw = commonName;
    } else if (canonicalName && pNorm !== normSearch(canonicalName)) {
      // If primary is the common name or an alias, show canonical name underneath.
      subRaw = canonicalName;
    }

    const used = new Set([normSearch(primaryRaw)]);
    if (subRaw && used.has(normSearch(subRaw))) subRaw = "";
    if (subRaw) used.add(normSearch(subRaw));

    const extraLabels = toks.length
      ? searchContextLabelsForObject(o, toks, 8).filter(lbl => !used.has(normSearch(lbl)))
      : [];

    let html = `<div>${primary}</div>`;

    if (subRaw) {
      html += `<div class="muted" style="font-family: ui-sans-serif, system-ui; font-size: 0.85em; margin-top:2px;">${safe(subRaw)}</div>`;
    }

    if (extraLabels.length) {
      html += `<div class="muted" style="font-family: ui-sans-serif, system-ui; font-size: 0.78em; margin-top:3px; line-height:1.25;">Also: ${extraLabels.map(safe).join(" • ")}</div>`;
    }

    return html;
  }


  function renderObjectsTable() {
    const tbody = $("objectsTbody");
    tbody.innerHTML = "";

    for (const idx of FILTERED_INDICES) {
      const o = OBJECTS[idx];
      const visSec = VIS_RESULTS.get(idx)?.visibleSec ?? 0;
      const visH = visSec / 3600;

      const tr = document.createElement("tr");
      tr.dataset.idx = String(idx);
      if (idx === selectedObjectIdx) tr.classList.add("selected");

      tr.innerHTML = `
        <td class="mono" data-col-key="name">${formatNameStackHtml(o)}</td>

        <!-- mobile visibility (2nd col) -->
        <td class="vis-cell mobile-only" data-col-key="visibility">${visH.toFixed(2)}h</td>

        <td class="notes-cell non-advanced-only" data-col-key="notes">${beginnerNotesHtml(idx)}</td>

        <td class="snr-cell advanced-only mobile-only" data-col-key="snr">${formatSNRScore(computeSNRScoreForIdx(idx))}</td>

        <td class="desktop-only hide-common" data-col-key="common_name">${safe(o.common_name)}</td>
        <td class="advanced-only desktop-only" data-col-key="magnitude">${formatObjectMagnitude(o)}</td>
        <td class="advanced-only desktop-only" data-col-key="size">${formatSize(o)}</td>
        <td data-col-key="type">${safe(displayTypeForTable(o))}</td>
        <td class="desktop-only hide-subtype" data-col-key="subtype">${safe(o.subtype)}</td>

        <td class="snr-cell advanced-only desktop-only" data-col-key="snr">${formatSNRScore(computeSNRScoreForIdx(idx))}</td>

        <!-- desktop visibility (last col) -->
        <td class="vis-cell desktop-only" data-col-key="visibility">${visH.toFixed(2)}h</td>
      `;
      tbody.appendChild(tr);
    }

    applyObjectsTableColumnVisibility();
    setHeaderArrows();
  }

  function refreshTableOnly() {
    applyFilters();
    FILTERED_INDICES.sort(compareIdx);

    if (FILTERED_INDICES.length === 0) {
      $("objectsTbody").innerHTML = `<tr><td colspan="11" class="muted" style="padding:12px;">No objects match your filters.</td></tr>`;
      applyObjectsTableColumnVisibility();
      setHeaderArrows();
      selectedObjectIdx = null;
      if (viewMode === "night") drawNightChart();
      if (viewMode === "year") { YEAR_DATA = null; drawYearChart(); }
      if (viewMode === "image") updateAladinFromSelection(true);
      updateCaption();
      updateMobileChartInfo();
      return;
    }

    if (selectedObjectIdx == null || !FILTERED_INDICES.includes(selectedObjectIdx)) {
      selectedObjectIdx = FILTERED_INDICES[0];
    }

    renderObjectsTable();

    if (viewMode === "night") drawNightChart();
    if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
    if (viewMode === "image") updateAladinFromSelection(true);

    updateCaption();
    updateMobileChartInfo();
  }

  // -----------------------------
  // Status + recompute
  // -----------------------------
  async function recomputeVisibilityAndRender() {
    const loc = getSelected($("locationSelect"), LOCATIONS);
    updateDateUI();

    $("objectsStatus").textContent = "⏳ Calculating visibility…";
    $("objectsTbody").innerHTML = `<tr><td colspan="11" class="muted" style="padding:12px;">Calculating…</td></tr>`;
    applyObjectsTableColumnVisibility();

    await new Promise(r => setTimeout(r, 0));

    VIS_RESULTS = computeVisibilityForAllObjects(loc);

    buildTypeFilterOptions();
    refreshTableOnly();

    updateObjectsStatus();
  }

  // -----------------------------
  // Caption + mobile chart info
  // -----------------------------
  function getSelectedObjectSafe() {
    if (selectedObjectIdx == null) return null;
    return OBJECTS?.[selectedObjectIdx] ?? null;
  }

  function getObjectDisplayNamePlain(obj){
    if (!obj) return "—";
    const n = safe(obj.name);
    const cn = String(obj.common_name ?? "").trim();
    return cn ? `${n} (${safe(cn)})` : n;
  }

  function getGridMode(){
    if (isMobileNarrow()) return "altaz";
    return $("gridEqu").checked ? "equ" : "altaz";
  }

  function buildTonightData(loc){
    const tz = NIGHT_WINDOW?.tz || loc?.timezone || "UTC";
    const vis = (selectedObjectIdx != null) ? VIS_RESULTS.get(selectedObjectIdx) : null;

    const visH = vis ? (vis.visibleSec / 3600) : 0;

    const sunsetSunrise = (NIGHT_WINDOW?.startUtc && NIGHT_WINDOW?.endUtc)
      ? formatTimeRangeLocal(NIGHT_WINDOW.startUtc.getTime(), NIGHT_WINDOW.endUtc.getTime(), tz)
      : "—";

    const bestWindow = (vis?.bestStartUtcMs != null && vis?.bestEndUtcMs != null)
      ? formatTimeRangeLocal(vis.bestStartUtcMs, vis.bestEndUtcMs, tz).replace(/\s*\(\+\d+d\)$/, "")
      : "—";

    const maxAlt = (vis && vis.maxAltDeg != null) ? vis.maxAltDeg : null;

    const obj = getSelectedObjectSafe();

    let moon = null;
    if (obj) {
      const raDeg = parseRaDeg(obj.ra);
      const decDeg = parseDecDeg(obj.dec);
      moon = computeMoonSeparationTonight(loc, raDeg, decDeg, vis);
    }

    return { tz, visH, sunsetSunrise, bestWindow, maxAlt, moon };
  }

  function updateMobileChartInfo(){
    const box = $("mobileChartInfo");
    if (!box) return;

    const mob = isMobileNarrow();
    const loc = getSelected($("locationSelect"), LOCATIONS);
    const obj = getSelectedObjectSafe();

    if (!mob || viewMode !== "night" || !loc || !obj) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }

    const d = buildTonightData(loc);


      const magTxt = formatObjectMagnitude(obj);
      const magHtml = (magTxt !== "—") ? `&nbsp;•&nbsp; Mag: <code>${magTxt}</code>` : "";

      const adv = isAdvancedModeEnabled();
      const lineInfo = adv ? getLineFluxInfo(obj) : null;
      const lineHtml = (adv && lineInfo)
        ? `&nbsp;•&nbsp; ${lineInfo.line} flux: <code>${lineInfo.flux.toExponential(2)} erg/s/cm²</code>`
        : "";

      const snrHtml = adv
        ? `&nbsp;•&nbsp; SNR score: <code>${formatSNRScore(computeSNRScoreForIdx(selectedObjectIdx))}</code> <span class="muted">(Bortle ${getBortleValue()})</span>`
        : "";

      const moon = d.moon;
      const moonHtml = ``;

box.innerHTML = `
      <div class="t1">${safe(getObjectDisplayNamePlain(obj))}</div>
      <div class="t2">
        &nbsp;•&nbsp; Total: <code>${d.visH.toFixed(2)}h</code>
        &nbsp;•&nbsp; Best window: <code>${safe(d.bestWindow)}</code>
        ${d.maxAlt != null ? `&nbsp;•&nbsp; Max altitude: <code>${d.maxAlt.toFixed(1)}°</code>` : ""}${magHtml}${lineHtml}${snrHtml}${moonHtml}
      </div>
    `;
    box.style.display = "";
  }

  function buildImageTopLine(obj) {
    const raDeg = obj ? parseRaDeg(obj.ra) : null;
    const decDeg = obj ? parseDecDeg(obj.dec) : null;
    const vis = (selectedObjectIdx != null) ? VIS_RESULTS.get(selectedObjectIdx) : null;
    const preview = getAladinPreviewSummary(obj, vis);

    const surveyLabel = $("surveySelect")?.selectedOptions?.[0]?.textContent || $("surveySelect")?.value || "—";
    const mosaic = Number($("mosaicRange")?.value) || 1;
    const axes = (typeof computeRigFovAxesNullable === "function") ? computeRigFovAxesNullable(mosaic) : null;

    const raTxt = (raDeg == null) ? "—" : `${raDeg.toFixed(4)}°`;
    const decTxt = (decDeg == null) ? "—" : `${decDeg.toFixed(4)}°`;
    const fovTxt = axes
      ? `${axes.fovW.toFixed(2)}° × ${axes.fovH.toFixed(2)}°`
      : `${computeRigFovDeg().toFixed(2)}°`;

    const tileAxes = (typeof computeRigFovAxesNullable === "function") ? computeRigFovAxesNullable(1) : null;
    const tileTxt = tileAxes ? `${tileAxes.fovW.toFixed(2)}° × ${tileAxes.fovH.toFixed(2)}°` : "—";
    const mosaicTxt = (mosaic > 1) ? ` • Mosaic <code>${mosaic}×${mosaic}</code>` : "";
    const previewTxt = (preview.mode === "altaz")
      ? ` • Preview <code>Alt-Az</code> @ <code>${safe(preview.timeLabel)}</code>`
      : ` • Preview <code>EQ</code>`;
    const overlayTxt = getAladinShowFov() ? "" : ` • Overlay <code>Off</code>`;

    return `Sky Image (Aladin): <code>${safe(surveyLabel)}</code> • Center: RA <code>${raTxt}</code>, Dec <code>${decTxt}</code> • FoV ≈ <code>${fovTxt}</code> • Frame <code>${tileTxt}</code>${mosaicTxt}${previewTxt}${overlayTxt}`;
  }

  function formatNameWithOptionalCommon(obj){
    if (!obj) return "—";
    const n = safe(obj.name);
    const cn = String(obj.common_name ?? "").trim();
    return cn ? `${n} (${cn})` : n;
  }

  function updateCaption() {
    const cap = $("chartCaption");
    const loc = getSelected($("locationSelect"), LOCATIONS);
    const obj = getSelectedObjectSafe();

    if (!loc || !obj) {
      if (viewMode === "image") cap.textContent = "Sky Image (Aladin): select an object to view its field.";
      else if (viewMode === "year") cap.textContent = "Monthly Visibility: select an object to compute monthly totals.";
      else cap.textContent = "Select an object to view: Tonight’s Visibility, Sky Image (Aladin), or Monthly Visibility.";
      return;
    }

    const nameLine = (typeof formatNameWithOptionalCommon === "function")
      ? formatNameWithOptionalCommon(obj)
      : getObjectDisplayNamePlain(obj);
      const magTxt = formatObjectMagnitude(obj);
      const magHtml = (magTxt !== "—") ? `&nbsp;•&nbsp; Mag: <code>${magTxt}</code>` : "";

      const adv = isAdvancedModeEnabled();
      const lineInfo = adv ? getLineFluxInfo(obj) : null;
      const lineHtml = (adv && lineInfo)
        ? `&nbsp;•&nbsp; ${lineInfo.line} flux: <code>${lineInfo.flux.toExponential(2)} erg/s/cm²</code>`
        : "";

      const snrHtml = adv
        ? `&nbsp;•&nbsp; SNR score: <code>${formatSNRScore(computeSNRScoreForIdx(selectedObjectIdx))}</code> <span class="muted">(Bortle ${getBortleValue()})</span>`
        : "";
// ---------- TONIGHT ----------
    if (viewMode === "night") {
      // Mobile stays compact (mobile already shows the detailed box above the canvas)
      if (isMobileNarrow()) {
        cap.innerHTML = `<span class="muted">Tip: tap an object row to update the chart.</span>`;
        return;
      }

      // Desktop: restore full info underneath the chart
      const d = buildTonightData(loc);

      const moon = d.moon;
      const moonHtml = ``;


      cap.innerHTML = `
        <div><strong>Tonight’s Visibility</strong> • ${nameLine}</div>
        <div style="margin-top:4px;">
          &nbsp;•&nbsp; Total: <code>${d.visH.toFixed(2)}h</code>
          &nbsp;•&nbsp; Best window: <code>${safe(d.bestWindow)}</code>
          ${d.maxAlt != null ? `&nbsp;•&nbsp; Max altitude: <code>${d.maxAlt.toFixed(1)}°</code>` : ""}${magHtml}${lineHtml}${snrHtml}${moonHtml}
        </div>
      `;
      return;
    }

    // ---------- IMAGE (ALADIN) ----------
    if (viewMode === "image") {
      const topLine = buildImageTopLine(obj);

      // Mobile stays compact
      if (isMobileNarrow()) {
        cap.innerHTML = `<div><strong>${topLine}</strong></div>`;
        return;
      }

      // Desktop: Aladin top line + repeat Tonight summary
      const d = buildTonightData(loc);

      cap.innerHTML = `
        <div><strong>${topLine}</strong></div>

        <div style="margin-top:6px;">
          <strong>Tonight’s Visibility</strong> • ${nameLine}
        </div>

        <div style="margin-top:4px;">
          &nbsp;•&nbsp; Total: <code>${d.visH.toFixed(2)}h</code>
          &nbsp;•&nbsp; Best window: <code>${safe(d.bestWindow)}</code>
          ${d.maxAlt != null ? `&nbsp;•&nbsp; Max altitude: <code>${d.maxAlt.toFixed(1)}°</code>` : ""}${magHtml}${lineHtml}${snrHtml}
        </div>
      `;
      return;
    }

    // ---------- MONTHLY ----------
    computeYearIfPossible();
    if (!YEAR_DATA) {
      cap.textContent = "Monthly Visibility: select an object to compute monthly totals.";
      return;
    }

    const mins = YEAR_DATA.months || [];
    const maxMins = Math.max(0, ...mins);
    const bestMonthIdx = mins.indexOf(maxMins);
    const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const bestLabel = (bestMonthIdx >= 0) ? monthsShort[bestMonthIdx] : "—";

    cap.innerHTML = `
      <div><strong>Monthly Visibility</strong> • ${nameLine}</div>${magHtml}${lineHtml}${snrHtml}
    `;
  }

  // -----------------------------
  // View switching
  // -----------------------------
  function setViewMode(mode) {
    viewMode = mode;

    const nightPane = $("nightPane");
    const imagePane = $("imagePane");
    const yearPane  = $("yearPane");

    const nightOnly = document.querySelectorAll(".night-only");
    const surveyWrap = $("surveyWrap");
    const chartTitleText = $("chartTitleText");

    if (mode === "night") {
      nightPane.style.display = "";
      imagePane.style.display = "none";
      yearPane.style.display  = "none";
      nightOnly.forEach(el => el.style.display = "inline-flex");
      $("sepNight").style.display = "inline-flex";
      surveyWrap.style.display = "none";
      chartTitleText.textContent = "Tonight’s Visibility";
      updateDateUI();
      updateAllResponsiveUI();
      drawNightChart();
      updateCaption();
      return;
    }

    if (mode === "image") {
      nightPane.style.display = "none";
      imagePane.style.display = "flex";
      yearPane.style.display  = "none";
      nightOnly.forEach(el => el.style.display = "none");
      $("sepNight").style.display = "none";
      surveyWrap.style.display = "flex";
      chartTitleText.textContent = "Sky Image (Aladin)";
      initAladinIfNeeded();
      updateAllResponsiveUI();
      updateCaption();
      setTimeout(() => updateAladinFromSelection(true), 60);
      return;
    }

    nightPane.style.display = "none";
    imagePane.style.display = "none";
    yearPane.style.display  = "";
    nightOnly.forEach(el => el.style.display = "none");
    $("sepNight").style.display = "none";
    surveyWrap.style.display = "none";
    chartTitleText.textContent = "Monthly Visibility";
    updateAllResponsiveUI();
    computeYearIfPossible();
    drawYearChart();
    updateCaption();
  }

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

  // -----------------------------
  // Aladin integration
  // -----------------------------
  let LAST_ALADIN_OVERLAY_KEY = "";
  let aladinFrameOverlay = null;
  let aladinTileOverlay = null;
  let aladinObjectOverlay = null;
  const ALADIN_FRAME_MARGIN = 1.25;

  function getAladinRigAxes() {
    const mosaic = Number($("mosaicRange")?.value) || 1;
    if (typeof computeRigFovAxesNullable !== "function") return null;
    return computeRigFovAxesNullable(mosaic);
  }

  function getAladinTileAxes() {
    if (typeof computeRigFovAxesNullable !== "function") return null;
    return computeRigFovAxesNullable(1);
  }

  function getAladinMosaicCount() {
    return Math.max(1, Math.round(Number($("mosaicRange")?.value) || 1));
  }

  function getAladinPreviewMode() {
    return document.querySelector('input[name="aladinPreviewMode"]:checked')?.value || "altaz";
  }

  function getAladinShowFov() {
    return $("aladinShowFovToggle") ? !!$("aladinShowFovToggle").checked : true;
  }

  function updateAladinPreviewModeLabel() {
    const valueEl = $("aladinPreviewModeValue");
    if (!valueEl) return;
    valueEl.style.display = "none";
    valueEl.setAttribute("aria-hidden", "true");
    valueEl.textContent = (getAladinPreviewMode() === "eq") ? "EQ" : "Alt-Az";
  }

  function getSelectedObjectVisibilitySafe() {
    return (selectedObjectIdx == null) ? null : (VIS_RESULTS.get(selectedObjectIdx) || null);
  }

  function getAladinPreviewTimeMs(_obj, vis) {
    if (vis?.bestStartUtcMs != null && vis?.bestEndUtcMs != null) {
      return Math.round((vis.bestStartUtcMs + vis.bestEndUtcMs) / 2);
    }
    if (NIGHT_WINDOW?.startUtc && NIGHT_WINDOW?.endUtc) {
      return Math.round((NIGHT_WINDOW.startUtc.getTime() + NIGHT_WINDOW.endUtc.getTime()) / 2);
    }
    return Date.now();
  }

  function findMeridianTransitMsForSpan(raDeg, lonDeg, spanStartMs, spanEndMs) {
    if (![raDeg, lonDeg, spanStartMs, spanEndMs].every(Number.isFinite)) return null;
    const spanMidMs = (spanStartMs + spanEndMs) / 2;
    let tMs = spanMidMs;

    for (let i = 0; i < 5; i++) {
      const jd = jdFromDate(new Date(tMs));
      const lstDeg = clamp360(gmstDeg(jd) + lonDeg);
      let hourAngleDeg = ((lstDeg - raDeg + 540) % 360) - 180;
      const deltaMs = (-hourAngleDeg / 360.98564736629) * 86400000;
      tMs += deltaMs;
      if (Math.abs(deltaMs) < 250) break;
    }

    const SIDEREAL_DAY_MS = 86164.0905 * 1000;
    while (tMs < spanStartMs) tMs += SIDEREAL_DAY_MS;
    while (tMs > spanEndMs) tMs -= SIDEREAL_DAY_MS;

    if (tMs < spanStartMs || tMs > spanEndMs) {
      const plus = tMs + SIDEREAL_DAY_MS;
      const minus = tMs - SIDEREAL_DAY_MS;
      const candidates = [tMs, plus, minus].filter(v => v >= spanStartMs && v <= spanEndMs);
      if (!candidates.length) return null;
      tMs = candidates.reduce((best, v) => Math.abs(v - spanMidMs) < Math.abs(best - spanMidMs) ? v : best, candidates[0]);
    }

    return tMs;
  }

  function getParallacticAngleDeg(utcDate, raDeg, decDeg, latDeg, lonDeg) {
    if (![raDeg, decDeg, latDeg, lonDeg].every(Number.isFinite)) return 0;

    const jd = jdFromDate(utcDate);
    const lstDeg = clamp360(gmstDeg(jd) + lonDeg);
    let H = lstDeg - raDeg;
    H = ((H + 540) % 360) - 180;

    const h = H * RAD;
    const lat = latDeg * RAD;
    const dec = decDeg * RAD;

    const y = Math.sin(h);
    const x = Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(h);
    const q = Math.atan2(y, x) * DEG;
    return Number.isFinite(q) ? q : 0;
  }

  function getAladinPreviewRotationDeg(obj, vis = null) {
    if (!obj || getAladinPreviewMode() === "eq") return 0;

    const loc = getCurrentLocation?.();
    if (!loc) return 0;

    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) return 0;

    const tMs = getAladinPreviewTimeMs(obj, vis || getSelectedObjectVisibilitySafe());
    const qDeg = getParallacticAngleDeg(new Date(tMs), raDeg, decDeg, Number(loc.latitude), Number(loc.longitude));
    return Number.isFinite(qDeg) ? -qDeg : 0;
  }

  function getAladinPreviewSummary(obj, vis = null) {
    const mode = getAladinPreviewMode();
    if (mode === "eq") return { mode: "eq", timeMs: null, timeLabel: null, rotDeg: 0 };

    const tMs = getAladinPreviewTimeMs(obj, vis || getSelectedObjectVisibilitySafe());
    const loc = getCurrentLocation?.();
    const tz = NIGHT_WINDOW?.tz || loc?.timezone || "UTC";
    return {
      mode: "altaz",
      timeMs: tMs,
      timeLabel: formatLocalHM(new Date(tMs), tz),
      rotDeg: getAladinPreviewRotationDeg(obj, vis || getSelectedObjectVisibilitySafe())
    };
  }

  function ensureAladinGraphicOverlays() {
    if (!aladin || !window.A) return;

    const overlayColor = chartVar("--chart-object-current", "#ff5a5a");

    if (!aladinFrameOverlay) {
      aladinFrameOverlay = A.graphicOverlay({
        color: overlayColor,
        lineWidth: 2.2
      });
      aladin.addOverlay(aladinFrameOverlay);
    }

    if (!aladinTileOverlay) {
      aladinTileOverlay = A.graphicOverlay({
        color: overlayColor,
        lineWidth: 1.4
      });
      aladin.addOverlay(aladinTileOverlay);
    }

    if (!aladinObjectOverlay) {
      aladinObjectOverlay = A.graphicOverlay({
        color: overlayColor,
        lineWidth: 1.6
      });
      aladin.addOverlay(aladinObjectOverlay);
    }
  }

  function clearAladinOverlay() {
    aladinFrameOverlay?.removeAll?.();
    aladinTileOverlay?.removeAll?.();
    aladinObjectOverlay?.removeAll?.();
    LAST_ALADIN_OVERLAY_KEY = "";
  }

  function localOffsetToRaDec(ra0Deg, dec0Deg, eastDeg, northDeg) {
    const distDeg = Math.hypot(eastDeg, northDeg);
    if (!Number.isFinite(distDeg) || distDeg < 1e-9) {
      return [clamp360(ra0Deg), clamp(dec0Deg, -90, 90)];
    }

    const d = distDeg * RAD;
    const pa = Math.atan2(eastDeg, northDeg);
    const ra0 = ra0Deg * RAD;
    const dec0 = dec0Deg * RAD;

    const sinDec = Math.sin(dec0) * Math.cos(d) + Math.cos(dec0) * Math.sin(d) * Math.cos(pa);
    const dec = Math.asin(clamp(sinDec, -1, 1));

    const y = Math.sin(pa) * Math.sin(d) * Math.cos(dec0);
    const x = Math.cos(d) - Math.sin(dec0) * Math.sin(dec);
    const ra = ra0 + Math.atan2(y, x);

    return [clamp360(ra * DEG), dec * DEG];
  }

  function rotatedFrameOffset(xDeg, yDeg, rotDeg) {
    const t = rotDeg * RAD;
    return {
      eastDeg: (xDeg * Math.cos(t)) - (yDeg * Math.sin(t)),
      northDeg: (xDeg * Math.sin(t)) + (yDeg * Math.cos(t))
    };
  }

  function rotatedPositionAngleOffset(xDeg, yDeg, paDeg) {
    const t = paDeg * RAD;
    return {
      eastDeg: (xDeg * Math.cos(t)) + (yDeg * Math.sin(t)),
      northDeg: (-xDeg * Math.sin(t)) + (yDeg * Math.cos(t))
    };
  }

  function sampleAladinLocalPolyline(ra0Deg, dec0Deg, x0Deg, y0Deg, x1Deg, y1Deg, rotDeg) {
    const spanDeg = Math.max(Math.abs(x1Deg - x0Deg), Math.abs(y1Deg - y0Deg));
    const steps = Math.max(16, Math.ceil(spanDeg / 0.12));
    const pts = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const xDeg = x0Deg + (x1Deg - x0Deg) * t;
      const yDeg = y0Deg + (y1Deg - y0Deg) * t;
      const off = rotatedFrameOffset(xDeg, yDeg, rotDeg);
      const [raDeg, decDeg] = localOffsetToRaDec(ra0Deg, dec0Deg, off.eastDeg, off.northDeg);
      if (Number.isFinite(raDeg) && Number.isFinite(decDeg)) pts.push([raDeg, decDeg]);
    }

    return (pts.length >= 2) ? pts : null;
  }

  function addPolylineToOverlay(overlay, pts) {
    if (!overlay || !pts || pts.length < 2 || !window.A || typeof A.polyline !== "function") return;
    overlay.add(A.polyline(pts));
  }

  function getAladinObjectAxesArcmin(obj) {
    const major = Number(obj?.size_major_arcmin ?? obj?.size);
    if (!Number.isFinite(major) || major <= 0) return null;
    const minorRaw = Number(obj?.size_minor_arcmin);
    const minor = (Number.isFinite(minorRaw) && minorRaw > 0) ? minorRaw : major;
    return {
      majorArcmin: major,
      minorArcmin: minor,
      majorDeg: major / 60,
      minorDeg: minor / 60
    };
  }

  function sampleAladinObjectEllipse(ra0Deg, dec0Deg, majorDeg, minorDeg, paDeg = 0) {
    if (![ra0Deg, dec0Deg, majorDeg, minorDeg].every(Number.isFinite)) return null;
    if (majorDeg <= 0 || minorDeg <= 0) return null;

    const a = majorDeg / 2;
    const b = minorDeg / 2;
    const steps = Math.max(48, Math.ceil(Math.max(majorDeg, minorDeg) / 0.05));
    const pts = [];

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const xDeg = b * Math.cos(t);
      const yDeg = a * Math.sin(t);
      const off = rotatedPositionAngleOffset(xDeg, yDeg, Number.isFinite(paDeg) ? paDeg : 0);
      const [raDeg, decDeg] = localOffsetToRaDec(ra0Deg, dec0Deg, off.eastDeg, off.northDeg);
      if (Number.isFinite(raDeg) && Number.isFinite(decDeg)) pts.push([raDeg, decDeg]);
    }

    return (pts.length >= 3) ? pts : null;
  }

  function drawAladinFrameOverlay() {
    if (!aladinReady || !aladin || viewMode !== "image") {
      clearAladinOverlay();
      return;
    }

    const obj = getSelectedObjectSafe();
    const tileAxes = getAladinTileAxes();
    if (!obj || !tileAxes) {
      clearAladinOverlay();
      return;
    }

    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) {
      clearAladinOverlay();
      return;
    }

    ensureAladinGraphicOverlays();
    aladinFrameOverlay?.removeAll?.();
    aladinTileOverlay?.removeAll?.();
    aladinObjectOverlay?.removeAll?.();

    const objectAxes = getAladinObjectAxesArcmin(obj);
    const objectPaDeg = Number(obj?.position_angle_deg);
    const objectPts = objectAxes
      ? sampleAladinObjectEllipse(raDeg, decDeg, objectAxes.majorDeg, objectAxes.minorDeg, Number.isFinite(objectPaDeg) ? objectPaDeg : 0)
      : null;
    if (objectPts) addPolylineToOverlay(aladinObjectOverlay, objectPts);

    if (!getAladinShowFov()) {
      LAST_ALADIN_OVERLAY_KEY = JSON.stringify({
        idx: selectedObjectIdx,
        hidden: true,
        mode: getAladinPreviewMode(),
        objectMajor: objectAxes?.majorDeg?.toFixed(4) || null,
        objectMinor: objectAxes?.minorDeg?.toFixed(4) || null,
        objectPa: Number.isFinite(objectPaDeg) ? objectPaDeg.toFixed(1) : null,
        survey: $("surveySelect")?.value || ""
      });
      return;
    }

    const mosaic = getAladinMosaicCount();
    const vis = getSelectedObjectVisibilitySafe();
    const rotDeg = getAladinPreviewRotationDeg(obj, vis);
    const cols = mosaic;
    const rows = mosaic;
    const tileW = tileAxes.fovW;
    const tileH = tileAxes.fovH;
    const fullW = tileW * cols;
    const fullH = tileH * rows;
    const halfW = fullW / 2;
    const halfH = fullH / 2;

    addPolylineToOverlay(aladinFrameOverlay, sampleAladinLocalPolyline(raDeg, decDeg, -halfW, -halfH,  halfW, -halfH, rotDeg));
    addPolylineToOverlay(aladinFrameOverlay, sampleAladinLocalPolyline(raDeg, decDeg,  halfW, -halfH,  halfW,  halfH, rotDeg));
    addPolylineToOverlay(aladinFrameOverlay, sampleAladinLocalPolyline(raDeg, decDeg,  halfW,  halfH, -halfW,  halfH, rotDeg));
    addPolylineToOverlay(aladinFrameOverlay, sampleAladinLocalPolyline(raDeg, decDeg, -halfW,  halfH, -halfW, -halfH, rotDeg));

    if (mosaic > 1) {
      for (let c = 1; c < cols; c++) {
        const x = -halfW + (c * tileW);
        addPolylineToOverlay(aladinTileOverlay, sampleAladinLocalPolyline(raDeg, decDeg, x, -halfH, x, halfH, rotDeg));
      }
      for (let r = 1; r < rows; r++) {
        const y = -halfH + (r * tileH);
        addPolylineToOverlay(aladinTileOverlay, sampleAladinLocalPolyline(raDeg, decDeg, -halfW, y, halfW, y, rotDeg));
      }
    }

    LAST_ALADIN_OVERLAY_KEY = JSON.stringify({
      idx: selectedObjectIdx,
      ra: raDeg.toFixed(5),
      dec: decDeg.toFixed(5),
      tileW: tileW.toFixed(4),
      tileH: tileH.toFixed(4),
      mosaic,
      mode: getAladinPreviewMode(),
      showFov: getAladinShowFov() ? 1 : 0,
      rot: rotDeg.toFixed(1),
      objectMajor: objectAxes?.majorDeg?.toFixed(4) || null,
      objectMinor: objectAxes?.minorDeg?.toFixed(4) || null,
      objectPa: Number.isFinite(objectPaDeg) ? objectPaDeg.toFixed(1) : null,
      refTime: getAladinPreviewTimeMs(obj, vis),
      survey: $("surveySelect")?.value || ""
    });
  }

  function refreshAladinOverlay() {
    if (!aladinReady || !aladin || viewMode !== "image") {
      clearAladinOverlay();
      return;
    }

    const obj = getSelectedObjectSafe();
    const tileAxes = getAladinTileAxes();
    const raDeg = obj ? parseRaDeg(obj.ra) : null;
    const decDeg = obj ? parseDecDeg(obj.dec) : null;
    const key = JSON.stringify({
      idx: selectedObjectIdx,
      ra: Number.isFinite(raDeg) ? raDeg.toFixed(5) : null,
      dec: Number.isFinite(decDeg) ? decDeg.toFixed(5) : null,
      tileW: tileAxes?.fovW?.toFixed(4) || null,
      tileH: tileAxes?.fovH?.toFixed(4) || null,
      mosaic: getAladinMosaicCount(),
      mode: getAladinPreviewMode(),
      showFov: getAladinShowFov() ? 1 : 0,
      rot: getAladinPreviewRotationDeg(obj, getSelectedObjectVisibilitySafe()).toFixed(1),
      objectMajor: getAladinObjectAxesArcmin(obj)?.majorDeg?.toFixed(4) || null,
      objectMinor: getAladinObjectAxesArcmin(obj)?.minorDeg?.toFixed(4) || null,
      objectPa: Number.isFinite(Number(obj?.position_angle_deg)) ? Number(obj.position_angle_deg).toFixed(1) : null,
      refTime: getAladinPreviewTimeMs(obj, getSelectedObjectVisibilitySafe()),
      survey: $("surveySelect")?.value || ""
    });

    if (key === LAST_ALADIN_OVERLAY_KEY) return;
    drawAladinFrameOverlay();
  }

  function applyAladinSensorFrame() {
    const pane = $("imagePane");
    const wrap = $("aladinWrap");
    const div = $("aladinDiv");
    const controls = $("aladinFrameControls");
    if (!pane || !wrap || !div) return;

    const paneRect = pane.getBoundingClientRect();
    const availW = Math.max(220, Math.floor(pane.clientWidth || paneRect.width || 0));
    const controlsReserve = controls ? Math.max(56, (controls.offsetHeight || 0) + 10) : 0;
    const availH = Math.max(220, Math.floor((pane.clientHeight || paneRect.height || 0) - controlsReserve));

    const cssW = availW;
    const cssH = availH;

    pane.style.display = "flex";
    pane.style.flexDirection = "column";
    pane.style.alignItems = "stretch";
    pane.style.justifyContent = "stretch";
    pane.style.overflow = "hidden";
    pane.style.gap = "10px";

    wrap.style.width = `${cssW}px`;
    wrap.style.height = `${cssH}px`;
    wrap.style.maxWidth = "100%";
    wrap.style.maxHeight = "100%";
    wrap.style.margin = "0 auto";
    wrap.style.flex = "1 1 auto";

    div.style.width = "100%";
    div.style.height = "100%";
    div.style.margin = "0";

    if (controls) {
      controls.style.width = `${cssW}px`;
      controls.style.maxWidth = "100%";
    }

    LAST_ALADIN_OVERLAY_KEY = "";
  }

  function fitAladinFovToRig() {
    if (!aladin) return;

    const axes = getAladinRigAxes();
    if (!axes) {
      aladinSetFovDeg(computeRigFovDeg() * ALADIN_FRAME_MARGIN);
      return;
    }

    const minViewW = axes.fovW * ALADIN_FRAME_MARGIN;
    const minViewH = axes.fovH * ALADIN_FRAME_MARGIN;
    let seed = Math.max(minViewW, minViewH);
    aladinSetFovDeg(seed);

    const refine = (iter) => {
      if (!aladin || typeof aladin.getFov !== "function") return;
      const got = aladin.getFov();
      const currW = Array.isArray(got) ? Number(got[0]) : NaN;
      const currH = Array.isArray(got) ? Number(got[1]) : NaN;
      if (!Number.isFinite(currW) || !Number.isFinite(currH) || currW <= 0 || currH <= 0) return;

      const requiredScale = Math.max(minViewW / currW, minViewH / currH, 1);
      if (!Number.isFinite(requiredScale) || requiredScale <= 1.01 || iter >= 4) return;

      seed = Math.max(currW, currH) * requiredScale;
      aladinSetFovDeg(seed);
      requestAnimationFrame(() => refine(iter + 1));
    };

    requestAnimationFrame(() => refine(0));
  }

  function initAladinIfNeeded() {
    if (aladin || aladinInitStarted) return;

    if (!window.A || !A.init) {
      updateCaption();
      return;
    }

    aladinInitStarted = true;

    A.init.then(() => {
      applyAladinSensorFrame();
      aladin = A.aladin("#aladinDiv", {
        survey: $("surveySelect").value,
        fov: computeRigFovDeg(),
        target: "0 0"
      });
      aladinReady = true;
      ensureAladinGraphicOverlays();
      updateAladinFromSelection(true);
    }).catch(() => {
      updateCaption();
    });
  }

  function aladinSetFovDeg(fovDeg) {
    if (!aladin) return;
    if (typeof aladin.setFov === "function") aladin.setFov(fovDeg);
    else if (typeof aladin.setFoV === "function") aladin.setFoV(fovDeg);
  }

  function forceAladinVisualRefresh() {
    if (!aladin) return;

    try {
      const center = (typeof aladin.getRaDec === "function") ? aladin.getRaDec() : null;
      const fov = (typeof aladin.getFov === "function") ? aladin.getFov() : null;
      const currW = Array.isArray(fov) ? Number(fov[0]) : NaN;
      const currH = Array.isArray(fov) ? Number(fov[1]) : NaN;
      const curr = Number.isFinite(currW) && currW > 0
        ? currW
        : (Number.isFinite(currH) && currH > 0 ? currH : null);

      if (Array.isArray(center) && center.length >= 2 && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
        aladinGoto(Number(center[0]), Number(center[1]));
      }

      if (curr != null) {
        const nudged = curr * 1.0008;
        aladinSetFovDeg(nudged);
        requestAnimationFrame(() => {
          aladinSetFovDeg(curr);
          requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        });
      } else {
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      }
    } catch (_err) {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  }

  function aladinGoto(raDeg, decDeg) {
    if (!aladin) return;
    if (typeof aladin.gotoRaDec === "function") aladin.gotoRaDec(raDeg, decDeg);
    else if (typeof aladin.gotoPosition === "function") aladin.gotoPosition(raDeg, decDeg);
    else if (typeof aladin.setCenter === "function") aladin.setCenter(raDeg, decDeg);
  }

  function updateAladinFromSelection(_force) {
    if (viewMode === "image") updateCaption();
    if (!aladinReady || !aladin) return;

    const obj = getSelectedObjectSafe();
    if (!obj) {
      clearAladinOverlay();
      return;
    }

    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) {
      clearAladinOverlay();
      return;
    }

    applyAladinSensorFrame();
    ensureAladinGraphicOverlays();

    const survey = $("surveySelect").value;
    if (typeof aladin.setImageSurvey === "function") aladin.setImageSurvey(survey);

    aladinGoto(raDeg, decDeg);
    fitAladinFovToRig();
    LAST_ALADIN_OVERLAY_KEY = "";
    drawAladinFrameOverlay();
    requestAnimationFrame(() => refreshAladinOverlay());
    setTimeout(() => refreshAladinOverlay(), 120);
  }

  function updateObjectsStatus(){
    const mode = SHOW_ALL_OBJECTS ? "all objects" : "filtered";
    const q = (NAME_QUERY || "").trim();
    const qTxt = q ? ` • search: "${q}"` : "";
    const stats = (typeof LAST_FILTER_STATS === "object" && LAST_FILTER_STATS) ? LAST_FILTER_STATS : null;

    let extraTxt = "";
    if (!SHOW_ALL_OBJECTS && stats) {
      const removed = Number(stats.excludedByMinSize) || 0;
      const pool = Number(stats.preMinSizeCandidates) || 0;
      const thresholdPx = Number(stats.minSizeThresholdPx) || 0;
      extraTxt = ` • min size filtered: ${removed}`;
      if (pool > 0) extraTxt += `/${pool}`;
      if (thresholdPx > 0.05) extraTxt += ` (≥${thresholdPx.toFixed(1)} px)`;
    }

    $("objectsStatus").textContent =
      `✅ Showing ${FILTERED_INDICES.length}/${OBJECTS.length} (${mode})${qTxt}${extraTxt} • sorted by ${sortLabel()}`;
  }

  function updateShowAllBtnUI(){
    const btn = $("showAllBtn");
    if (!btn) return;
    btn.textContent = SHOW_ALL_OBJECTS ? "Show filtered objects" : "Show all deep-sky objects";
    btn.classList.toggle("active", SHOW_ALL_OBJECTS);
  }

  function wireShowAllBtn(){
    const btn = $("showAllBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      SHOW_ALL_OBJECTS = !SHOW_ALL_OBJECTS;
      updateShowAllBtnUI();

      refreshTableOnly();
      updateObjectsStatus();
    });
  }

  // -----------------------------
  // Wiring
  // -----------------------------
  function isArrowNavEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || "").toLowerCase();
    return ["input", "textarea", "select", "button"].includes(tag) || !!el.closest?.('[contenteditable="true"]');
  }

  function applyObjectSelection(idx, { scroll = true, scrollBehavior = "smooth" } = {}) {
    if (!Number.isFinite(idx)) return;
    if (!Array.isArray(FILTERED_INDICES) || !FILTERED_INDICES.includes(idx)) return;

    selectedObjectIdx = idx;
    clearNightPathOverlay();

    const tbody = $("objectsTbody");
    let selectedRow = null;
    if (tbody) {
      for (const row of tbody.querySelectorAll("tr[data-idx]")) {
        const isSelected = Number(row.dataset.idx) === idx;
        row.classList.toggle("selected", isSelected);
        if (isSelected) selectedRow = row;
      }
    }

    if (scroll && selectedRow) {
      selectedRow.scrollIntoView({ block: "nearest", behavior: scrollBehavior });
    }

    if (viewMode === "night") drawNightChart();
    if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
    if (viewMode === "image") updateAladinFromSelection(true);

    updateCaption();
    updateMobileChartInfo();
  }

  function moveSelectedObjectBy(delta) {
    if (!Array.isArray(FILTERED_INDICES) || FILTERED_INDICES.length === 0) return;

    let pos = FILTERED_INDICES.indexOf(selectedObjectIdx);
    if (pos < 0) pos = 0;
    else pos = clamp(pos + delta, 0, FILTERED_INDICES.length - 1);

    applyObjectSelection(FILTERED_INDICES[pos], { scroll: true, scrollBehavior: "smooth" });
  }

  function wireTableClick() {
    const tbody = $("objectsTbody");
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-idx]");
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;
      applyObjectSelection(idx, { scroll: true, scrollBehavior: "smooth" });
    });
  }

  function wireArrowKeyObjectNav() {
    window.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (isArrowNavEditableTarget(document.activeElement)) return;
      if (!Array.isArray(FILTERED_INDICES) || FILTERED_INDICES.length === 0) return;

      e.preventDefault();
      moveSelectedObjectBy(e.key === "ArrowUp" ? -1 : 1);
    });
  }

  function wireNameSearch(){
    const inp = $("nameSearch");
    if (!inp) return;

    const run = debounce(() => {
      NAME_QUERY = inp.value || "";
      refreshTableOnly();
      updateObjectsStatus();
    }, 80);

    inp.addEventListener("input", run);

    // Nice UX: ESC clears
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        inp.value = "";
        NAME_QUERY = "";
        refreshTableOnly();
        updateObjectsStatus();
        inp.blur();
      }
    });
  }

  function wireHeaderSort() {
    const thead = document.querySelector("thead");
    thead.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;

      const key = th.dataset.key;

      if (sortState.key === key) {
        sortState.dir = (sortState.dir === "asc") ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = (key === "visibility" || key === "snr") ? "desc" : "asc";
        if (key === "magnitude") sortState.dir = "asc";
      }

      refreshTableOnly();
      updateObjectsStatus();
    });
  }

  function wireResizeRedraw(){
    let t = null;
    window.addEventListener("resize", () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        updateAllResponsiveUI();
        if (viewMode === "night") drawNightChart();
        else if (viewMode === "year") drawYearChart();
        else updateAladinFromSelection(false);
      }, 140);
    });

    setInterval(() => {
      if (viewMode === "night") drawNightChart();
    }, 30000);
  }

  function wireNightRadios(){
    $("gridAltAz").addEventListener("change", () => { enforceMobileAltAz(); drawNightChart(); updateCaption(); });
    $("gridEqu").addEventListener("change", () => { enforceMobileAltAz(); drawNightChart(); updateCaption(); });
  }

  function wireViewModeRadios(){
    document.querySelectorAll('input[name="viewMode"]').forEach(r => {
      r.addEventListener("change", () => setViewMode(r.value));
    });
  }

  function wireSurveyDropdown(){
    $("surveySelect").addEventListener("change", () => {
      initAladinIfNeeded();
      updateAladinFromSelection(true);
      updateCaption();
    });
  }

  function wireTypeFilter(){
    $("typeFilter").addEventListener("change", () => {
      // ✅ Auto-pick survey based on Type (still allows manual survey selection afterwards)
      applyPreferredSurveyFromTypeFilter();

      // If user is currently viewing Aladin, update it immediately
      if (viewMode === "image") {
        initAladinIfNeeded();
        updateAladinFromSelection(true);
      }

      refreshTableOnly();
      updateObjectsStatus();
    });
  }

  function wireDateControls(){
    $("datePrev").addEventListener("click", async () => {
      const loc = getCurrentLocation();
      if (!loc) return;
      getBaseYmdForLocation(loc);
      await setSelectedDateIso(isoAddDays(SELECTED_DATE_ISO, -1), { switchToNight: true });
    });

    $("dateNext").addEventListener("click", async () => {
      const loc = getCurrentLocation();
      if (!loc) return;
      getBaseYmdForLocation(loc);
      await setSelectedDateIso(isoAddDays(SELECTED_DATE_ISO, +1), { switchToNight: true });
    });

    $("dateDisplay").addEventListener("click", () => {
      const picker = $("datePicker");
      if (!picker) return;
      updateDateUI();
      if (typeof picker.showPicker === "function") picker.showPicker();
      else picker.click();
    });

    $("datePicker").addEventListener("change", async () => {
      const v = $("datePicker").value;
      if (!v) return;
      await setSelectedDateIso(v, { switchToNight: true });
    });
  }

  function wireYearCanvasClick(){
    const canvas = $("yearCanvas");
    canvas.addEventListener("click", async (e) => {
      if (viewMode !== "year") return;
      if (!YEAR_DATA || !Array.isArray(YEAR_BAR_HITBOXES) || YEAR_BAR_HITBOXES.length !== 12) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let hit = null;
      for (const b of YEAR_BAR_HITBOXES) {
        if (x >= b.x && x <= (b.x + b.w) && y >= b.top && y <= b.bottom) { hit = b; break; }
      }
      if (!hit) return;

      const month = hit.idx + 1;
      const iso = ymdToIso(YEAR_DATA.year, month, 15);
      await setSelectedDateIso(iso, { switchToNight: true });
    });
  }

  function wireSkyCanvasClick(){
    const canvas = $("skyCanvas");
    if (!canvas) return;

    canvas.addEventListener("click", (e) => {
      if (viewMode !== "night") return;
      if (selectedObjectIdx == null) return;

      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const hit = findNearestNightPathPointPx(px, py);
      if (!hit) {
        clearNightPathOverlay({ redraw: true });
        return;
      }

      NIGHT_PATH_OVERLAY = {
        tMs: hit.tMs,
        objectIdx: selectedObjectIdx,
        dateIso: SELECTED_DATE_ISO
      };
      drawNightChart();
    });
  }

  // -----------------------------
  // Load JSONs
  // -----------------------------
  async function loadAllJson() {
    try {
      const data = await fetchJson("assets/locations.json");
      if (!Array.isArray(data) || data.length === 0) throw new Error("Expected an array");
      LOCATIONS = data; loadState.locations.ok = true;
    } catch (e) { loadState.locations.ok = false; loadState.locations.err = String(e?.message || e); }

    try {
      const data = await fetchJson("assets/telescopes.json");
      if (!data || !Array.isArray(data.telescopes) || !Array.isArray(data.reducers)) {
        throw new Error("Expected { telescopes: [...], reducers: [...] }");
      }
      TELESCOPES = data.telescopes;
      REDUCERS = data.reducers;

      // ✅ Add a “Custom telescope …” entry at the end
      ensureCustomTelescopeInList();

      loadState.telescopes.ok = true;
    } catch (e) {
      loadState.telescopes.ok = false; loadState.telescopes.err = String(e?.message || e);
    }

    try {
      const data = await fetchJson("assets/cameras.json");
      if (!Array.isArray(data) || data.length === 0) throw new Error("Expected an array");
      CAMERAS_ALL = data; loadState.cameras.ok = true;
    } catch (e) { loadState.cameras.ok = false; loadState.cameras.err = String(e?.message || e); }

    try {
      const data = await fetchJson("assets/deepsky_objects.json");
      if (!Array.isArray(data) || data.length === 0) throw new Error("Expected an array");
      OBJECTS = data; loadState.objects.ok = true;
    } catch (e) { loadState.objects.ok = false; loadState.objects.err = String(e?.message || e); }
  }

  async function populateAllSelects() {
    populateSelectWithStatus(
      $("locationSelect"),
      loadState.locations.ok,
      `✅ Loaded ${LOCATIONS.length} locations`,
      `❌ Locations not loaded: ${loadState.locations.err || "unknown"}`,
      LOCATIONS,
      (l) => l.name
    );

    populateSelectWithStatus(
      $("telescopeSelect"),
      loadState.telescopes.ok,
      `✅ Loaded ${TELESCOPES.length} telescopes`,
      `❌ Telescopes not loaded: ${loadState.telescopes.err || "unknown"}`,
      TELESCOPES,
      (t) => t.name
    );

    rebuildSmartCameraSet();
    rebuildCameraSelect();
    rebuildReducerSelect();

    $("mosaicLabel").textContent = `${$("mosaicRange").value}×`;
    updateAladinPreviewModeLabel();
    updateFovLabels();
    updateHorizonStatus();
    updateDateUI();

    updateAllResponsiveUI();

    if (loadState.objects.ok && loadState.locations.ok) {
      buildTypeFilterOptions();
      await recomputeVisibilityAndRender();
      drawNightChart();
      updateCaption();
      updateMobileChartInfo();
    } else {
      $("objectsStatus").textContent = `❌ Objects not loaded: ${loadState.objects.err || "unknown"}`;
      $("objectsTbody").innerHTML = `<tr><td colspan="11" class="muted" style="padding:12px;">No objects loaded.</td></tr>`;
    }
  }

  function wireEvents() {
    $("telescopeSelect").addEventListener("change", () => {
      rebuildCameraSelect();
      rebuildReducerSelect();

      // ✅ show/hide custom inputs if needed
      updateCustomTelescopeUI();

      updateAllResponsiveUI();
      updateFovLabels();
      refreshTableOnly();

      // If custom is selected, apply current input values
      updateCustomTelescopeFromInputs();
    });

    $("reducerSelect").addEventListener("change", () => { updateFovLabels(); refreshTableOnly(); });
    $("cameraSelect").addEventListener("change", () => { updateFovLabels(); refreshTableOnly(); });

    $("locationSelect").addEventListener("change", async () => {
      updateDateUI();
      await recomputeVisibilityAndRender();
      if (viewMode === "night") drawNightChart();
      if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
      if (viewMode === "image") updateAladinFromSelection(true);
      updateCaption();
      updateMobileChartInfo();
    });

    $("horizonSelect").addEventListener("change", async () => {
      const v = $("horizonSelect").value;

      if (v === "__load__") {
        rebuildHorizonSelectOptions();
        $("horizonFileInput").click();
        return;
      }

      if (v === "__clear__") {
        HORIZON_PROFILE = null;
        HORIZON_MODE = "numeric";
        $("horizonFileInput").value = "";
        updateHorizonStatus();

        await recomputeVisibilityAndRender();
        if (viewMode === "night") drawNightChart();
        if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
        updateCaption();
        updateMobileChartInfo();
        updatePlannerLinkUI({ replaceBrowserUrl: true });
        return;
      }

      if (v === "__custom__") {
        if (HORIZON_PROFILE) {
          HORIZON_MODE = "custom";
          updateHorizonStatus();
          await recomputeVisibilityAndRender();
          if (viewMode === "night") drawNightChart();
          if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
          updateCaption();
          updateMobileChartInfo();
          updatePlannerLinkUI({ replaceBrowserUrl: true });
        } else {
          HORIZON_MODE = "numeric";
          updateHorizonStatus();
        }
        updatePlannerLinkUI({ replaceBrowserUrl: true });
        return;
      }

      const n = Number(v);
      if (Number.isFinite(n)) {
        LAST_NUMERIC_HORIZON_DEG = n;
        HORIZON_MODE = "numeric";
        updateHorizonStatus();

        await recomputeVisibilityAndRender();
        if (viewMode === "night") drawNightChart();
        if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
        updateCaption();
        updateMobileChartInfo();
        updatePlannerLinkUI({ replaceBrowserUrl: true });
      }
    });

    $("minSizePercent").addEventListener("input", () => {
      updateFovLabels();
      refreshTableOnly();
    });

    $("mosaicRange").addEventListener("input", () => {
      $("mosaicLabel").textContent = `${$("mosaicRange").value}×`;
      updateFovLabels();
      LAST_ALADIN_OVERLAY_KEY = "";
      if (viewMode === "image") updateAladinFromSelection(true);
      updateCaption();
    });

    document.querySelectorAll('input[name="aladinPreviewMode"]').forEach(el => {
      el.addEventListener("change", () => {
        updateAladinPreviewModeLabel();
        LAST_ALADIN_OVERLAY_KEY = "";
        if (viewMode === "image") updateAladinFromSelection(true);
        updateCaption();
      });
    });

    $("aladinShowFovToggle")?.addEventListener("change", () => {
      LAST_ALADIN_OVERLAY_KEY = "";
      if (getAladinShowFov()) {
        if (viewMode === "image") updateAladinFromSelection(true);
      } else {
        clearAladinOverlay();
        forceAladinVisualRefresh();
      }
      updateCaption();
    });

    $("horizonFileInput").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        HORIZON_PROFILE = parseHorizonFileText(text, file.name);
        if (HORIZON_PROFILE) delete HORIZON_PROFILE.sourcePath;
        HORIZON_MODE = "custom";
        updateHorizonStatus();

        await recomputeVisibilityAndRender();
        if (viewMode === "night") drawNightChart();
        if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
        updateCaption();
        updateMobileChartInfo();
        updatePlannerLinkUI({ replaceBrowserUrl: true });
      } catch (err) {
        HORIZON_PROFILE = null;
        HORIZON_MODE = "numeric";
        updateHorizonStatus();
        updatePlannerLinkUI({ replaceBrowserUrl: true });
        alert(`Could not load horizon file:\n${err?.message || err}`);
      }
    });
  }


  // -----------------------------
  // Nightmode (persisted)
  // -----------------------------
  const LS_NIGHTMODE = "site_nightmode";

  function chartVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function isNightModeOn() {
    return document.documentElement.classList.contains("nightmode");
  }

  function setNightMode(enabled, opts = {}) {
    const { persist = true, redraw = true } = opts;
    document.documentElement.classList.toggle("nightmode", !!enabled);

    if (persist) {
      try { localStorage.setItem(LS_NIGHTMODE, enabled ? "1" : "0"); } catch (e) {}
    }

    const btn = document.getElementById("nightModeToggle");
    if (btn) {
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.classList.toggle("on", !!enabled);
    }

    if (redraw) {
      try { updateAllRangeFills(); } catch (e) {}
      try { drawNightChart(); } catch (e) {}
      try { drawYearChart(); } catch (e) {}
    }
  }

  function wireNightModeToggle() {
    const btn = document.getElementById("nightModeToggle");
    if (!btn) return;

    // Initial state from storage (fallback to current class if storage fails)
    let on = isNightModeOn();
    try {
      const v = localStorage.getItem(LS_NIGHTMODE);
      if (v === "1") on = true;
      if (v === "0") on = false;
    } catch (e) {}

    setNightMode(on, { persist: false, redraw: false });

    btn.addEventListener("click", () => {
      setNightMode(!isNightModeOn(), { persist: true, redraw: true });
    });
  }


  // -----------------------------
  // Range slider fill (Nightmode)
  // -----------------------------
  function updateRangeFill(el){
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const val = Number(el.value || 0);
    const pct = (max > min) ? ((val - min) / (max - min)) * 100 : 0;
    el.style.setProperty("--p", pct.toFixed(2) + "%");
  }

  function updateAllRangeFills(){
    document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
  }

  function wireRangeFills(){
    const ranges = document.querySelectorAll('input[type="range"]');
    ranges.forEach(r => {
      updateRangeFill(r);
      r.addEventListener("input", () => updateRangeFill(r));
      r.addEventListener("change", () => updateRangeFill(r));
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  (async function init() {
    await loadAllJson();
    await populateAllSelects();

    wireEvents();
    wireTypeFilter();
    wireTableClick();
    wireArrowKeyObjectNav();
    wireNameSearch();
    wireHeaderSort();
    wireShowAllBtn();
    updateShowAllBtnUI();
    wireResizeRedraw();
    wireNightRadios();
    wireViewModeRadios();
    wireSurveyDropdown();
    wireDateControls();
    wireYearCanvasClick();
    wireSkyCanvasClick();
    wireCustomTelescopeInputs();
    updateCustomTelescopeUI();

    // Advanced mode controls (optional)
    ensureBortleOptions();
    ensureSNRSelectOptions();
    updateAdvancedUI();
    wireAdvancedModeControls();
    await applyUrlStateFromQuery();
    wirePlannerLinkUI();
    wireNightModeToggle();
    wireRangeFills();

    $("viewNight").checked = true;
    setViewMode("night");

    updateAllResponsiveUI();
    updatePlannerLinkUI({ replaceBrowserUrl: true });
    updateCaption();
    drawNightChart();
    updateMobileChartInfo();
  })();
