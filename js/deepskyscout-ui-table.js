/* js/deepskyscout-ui-table.js */
/* DeepSkyScout planner UI: table, caption, shared view helpers */

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
    const skyPhase = (typeof getSkyPhaseAtMs === "function")
      ? getSkyPhaseAtMs(overlay.tMs, loc)
      : { label: "Sky state" };

    const line1 = `Time: ${formatLocalHM(new Date(overlay.tMs), tz)}`;
    const line2 = `${skyPhase.label} • Alt: ${Math.round(aa.altDeg)}° • Az: ${Math.round(aa.azDeg)}°`;

    ctx.save();
    const fontPx = isMobileNarrow() ? 12 : 13;
    ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
    const padX = 10;
    const padY = 7;
    const lineGap = 6;
    const textW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const boxW = textW + padX * 2;
    const boxH = (fontPx * 2) + (padY * 2) + lineGap;

    let boxX = xy.x - boxW / 2;
    let boxY = xy.y - boxH - 14;

    boxX = clamp(boxX, 8, w - boxW - 8);
    boxY = clamp(boxY, 8, h - boxH - 8);

    ctx.fillStyle = "rgba(0,0,0,0.78)";
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
    ctx.textBaseline = "top";
    ctx.fillText(line1, boxX + padX, boxY + padY);

    ctx.fillStyle = skyPhase?.color || chartVar("--chart-text-muted", "rgba(255,255,255,0.82)");
    ctx.fillText(line2, boxX + padX, boxY + padY + fontPx + lineGap);

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
    const imageOnly = document.querySelectorAll(".image-only");
    const surveyWrap = $("surveyWrap");
    const chartTitleText = $("chartTitleText");
    const sepNight = $("sepNight");

    if (mode === "night") {
      nightPane.style.display = "";
      imagePane.style.display = "none";
      yearPane.style.display  = "none";
      nightOnly.forEach(el => el.style.display = "inline-flex");
      imageOnly.forEach(el => el.style.display = "none");
      sepNight.style.display = "inline-flex";
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
      imageOnly.forEach(el => el.style.display = "inline-flex");
      sepNight.style.display = "inline-flex";
      surveyWrap.style.display = "inline-flex";
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
    imageOnly.forEach(el => el.style.display = "none");
    sepNight.style.display = "none";
    surveyWrap.style.display = "none";
    chartTitleText.textContent = "Monthly Visibility";
    updateAllResponsiveUI();
    computeYearIfPossible();
    drawYearChart();
    updateCaption();
  }

