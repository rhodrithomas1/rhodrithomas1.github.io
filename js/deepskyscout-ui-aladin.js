/* js/deepskyscout-ui-aladin.js */
/* DeepSkyScout planner UI: Aladin integration and framing overlays */

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

