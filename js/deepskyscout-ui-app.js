/* js/deepskyscout-ui-app.js */
/* DeepSkyScout planner UI: wiring, loading, nightmode, init */

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

  function wireVisibleNowToggle(){
    const toggle = $("visibleNowToggle");
    if (!toggle) return;

    toggle.checked = isVisibleNowEnabled();
    toggle.addEventListener("change", async () => {
      setVisibleNowEnabled(toggle.checked);
      clearNightPathOverlay();
      await recomputeVisibilityAndRender();
      updatePlannerLinkUI({ replaceBrowserUrl: true });
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

    $("dateTodayBtn")?.addEventListener("click", async () => {
      const loc = getCurrentLocation();
      if (!loc) return;
      await setSelectedDateIso(getTodayIsoForLocation(loc), { switchToNight: true });
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

  function wireVisibleNowAutoRefresh(){
    let busy = false;
    setInterval(async () => {
      if (busy || !isVisibleNowEnabled()) return;
      const loc = getCurrentLocation();
      if (!loc || !isSelectedDateToday(loc)) return;
      busy = true;
      try {
        await recomputeVisibilityAndRender();
      } catch (err) {
        console.warn("Visible-now auto-refresh failed:", err);
      } finally {
        busy = false;
      }
    }, 60000);
  }

  // -----------------------------
  // Init
  // -----------------------------
  (async function init() {
    await loadAllJson();
    loadVisibleNowPreference();
    await populateAllSelects();

    wireEvents();
    wireTypeFilter();
    wireTableClick();
    wireArrowKeyObjectNav();
    wireNameSearch();
    wireVisibleNowToggle();
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
    wireVisibleNowAutoRefresh();

    $("viewNight").checked = true;
    setViewMode("night");

    updateAllResponsiveUI();
    updatePlannerLinkUI({ replaceBrowserUrl: true });
    updateCaption();
    drawNightChart();
    updateMobileChartInfo();
  })();
