/* js/deepskyscout.js */
/* DeepSkyScout planner logic (extracted from inline <script> block) */

(() => {
  const $ = (id) => document.getElementById(id);

  // Normalize top nav order so it is consistent across pages:
  // Home, Astro Photos, DeepSkyScout, How it works
  try {
    const nav = document.querySelector('nav');
    if (nav) {
      const desired = [
        { href: 'index.html', text: 'Home' },
        { href: 'astro.html', text: 'Astro Photos' },
        { href: 'deepskyscout-web.html', text: 'DeepSkyScout' },
        { href: 'how-it-works.html', text: 'How it works' },
      ];

      const norm = (href) => (href || '').split('#')[0].split('?')[0].trim();
      const existing = Array.from(nav.querySelectorAll('a'));
      const activeHref = (() => {
        const a = existing.find(x => x.classList.contains('active'));
        return a ? norm(a.getAttribute('href')) : null;
      })();

      const map = new Map();
      for (const a of existing) {
        const h = norm(a.getAttribute('href'));
        if (!map.has(h)) map.set(h, a);
      }

      // Pull the core links out (so we can re-append them in the desired order)
      for (const d of desired) {
        const a = map.get(d.href);
        if (a && a.parentNode === nav) nav.removeChild(a);
      }

      for (const d of desired) {
        let a = map.get(d.href);
        if (!a) {
          a = document.createElement('a');
          a.href = d.href;
          a.textContent = d.text;
        } else {
          a.textContent = d.text;
        }
        if (activeHref && activeHref === d.href) a.classList.add('active');
        nav.appendChild(a);
      }

      // Re-append any other links afterwards, preserving original order
      for (const a of existing) {
        const h = norm(a.getAttribute('href'));
        if (!desired.some(d => d.href === h) && a.parentNode !== nav) {
          nav.appendChild(a);
        }
      }
    }
  } catch (e) { /* ignore */ }


  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  // Helpful runtime error logging (so a single JS error doesn't look like a freeze)
  window.addEventListener("error", (e) => {
    console.error("DeepSkyScout runtime error:", e?.error || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("DeepSkyScout unhandled rejection:", e?.reason || e);
  });

  let LOCATIONS = [];
  let TELESCOPES = [];
  let REDUCERS = [];

  // -----------------------------
  // Custom telescope (user-defined)
  // -----------------------------
  let CUSTOM_TELESCOPE = {
    name: "Custom telescope",
    aperture_mm: 80,
    focal_mm: 400,
    is_custom: true
  };

  let CAMERAS_ALL = [];
  let SMART_CAMERA_NAMES = new Set();

  let OBJECTS = [];
  let VIS_RESULTS = new Map();
  let FILTERED_INDICES = [];
  let selectedObjectIdx = null;

  const sortState = { key: "visibility", dir: "desc" };

  let NIGHT_WINDOW = null;
  let DAY_SPANS = [];

  const VIS_STEP_MIN = 5;

  let YEAR_DATA = null;
  let YEAR_BAR_HITBOXES = [];

  const loadState = {
    locations: { ok: false, err: "" },
    telescopes:{ ok: false, err: "" },
    cameras:   { ok: false, err: "" },
    objects:   { ok: false, err: "" }
  };

  let viewMode = "night";
  let SHOW_ALL_OBJECTS = false;

  let NAME_QUERY = "";

  // Expand common catalog words so "messier 31" == "m31", "sharpless 2-221" == "sh2-221"
  function expandCatalogWords(s){
    return String(s || "")
      .toLowerCase()
      .replace(/\bmessier\b/g, "m")
      .replace(/\bsharpless\b/g, "sh2")
      .replace(/\bnew\s*general\s*catalog(?:ue)?\b/g, "ngc")
      .replace(/\bindex\s*catalog(?:ue)?\b/g, "ic")
      .replace(/\bcaldwell\b/g, "c")
      .replace(/\bbarnard\b/g, "b");
  }

  // Normalized "haystack" form (no punctuation/spaces)
  function normSearch(s){
    return expandCatalogWords(s).replace(/[^a-z0-9]+/g, "");
  }

  // Tokenize query so multi-part searches work:
  // "m 31 andromeda" => ["m","31","andromeda"]
  function queryTokens(raw){
    const s = expandCatalogWords(raw);
    return s.split(/[^a-z0-9]+/g).filter(Boolean);
  }

  function matchesNameSearch(o){
    const toks = queryTokens(NAME_QUERY);
    if (!toks.length) return true;

    const hay = normSearch(`${o?.name ?? ""} ${o?.common_name ?? ""}`);

    // Every token must appear somewhere in name or common name
    return toks.every(t => hay.includes(normSearch(t)));
  }

  let aladin = null;
  let aladinInitStarted = false;
  let aladinReady = false;

  let HORIZON_PROFILE = null;
  let HORIZON_MODE = "numeric";
  let LAST_NUMERIC_HORIZON_DEG = 20;

  let SELECTED_DATE_ISO = null;

  function isMobileNarrow(){ return window.matchMedia("(max-width: 600px)").matches; }
  function isPhoneLike(){ return window.matchMedia("(max-width: 900px)").matches; }
  function enforceMobileAltAz(){
    if (!isMobileNarrow()) return;
    $("gridAltAz").checked = true;
    $("gridEqu").checked = false;
  }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function ymdToIso(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }

  function parseIsoYmd(iso){
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function isoAddDays(iso, deltaDays){
    const ymd = parseIsoYmd(iso);
    if (!ymd) return iso;
    const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + (deltaDays * 86400000);
    const dt = new Date(t);
    return ymdToIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function isoToNoonUtcDate(iso){
    const ymd = parseIsoYmd(iso);
    if (!ymd) return new Date();
    return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0));
  }

  function getCurrentLocation(){
    if (!LOCATIONS?.length) return null;
    const idx = Number.parseInt($("locationSelect").value, 10);
    if (Number.isFinite(idx) && LOCATIONS[idx]) return LOCATIONS[idx];
    return LOCATIONS[0] || null;
  }

  function getBaseYmdForLocation(loc){
    const tz = loc?.timezone || "UTC";
    if (SELECTED_DATE_ISO) {
      const ymd = parseIsoYmd(SELECTED_DATE_ISO);
      if (ymd) return ymd;
    }
    const ymdNow = getZonedYMD(new Date(), tz);
    SELECTED_DATE_ISO = ymdToIso(ymdNow.y, ymdNow.m, ymdNow.d);
    return ymdNow;
  }

  function formatSelectedDateForDisplay(loc){
    const tz = loc?.timezone || "UTC";
    const iso = SELECTED_DATE_ISO || ymdToIso(getZonedYMD(new Date(), tz).y, getZonedYMD(new Date(), tz).m, getZonedYMD(new Date(), tz).d);
    const dt = isoToNoonUtcDate(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday:"short", day:"2-digit", month:"short", year:"numeric" });
    return fmt.format(dt);
  }

  function updateDateUI(){
    const loc = getCurrentLocation();
    const disp = $("dateDisplay");
    const picker = $("datePicker");
    if (!loc || !disp || !picker) return;

    getBaseYmdForLocation(loc);
    disp.textContent = formatSelectedDateForDisplay(loc);
    picker.value = SELECTED_DATE_ISO || "";
  }

  async function setSelectedDateIso(newIso, { switchToNight = true } = {}){
    const ymd = parseIsoYmd(newIso);
    if (!ymd) return;

    SELECTED_DATE_ISO = newIso;
    updateDateUI();

    if (switchToNight) {
      $("viewNight").checked = true;
      setViewMode("night");
    }

    await recomputeVisibilityAndRender();

    if (viewMode === "night") drawNightChart();
    if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
    if (viewMode === "image") updateAladinFromSelection(true);
    updateCaption();
  }

  function url(rel) { return new URL(rel, window.location.href); }

  async function fetchJson(relPath) {
    const res = await fetch(url(relPath), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  }

  async function fetchText(relPath) {
    const res = await fetch(url(relPath), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  }



  // -----------------------------
  // Missing shared UI helpers
  // -----------------------------
  function debounce(fn, wait = 80){
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function clearAndAddStatusOption(sel, text){
    if (!sel) return;
    sel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = text;
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  }

  function populateSelectWithStatus(sel, ok, okMsg, errMsg, items, labeler){
    if (!sel) return;

    clearAndAddStatusOption(sel, ok ? okMsg : errMsg);

    if (!ok || !Array.isArray(items) || items.length === 0) {
      sel.disabled = true;
      return;
    }

    items.forEach((item, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = String(labeler ? labeler(item, idx) : idx);
      sel.appendChild(opt);
    });

    sel.disabled = false;
    sel.selectedIndex = 1;
  }

  function getSelected(sel, items){
    if (!Array.isArray(items) || items.length === 0) return null;
    const idx = Number.parseInt(String(sel?.value ?? ""), 10);
    if (Number.isFinite(idx) && items[idx] != null) return items[idx];
    return items[0] ?? null;
  }

  function isSmartTelescope(scope){
    return !!(scope && (scope.is_smart || scope.fixed_camera_name));
  }

  function getFixedCameraName(scope){
    const name = String(scope?.fixed_camera_name || "").trim();
    return name || null;
  }

  function ensureCustomTelescopeInList(){
    if (!Array.isArray(TELESCOPES)) TELESCOPES = [];
    const idx = TELESCOPES.findIndex(t => t?.is_custom);
    if (idx >= 0) TELESCOPES[idx] = { ...TELESCOPES[idx], ...CUSTOM_TELESCOPE };
    else TELESCOPES.push({ ...CUSTOM_TELESCOPE });
  }

  function updateCustomTelescopeFromInputs(){
    const dEl = $("customScopeDiameter");
    const fEl = $("customScopeFocal");

    const d = Number(dEl?.value);
    const f = Number(fEl?.value);

    if (Number.isFinite(d) && d > 0) CUSTOM_TELESCOPE.aperture_mm = d;
    if (Number.isFinite(f) && f > 0) CUSTOM_TELESCOPE.focal_mm = f;

    ensureCustomTelescopeInList();

    const idx = TELESCOPES.findIndex(t => t?.is_custom);
    const sel = $("telescopeSelect");
    const chosen = getSelected(sel, TELESCOPES);
    if (sel && chosen?.is_custom && idx >= 0) sel.value = String(idx);

    rebuildSmartCameraSet();
    rebuildCameraSelect();
    rebuildReducerSelect();
    updateFovLabels();
    refreshTableOnly();
    updateCaption();
    updateMobileChartInfo();
    if (viewMode === "image") updateAladinFromSelection(true);
  }

  function updateCustomTelescopeUI(){
    const wrap = $("customTelescopeFields");
    if (!wrap) return;

    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const isCustom = !!scope?.is_custom;

    wrap.style.display = isCustom ? "" : "none";

    if (isCustom) {
      if ($("customScopeDiameter")) $("customScopeDiameter").value = String(Number(scope?.aperture_mm) || CUSTOM_TELESCOPE.aperture_mm);
      if ($("customScopeFocal")) $("customScopeFocal").value = String(Number(scope?.focal_mm) || CUSTOM_TELESCOPE.focal_mm);
    }
  }

  function wireCustomTelescopeInputs(){
    ["customScopeDiameter", "customScopeFocal"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", updateCustomTelescopeFromInputs);
      el.addEventListener("change", updateCustomTelescopeFromInputs);
    });
  }

  function isDesktopWide(){
    return window.matchMedia("(min-width: 1101px)").matches;
  }

  function updateAllResponsiveUI(){
    enforceMobileAltAz();

    const hint = $("tableHint");
    if (hint) hint.textContent = isMobileNarrow() ? "Tap a row • Tap headers to sort" : "Click a row • Click headers to sort";

    updateMobileChartInfo();

    applyObjectsTableColumnVisibility();
  }


// Keep object table columns aligned when toggling Advanced mode or switching mobile/desktop.
// This uses inline display rules to avoid CSS specificity causing mismatched visible columns.
function applyObjectsTableColumnVisibility(){
  const tbody = $("objectsTbody");
  if (!tbody) return;
  const table = tbody.closest("table");
  if (!table) return;

  const adv = isAdvancedModeEnabled();
  const mob = isMobileNarrow();

  function shouldShow(el){
    let show = true;
    if (el.classList.contains('mobile-only')) show = show && mob;
    if (el.classList.contains('desktop-only')) show = show && !mob;
    if (el.classList.contains('advanced-only')) show = show && adv;
    return show;
  }

  table.querySelectorAll('thead th, tbody td').forEach((cell) => {
    cell.style.display = shouldShow(cell) ? 'table-cell' : 'none';
  });

  // If tbody currently has a single status row with colspan, keep it spanning the visible columns.
  const firstRow = tbody.querySelector('tr');
  if (firstRow && firstRow.children && firstRow.children.length === 1) {
    const onlyCell = firstRow.children[0];
    if (onlyCell && onlyCell.hasAttribute('colspan')) {
      const ths = Array.from(table.querySelectorAll('thead th'));
      let visibleCount = 0;
      for (const th of ths) if (shouldShow(th)) visibleCount++;
      if (visibleCount > 0) onlyCell.colSpan = visibleCount;
    }
  }
}

  function parseHorizonFileText(text, filename = "horizon file"){
    const pts = [];
    const lines = String(text || "").split(/\r?\n/);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith(";")) continue;

      const m = line.match(/(-?\d+(?:\.\d+)?)\s*[,;\t ]+\s*(-?\d+(?:\.\d+)?)/);
      if (!m) continue;

      let az = Number(m[1]);
      let alt = Number(m[2]);
      if (!Number.isFinite(az) || !Number.isFinite(alt)) continue;

      az = ((az % 360) + 360) % 360;
      alt = clamp(alt, -5, 89.9);
      pts.push({ az, alt });
    }

    if (pts.length < 2) throw new Error("Expected at least two azimuth/altitude rows.");

    pts.sort((a, b) => a.az - b.az);

    const deduped = [];
    for (const p of pts) {
      const prev = deduped[deduped.length - 1];
      if (prev && Math.abs(prev.az - p.az) < 1e-9) prev.alt = p.alt;
      else deduped.push(p);
    }

    if (deduped[0].az !== 0) deduped.unshift({ az: 0, alt: deduped[deduped.length - 1].alt });
    if (deduped[deduped.length - 1].az !== 360) deduped.push({ az: 360, alt: deduped[0].alt });

    return { name: filename, points: deduped };
  }

  function getHorizonFloorDeg(){
    return clamp(Number(LAST_NUMERIC_HORIZON_DEG) || 0, 0, 89);
  }

  function getHorizonAtAzFn(){
    if (HORIZON_MODE === "custom" && HORIZON_PROFILE?.points?.length) {
      const pts = HORIZON_PROFILE.points;

      return (azDeg) => {
        let az = ((Number(azDeg) % 360) + 360) % 360;

        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (az >= a.az && az <= b.az) {
            const span = Math.max(1e-9, b.az - a.az);
            const t = (az - a.az) / span;
            return a.alt + (b.alt - a.alt) * t;
          }
        }

        return pts[pts.length - 1].alt;
      };
    }

    const floor = getHorizonFloorDeg();
    return () => floor;
  }

  function rebuildHorizonSelectOptions(){
    const sel = $("horizonSelect");
    if (!sel) return;

    const current = (HORIZON_MODE === "custom" && HORIZON_PROFILE)
      ? "__custom__"
      : String(getHorizonFloorDeg());

    sel.innerHTML = "";

    [0, 10, 20, 30, 40].forEach((deg) => {
      const opt = document.createElement("option");
      opt.value = String(deg);
      opt.textContent = `${deg}°`;
      sel.appendChild(opt);
    });

    if (HORIZON_PROFILE) {
      const custom = document.createElement("option");
      custom.value = "__custom__";
      custom.textContent = `Loaded horizon profile`;
      sel.appendChild(custom);

      const clear = document.createElement("option");
      clear.value = "__clear__";
      clear.textContent = "Clear loaded horizon";
      sel.appendChild(clear);
    }

    const load = document.createElement("option");
    load.value = "__load__";
    load.textContent = "Load horizon file…";
    sel.appendChild(load);

    if ([...sel.options].some(o => o.value === current)) sel.value = current;
  }

  function updateHorizonStatus(){
    rebuildHorizonSelectOptions();

    const status = $("horizonFileStatus");
    if (status) {
      if (HORIZON_PROFILE) {
        status.textContent = (HORIZON_MODE === "custom")
          ? ` • Using file: ${HORIZON_PROFILE.name || "loaded horizon"}`
          : ` • File loaded: ${HORIZON_PROFILE.name || "loaded horizon"}`;
      } else {
        status.textContent = " • No file loaded";
      }
    }

    const sel = $("horizonSelect");
    if (sel) {
      if (HORIZON_MODE === "custom" && HORIZON_PROFILE) sel.value = "__custom__";
      else sel.value = String(getHorizonFloorDeg());
    }
  }


function normStateText(s){
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugStateText(s){
  return normStateText(s).replace(/[^a-z0-9]+/g, "");
}

function getQueryParamValue(keys){
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) {
    const v = params.get(key);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function parseBooleanParam(raw){
  if (raw == null) return null;
  const s = normStateText(raw);
  if (["1","true","yes","on"].includes(s)) return true;
  if (["0","false","no","off"].includes(s)) return false;
  return null;
}

function findItemIndexByName(items, rawName){
  if (!Array.isArray(items) || !rawName) return -1;
  const targetNorm = normStateText(rawName);
  const targetSlug = slugStateText(rawName);
  let idx = items.findIndex(item => normStateText(item?.name) === targetNorm);
  if (idx >= 0) return idx;
  return items.findIndex(item => slugStateText(item?.name) === targetSlug);
}

function findOptionValueByText(sel, rawText){
  if (!sel || !rawText) return null;
  const targetNorm = normStateText(rawText);
  const targetSlug = slugStateText(rawText);
  for (const opt of Array.from(sel.options || [])) {
    if (normStateText(opt.textContent) === targetNorm) return opt.value;
    if (slugStateText(opt.textContent) === targetSlug) return opt.value;
  }
  return null;
}

function getSafeHorizonAssetCandidates(raw){
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const low = s.toLowerCase();

  // Common share-link values: try the repo's assets path first, then site root.
  if (["1","true","yes","default","horizon.hrz"].includes(low)) {
    return ["assets/horizon.hrz", "horizon.hrz"];
  }

  // Allow only safe relative site paths.
  if (/^[a-z0-9._\/-]+$/i.test(s) && /\.(hrz|csv|txt)$/i.test(s) && !s.startsWith("/") && !s.includes("..")) {
    const out = [s];
    // If the shared path points at the common default file, try both layouts.
    if (/^(?:assets\/)?horizon\.hrz$/i.test(s)) {
      if (!out.includes("assets/horizon.hrz")) out.unshift("assets/horizon.hrz");
      if (!out.includes("horizon.hrz")) out.push("horizon.hrz");
    }
    return out;
  }

  return [];
}

function basenameFromPath(path){
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "horizon file";
}

async function loadHorizonProfileFromAsset(relPath){
  const text = await fetchText(relPath);
  const profile = parseHorizonFileText(text, basenameFromPath(relPath));
  profile.sourcePath = relPath;
  HORIZON_PROFILE = profile;
  HORIZON_MODE = "custom";
  updateHorizonStatus();
  return profile;
}

async function loadFirstAvailableHorizonProfile(paths){
  const tried = [];
  for (const relPath of (paths || [])) {
    if (!relPath || tried.includes(relPath)) continue;
    tried.push(relPath);
    try {
      return await loadHorizonProfileFromAsset(relPath);
    } catch (err) {
      console.warn(`Could not load horizon asset ${relPath}:`, err);
    }
  }
  if (tried.length) throw new Error(`Could not load any horizon asset: ${tried.join(', ')}`);
  return null;
}

function getCurrentPlannerCameraName(){
  const scope = getSelected($("telescopeSelect"), TELESCOPES);
  if (isSmartTelescope(scope)) return getFixedCameraName(scope) || null;
  const cam = getSelectedCamera();
  return cam?.name || null;
}

function getCurrentHorizonSharePath(){
  if (HORIZON_MODE === "custom" && HORIZON_PROFILE?.sourcePath && /^assets\//i.test(HORIZON_PROFILE.sourcePath)) {
    return HORIZON_PROFILE.sourcePath;
  }
  return null;
}

function buildPlannerPermalink({ includeDefaultAssetHorizon = false } = {}){
  const u = new URL(window.location.href);
  u.search = "";
  const params = u.searchParams;
  if (isAdvancedModeEnabled()) params.set("advanced", "1");
  const loc = getSelected($("locationSelect"), LOCATIONS);
  if (loc?.name) params.set("location", loc.name);
  const scope = getSelected($("telescopeSelect"), TELESCOPES);
  if (scope?.name) params.set("telescope", scope.name);
  const reducer = getSelectedReducer();
  if (reducer?.name) params.set("reducer", reducer.name);
  const camName = getCurrentPlannerCameraName();
  if (camName) params.set("camera", camName);
  if (scope?.is_custom) {
    const ap = Number(CUSTOM_TELESCOPE.aperture_mm);
    const fl = Number(CUSTOM_TELESCOPE.focal_mm);
    if (Number.isFinite(ap) && ap > 0) params.set("custom_aperture", String(ap));
    if (Number.isFinite(fl) && fl > 0) params.set("custom_focal", String(fl));
  }
  if (isAdvancedModeEnabled()) {
    params.set("bortle", String(getBortleValue()));
    params.set("rgb", String(getSNRBroadbandBand() || "V"));
    params.set("ha", String(getSNRNebulaBandpassNm() || 20));
  }
  const horizonPath = includeDefaultAssetHorizon ? "assets/horizon.hrz" : getCurrentHorizonSharePath();
  if (horizonPath) params.set("horizon", horizonPath);
  return u.toString();
}

function replaceBrowserUrlFromState(){
  try { window.history.replaceState(null, "", buildPlannerPermalink()); } catch (_err) {}
}

function updatePlannerLinkUI({ replaceBrowserUrl = false } = {}){
  if (replaceBrowserUrl) replaceBrowserUrlFromState();
}


function wirePlannerLinkUI(){
  const refresh = debounce(() => updatePlannerLinkUI({ replaceBrowserUrl: true }), 80);
  ["advancedToggle","locationSelect","telescopeSelect","reducerSelect","cameraSelect","bortleSelect","snrBroadbandSelect","snrNebulaBandpassSelect","customScopeDiameter","customScopeFocal"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", refresh);
    el.addEventListener("input", refresh);
  });
  updatePlannerLinkUI({ replaceBrowserUrl: true });
}

async function applyUrlStateFromQuery(){
  const advanced = parseBooleanParam(getQueryParamValue(["advanced", "adv"]));
  if (advanced != null) {
    const advToggle = $("advancedToggle");
    if (advToggle) advToggle.checked = advanced;
    setAdvancedModeEnabled(advanced);
  }
  const locationRaw = getQueryParamValue(["location", "loc"]);
  if (locationRaw) {
    const idx = findItemIndexByName(LOCATIONS, locationRaw);
    if (idx >= 0) $("locationSelect").value = String(idx);
  }
  const telescopeRaw = getQueryParamValue(["telescope", "scope"]);
  if (telescopeRaw) {
    const idx = findItemIndexByName(TELESCOPES, telescopeRaw);
    if (idx >= 0) $("telescopeSelect").value = String(idx);
  }
  const apRaw = Number(getQueryParamValue(["custom_aperture", "aperture"]));
  const flRaw = Number(getQueryParamValue(["custom_focal", "focal"]));
  if (Number.isFinite(apRaw) && apRaw > 0 && $("customScopeDiameter")) $("customScopeDiameter").value = String(apRaw);
  if (Number.isFinite(flRaw) && flRaw > 0 && $("customScopeFocal")) $("customScopeFocal").value = String(flRaw);
  updateCustomTelescopeFromInputs();
  updateCustomTelescopeUI();
  rebuildCameraSelect();
  rebuildReducerSelect();
  const reducerRaw = getQueryParamValue(["reducer"]);
  if (reducerRaw) {
    const reducerVal = findOptionValueByText($("reducerSelect"), reducerRaw);
    if (reducerVal != null && !$("reducerSelect").disabled) $("reducerSelect").value = reducerVal;
  }
  const cameraRaw = getQueryParamValue(["camera", "cam"]);
  if (cameraRaw) {
    const camVal = findOptionValueByText($("cameraSelect"), cameraRaw);
    if (camVal != null && !$("cameraSelect").disabled) $("cameraSelect").value = camVal;
  }
  const bortleRaw = Number(getQueryParamValue(["bortle"]));
  if (Number.isFinite(bortleRaw) && bortleRaw >= 1 && bortleRaw <= 9 && $("bortleSelect")) {
    $("bortleSelect").value = String(Math.round(bortleRaw));
    updateBortleSQMLabel();
  }
  const rgbRaw = String(getQueryParamValue(["rgb", "broadband"]) || "").toUpperCase();
  if (["B","V","R"].includes(rgbRaw) && $("snrBroadbandSelect")) $("snrBroadbandSelect").value = rgbRaw;
  const haRaw = String(getQueryParamValue(["ha", "halpha", "bandpass"]) || "");
  if (["20","9","6","3"].includes(haRaw) && $("snrNebulaBandpassSelect")) $("snrNebulaBandpassSelect").value = haRaw;
  const horizonCandidates = getSafeHorizonAssetCandidates(getQueryParamValue(["horizon"]));
  if (horizonCandidates.length) {
    try { await loadFirstAvailableHorizonProfile(horizonCandidates); } catch (err) { console.warn("Could not auto-load horizon from URL:", err); }
  }
  updateFovLabels();
  updateDateUI();
  SNR_CACHE.clear();
  await recomputeVisibilityAndRender();
  if (viewMode === "night") drawNightChart();
  if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
  if (viewMode === "image") updateAladinFromSelection(true);
  updateCaption();
  updateMobileChartInfo();
  updatePlannerLinkUI({ replaceBrowserUrl: true });
}

  function safe(v) {
    if (v === null || v === undefined || v === "") return "—";
    return String(v);
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function parseMagnitude(val) {
    if (val === null || val === undefined) return NaN;
    if (typeof val === "string" && val.trim() === "") return NaN;
    const n = Number(val);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatMagnitude(val) {
    const n = parseMagnitude(val);
    return Number.isFinite(n) ? n.toFixed(2) : "—";
  }

  
  // -----------------------------
  // Magnitudes (banded)
  // -----------------------------
  // Objects now store magnitudes per band: `mag_bands: { V, B, R }`.
  // We display/sort using the first available band in the priority order below.
  const MAG_BAND_PRIORITY = ["V", "B", "R"];

  function getMagBandInfo(o){
    const mb = o?.mag_bands;
    if (mb && typeof mb === "object") {
      for (const b of MAG_BAND_PRIORITY) {
        const raw = mb[b];
        if (raw === null || raw === undefined || raw === "") continue;
        const v = Number(raw);
        if (Number.isFinite(v)) return { band: b, mag: v };
      }
    }
    // Backwards-compatible fallback (if any legacy files still have `magnitude`)
    const rawLegacy = o?.magnitude;
    if (rawLegacy !== null && rawLegacy !== undefined && rawLegacy !== "") {
      const legacy = Number(rawLegacy);
      if (Number.isFinite(legacy)) return { band: "", mag: legacy };
    }
    return null;
  }

  function getMagnitudeForSort(o){
    const info = getMagBandInfo(o);
    return info ? info.mag : NaN;
  }

  function formatObjectMagnitude(o){
    const info = getMagBandInfo(o);
    if (!info) return "—";
    const magTxt = info.mag.toFixed(2);
    return info.band ? `${magTxt} ${info.band}` : magTxt;
  }

  // ----------------------
  
  // -----------------------------
  // Emission line fluxes (erg/s/cm²)
  // -----------------------------
  // New schema in JSON:
  //   "line_flux_erg_s_cm2": { "Halpha": <float>, "OIII": <float>, "SII": <float> }
  // Legacy schema still accepted:
  //   "line_flux": { "ha": <float>, "oiii": <float>, "sii": <float> }
  const LINE_PRIORITY = ["Halpha", "OIII", "SII", "ha", "oiii", "sii"];

  function getLineFluxMap(o){
    const lf = o?.line_flux_erg_s_cm2 ?? o?.line_flux ?? o?.lineFlux ?? null;
    return (lf && typeof lf === "object") ? lf : null;
  }

  function getLineFluxInfo(o){
    const lf = getLineFluxMap(o);
    if (!lf) return null;

    const norm = {
      Halpha: lf.Halpha ?? lf.halpha ?? lf.Ha ?? lf.ha ?? lf.HA ?? lf["H-alpha"] ?? lf["Hα"],
      OIII:   lf.OIII   ?? lf.oiii   ?? lf["O-III"] ?? lf["[OIII]"] ?? lf["OIII 5007"],
      SII:    lf.SII    ?? lf.sii    ?? lf["S-II"]  ?? lf["[SII]"]
    };

    for (const line of ["Halpha", "OIII", "SII"]) {
      const v = Number(norm[line]);
      if (Number.isFinite(v) && v > 0) return { line, flux: v };
    }

    // Fallback: first positive numeric entry
    for (const [k, val] of Object.entries(lf)) {
      const v = Number(val);
      if (Number.isFinite(v) && v > 0) return { line: String(k), flux: v };
    }
    return null;
  }

  // Legacy helper (kept for older code paths)
  function getLineFlux(o, lineKey){
    const lf = getLineFluxMap(o);
    if (!lf) return null;
    const v = Number(lf[lineKey]);
    return (Number.isFinite(v) && v > 0) ? v : null;
  }

  function formatLineFlux(o){
    const info = getLineFluxInfo(o);
    if (!info) return "—";
    return `${info.line}: ${info.flux.toExponential(2)} erg/s/cm²`;
  }

  // -----------------------------
  // -----------------------------
  // Advanced mode + SNR (ranking)
  // -----------------------------
  //
  // This is an *approximate* physics-based SNR estimate intended for ranking.
  // It converts:
  //   - object brightness (either integrated line flux or integrated magnitude)
  //   - sky brightness (Bortle -> SQM -> AB flux density)
  // into photon counts over the *visible time above your horizon*.
  // Then uses: SNR = S / sqrt(S + B)
  //
  // Notes:
  // - Ignores read noise/dark current/seeing/PSF/aperture losses.
  // - Treats objects as aperture-summed over their ellipse size.
  // - Uses simple atmospheric extinction via airmass based on avg altitude.

  // AB zero point: 3631 Jy
  const AB_FNU0_W_M2_HZ = 3631e-26; // W / m^2 / Hz
  const C_MS = 2.99792458e8;
  const H_J_S = 6.62607015e-34;

  // Approx Bortle -> SQM (mag/arcsec^2). Tweak if you want.
  const BORTLE_TO_SQM = {
    1: 21.99,
    2: 21.75,
    3: 21.33,
    4: 20.91,
    5: 20.49,
    6: 19.93,
    7: 19.43,
    8: 18.94,
    9: 18.38,
  };

  // Wavelength defaults for bands/lines (nm)
  const BAND_LAMBDA_NM = { B: 440, V: 550, R: 650 };
  const LINE_LAMBDA_NM = { Halpha: 656.3, OIII: 500.7, SII: 672.0 };

  function photonEnergyJ(lambdaNm){
    const lam = lambdaNm * 1e-9;
    return (H_J_S * C_MS) / lam;
  }

  // Kasten & Young (1989) airmass approximation
  function airmassFromAltDeg(altDeg){
    const alt = Math.max(1, Math.min(90, Number(altDeg) || 0));
    const z = 90 - alt;
    const zr = z * RAD;
    const cosz = Math.cos(zr);
    return 1 / (cosz + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  }

  function telescopeAreaM2(scope){
    const dmm = Number(scope?.aperture_mm);
    if (!Number.isFinite(dmm) || dmm <= 0) return null;
    const d = dmm / 1000.0;
    return Math.PI * Math.pow(d/2, 2);
  }

  function objectEllipseAreaArcsec2(o){
    const majorArcmin = Number(o?.size_major_arcmin) || Number(o?.size) || 0;
    const minorArcmin = Number(o?.size_minor_arcmin) || Number(o?.size) || majorArcmin;
    const maj = Math.max(0, majorArcmin) * 60;
    const minr = Math.max(0, minorArcmin) * 60;
    if (!(maj > 0 && minr > 0)) return null;
    return Math.PI * (maj/2) * (minr/2);
  }

  function magToPhotonFluxTotal(mag, lambdaNm, bandpassNm){
    if (!Number.isFinite(mag)) return null;
    const lam = lambdaNm * 1e-9;
    const fnu = AB_FNU0_W_M2_HZ * Math.pow(10, -0.4 * mag); // W/m2/Hz
    const flambda = fnu * (C_MS / (lam * lam)); // W/m2/m
    const flambda_nm = flambda * 1e-9; // W/m2/nm
    const F = flambda_nm * bandpassNm; // W/m2 (integrated)
    const eph = photonEnergyJ(lambdaNm);
    return F / eph; // photons/s/m2
  }

  function sqmToSkyPhotonFluxPerArcsec2(sqm, lambdaNm, bandpassNm){
    if (!Number.isFinite(sqm)) return null;
    const lam = lambdaNm * 1e-9;
    const fnu = AB_FNU0_W_M2_HZ * Math.pow(10, -0.4 * sqm); // W/m2/Hz/arcsec2
    const flambda = fnu * (C_MS / (lam * lam)); // W/m2/m/arcsec2
    const flambda_nm = flambda * 1e-9; // W/m2/nm/arcsec2
    const F = flambda_nm * bandpassNm; // W/m2/arcsec2
    const eph = photonEnergyJ(lambdaNm);
    return F / eph; // photons/s/m2/arcsec2
  }

  // Line flux is stored as erg/s/cm^2 (integrated over object).
  // Convert to photons/s/m^2.
  function lineFluxToPhotonFluxTotal(fluxErgSPerCm2, lambdaNm){
    const f = Number(fluxErgSPerCm2);
    if (!Number.isFinite(f) || f <= 0) return null;
    const Wm2 = f * 1e-3; // (erg/s/cm^2) -> W/m^2
    const eph = photonEnergyJ(lambdaNm);
    return Wm2 / eph; // photons/s/m2
  }

  // Robust line-flux getter (supports different key spellings)
  function getLineFluxMap(o){
    const lf = o?.line_flux_erg_s_cm2;
    if (!lf || typeof lf !== 'object') return {};
    const out = {};
    for (const [k,v] of Object.entries(lf)) {
      const val = Number(v);
      if (!Number.isFinite(val) || val <= 0) continue;
      const kk = String(k).toLowerCase();
      if (kk.includes('halpha') || kk in {'ha':1,'hα':1}) out.Halpha = val;
      else if (kk.includes('oiii') || kk.includes('o3') || kk.includes('5007')) out.OIII = val;
      else if (kk.includes('sii') || kk.includes('6716') || kk.includes('6731')) out.SII = val;
    }
    return out;
  }

  function isNebulaLike(o){
    const t = String(o?.type ?? '').toLowerCase();
    const st = String(o?.subtype ?? '').toLowerCase();
    const n = String(o?.name ?? '').toLowerCase();
    return (
      t.includes('neb') || st.includes('neb') ||
      t.includes('hii') || st.includes('hii') ||
      t.includes('planetary') || st.includes('planetary') ||
      t.includes('pn') || st.includes('pn') ||
      t.includes('snr') || st.includes('snr') ||
      n.startsWith('sh2')
    );
  }

  function isAdvancedModeEnabled(){
    return String(localStorage.getItem('ds_advanced') || '0') === '1';
  }

  function setAdvancedModeEnabled(enabled){
    localStorage.setItem('ds_advanced', enabled ? '1' : '0');

    const wrap = $('advancedControlsWrap');
    if (wrap) wrap.style.display = enabled ? '' : 'none';

    const hint = $('advancedColumnsHint');
    if (hint) hint.style.display = enabled ? '' : 'none';

    document.body.classList.toggle('advanced-on', !!enabled);

    // force a re-render so columns appear/disappear
    SNR_CACHE.clear();
    refreshTableOnly();
    applyObjectsTableColumnVisibility();
    updateObjectsStatus();
    updateCaption();
    updateMobileChartInfo();
  }

  function getBortleValue(){
    const el = $('bortleSelect');
    const b = Number(el?.value || 4);
    return Number.isFinite(b) ? Math.max(1, Math.min(9, b)) : 4;
  }

  function getSQMValue(){
    const b = getBortleValue();
    return BORTLE_TO_SQM[b] ?? 20.9;
  }

  function updateBortleSQMLabel(){
    const el = $('bortleSQMLabel');
    if (!el) return;
    const sqm = getSQMValue();
    el.textContent = ` • SQM: ${sqm.toFixed(2)} mag/arcsec²`;
  }


  // Populate/refresh the Bortle dropdown labels to include SQM, without changing the stored value.
  function ensureBortleOptions(){
    const sel = $("bortleSelect");
    if (!sel) return;

    // If the HTML already has options, keep the values but rewrite labels.
    const vals = [];
    for (const opt of Array.from(sel.options)) {
      const v = Number(opt.value);
      if (Number.isFinite(v) && v >= 1 && v <= 9) vals.push(v);
    }

    const keepCurrent = sel.value;

    // If nothing usable exists, build 1..9.
    if (vals.length === 0) {
      sel.innerHTML = "";
      for (let b = 1; b <= 9; b++) {
        const opt = document.createElement('option');
        opt.value = String(b);
        sel.appendChild(opt);
      }
    }

    // Rewrite labels with SQM.
    for (const opt of Array.from(sel.options)) {
      const b = Number(opt.value);
      if (!Number.isFinite(b) || b < 1 || b > 9) continue;
      const sqm = BORTLE_TO_SQM[b];
      const sqmTxt = Number.isFinite(sqm) ? `${sqm.toFixed(1)} mag/arcsec²` : "—";
      opt.textContent = `Bortle ${b} (≈ ${sqmTxt})`;
    }

    if (keepCurrent && Array.from(sel.options).some(o => o.value === keepCurrent)) sel.value = keepCurrent;
    updateBortleSQMLabel();
  }

  // Apply the current advanced-mode state to the DOM (columns + panel) and refresh derived values.
  function updateAdvancedUI(){
    const enabled = isAdvancedModeEnabled();

    // Body class controls CSS visibility for .advanced-only
    document.body.classList.toggle('advanced-on', enabled);

    // Toggle the advanced panel block
    const panel = $("advancedControlsWrap") || $("advancedPanel");
    if (panel) panel.style.display = enabled ? "" : "none";

    // Sync the checkbox
    const cb = $("advancedToggle");
    if (cb) cb.checked = enabled;

    // Keep Bortle/SNR selects coherent
    ensureBortleOptions();
    ensureSNRSelectOptions();

    // Refresh the table so the SNR column updates instantly
    refreshTableOnly();
    applyObjectsTableColumnVisibility();
    updateObjectsStatus();
  }

  // Back-compat wrapper: earlier revisions called this name.
  function wireAdvancedModeControls(){
    wireAdvancedModeToggle();

    // If the user changes any advanced inputs, refresh SNR/rows.
    const rerun = () => {
      if (!isAdvancedModeEnabled()) return;
      SNR_CACHE.clear();
      refreshTableOnly();
      updateObjectsStatus();
      updateCaption();
      updateMobileChartInfo();
    };

    const ids = ["bortleSelect","snrBroadbandSelect","snrNebulaBandpassSelect"];
    for (const id of ids) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('change', rerun);
      el.addEventListener('input', rerun);
    }

    // Make sure initial UI state is applied
    updateAdvancedUI();
  }

  const RGB_FILTER_TO_BAND = { B: 'B', V: 'V', R: 'R' };
  const BANDPASS_NM = {
    B: 90.0,
    V: 85.0,
    R: 150.0,
    I: 150.0,
    g: 140.0,
    r: 140.0,
    i: 150.0
  };

  function getSNRBroadbandBand(){
    const el = $('snrBroadbandSelect');
    const v = String(el?.value || 'V').toUpperCase();
    return RGB_FILTER_TO_BAND[v] ? v : 'V';
  }

  function getPreferredMagBandInfo(o, preferredBand){
    const mb = o?.mag_bands;
    if (!mb || typeof mb !== 'object') return null;
    const exactRaw = mb[preferredBand];
    if (exactRaw === null || exactRaw === undefined || exactRaw === '') return null;
    const exactVal = Number(exactRaw);
    if (!Number.isFinite(exactVal)) return null;
    return { band: preferredBand, mag: exactVal, requestedBand: preferredBand };
  }

  function getBroadbandBandpassNm(band){
    return BANDPASS_NM[band] || 100.0;
  }

  function getSNRNebulaBandpassNm(){
    const el = $('snrNebulaBandpassSelect');
    const raw = Number(el?.value);
    if (raw === 20 || raw === 9 || raw === 6 || raw === 3) return raw;

    const scope = getSelected($('telescopeSelect'), TELESCOPES);
    return isSmartTelescope(scope) ? 20 : 6;
  }

  function getObjectSNRRigMode(o){
    return isNebulaLike(o) ? 'narrowband' : 'broadband';
  }

  function getRigBandpassNm(scope, rigMode, broadbandBand = 'V'){
    if (rigMode === 'narrowband') return getSNRNebulaBandpassNm();
    return getBroadbandBandpassNm(broadbandBand);
  }

  function getRigEfficiency(scope, rigMode){
    if (isSmartTelescope(scope)) return (rigMode === 'narrowband') ? 0.22 : 0.28;
    return (rigMode === 'narrowband') ? 0.30 : 0.35;
  }

  const SNR_CACHE = new Map();
  const SNR_SCORE_CAP = 10000;

  // -----------------------------
  // Moonlight penalty for SNR (sky background boost)
  // -----------------------------
  // We model moonlight as an *additional* sky background component (photons/s/m^2/arcsec^2)
  // that depends on:
  //  - lunar illumination (phase)
  //  - lunar altitude
  //  - angular separation between Moon and target
  // and is averaged across the times the target is above your (custom) horizon during the night.
  //
  // The penalty is applied much more strongly to broadband than narrowband.

  const MOON_SNR_SENSITIVITY = { broadband: 1.0, narrowband: 0.25 };

  function getMoonTrackSpanForCurrentNight(){
    if (!NIGHT_WINDOW) return null;
    let trackStart = NIGHT_WINDOW.startUtc.getTime();
    let trackEnd = NIGHT_WINDOW.endUtc.getTime();
    const minSpan = 24*3600000;
    const span = trackEnd - trackStart;
    if (span < minSpan) {
      const extra = Math.floor((minSpan - span) / 2);
      trackStart -= extra;
      trackEnd += extra;
    }
    const stepMs = Math.max(1, VIS_STEP_MIN) * 60 * 1000;
    return { trackStart, trackEnd, stepMs };
  }

  function moonDeltaSkyMag(illumFrac, sepDeg, moonAltDeg){
    const illum = clamp(Number(illumFrac) || 0, 0, 1);
    const sep = clamp(Number(sepDeg) || 180, 0.5, 180);
    const alt = clamp(Number(moonAltDeg) || -90, -5, 90);
    if (illum <= 0 || alt <= 0) return 0;

    // Heuristic model: full Moon high in the sky can brighten the background by several mag/arcsec^2,
    // and the effect increases strongly as the Moon approaches the target.
    const bright = Math.pow(illum, 1.4);                 // phase weight
    const altF = Math.pow(Math.sin(alt * RAD), 1.3);     // altitude weight

    const near = 1 / (1 + Math.pow(sep / 30, 2));        // strong near-target scattering
    const wide = 0.5 / (1 + Math.pow(sep / 90, 2));      // broad-field sky brightening

    const base = 3.6; // mag/arcsec^2 boost at full Moon, high altitude, very close
    const dm = base * bright * altF * (near + wide);
    return clamp(dm, 0, 4.5);
  }

  function computeMoonExtraSkyFluxPerArcsec2AvgForObject(loc, o, lambdaNm, bandpassNm, mode){
    try {
      if (!loc || !o || !NIGHT_WINDOW) return 0;

      const span = getMoonTrackSpanForCurrentNight();
      if (!span) return 0;

      const track = getMoonTrackForWindow(loc, span.trackStart, span.trackEnd, span.stepMs);
      const illum = Number(track?.phase?.illumFrac) || 0;
      if (illum < 0.01) return 0;

      const raObj = parseRaDeg(o?.ra);
      const decObj = parseDecDeg(o?.dec);
      if (raObj == null || decObj == null) return 0;

      const latDeg = Number(loc.latitude);
      const lonDeg = Number(loc.longitude);
      if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return 0;

      const darkSqm = (BORTLE_TO_SQM[1] ?? 21.99);
      const darkFlux = sqmToSkyPhotonFluxPerArcsec2(darkSqm, lambdaNm, bandpassNm);
      if (!(Number.isFinite(darkFlux) && darkFlux > 0)) return 0;

      const sens = (mode === 'narrowband') ? MOON_SNR_SENSITIVITY.narrowband : MOON_SNR_SENSITIVITY.broadband;
      const horizonFn = getHorizonAtAzFn();

      let sumExtra = 0;
      let sumT = 0;

      const times = track?.times || [];
      const pts = track?.pts || [];
      const moonRa = track?.moonRa || [];
      const moonDec = track?.moonDec || [];

      for (let i = 0; i < times.length - 1; i++) {
        const t0 = times[i];
        const t1 = times[i+1];
        const dt = (t1 - t0) / 1000;
        if (!(dt > 0)) continue;

        const tMid = (t0 + t1) / 2;
        if (isDayMs(tMid)) continue;

        // Only count when the target itself is above the selected horizon
        const aaObj = raDecToAltAz(new Date(tMid), raObj, decObj, latDeg, lonDeg);
        const hz = horizonFn(aaObj.azDeg);
        if (aaObj.altDeg < hz) continue;

        const moonAlt = ((pts[i]?.altDeg ?? -90) + (pts[i+1]?.altDeg ?? -90)) * 0.5;
        if (moonAlt <= 0) continue; // Moon below horizon

        const sep = angularSeparationDeg(raObj, decObj, moonRa[i], moonDec[i]);
        const dm = moonDeltaSkyMag(illum, sep, moonAlt) * sens;
        if (!(dm > 0)) continue;

        const mul = Math.pow(10, 0.4 * dm);
        const extra = darkFlux * (mul - 1);
        if (!(Number.isFinite(extra) && extra > 0)) continue;

        sumExtra += extra * dt;
        sumT += dt;
      }

      return (sumT > 0) ? (sumExtra / sumT) : 0;
    } catch (e) {
      console.warn('Moon sky penalty error:', e);
      return 0;
    }
  }

  function computeSNRScoreForIdx(idx){
    if (!isAdvancedModeEnabled()) return null;

    const o = OBJECTS?.[idx];
    if (!o) return null;

    const vis = VIS_RESULTS.get(idx);
    const tSec = Number(vis?.visibleSec ?? 0);
    if (!(tSec > 0)) return null;

    const scope = getSelected($('telescopeSelect'), TELESCOPES);
    const red = getSelectedReducer();
    const cam = getSelectedCamera();

    const bortle = getBortleValue();
    const sqm = getSQMValue();

    const mode = getObjectSNRRigMode(o);
    const lineWanted = (mode === 'narrowband') ? 'Halpha' : null;
    const broadbandBand = getSNRBroadbandBand();
    const broadbandMagInfo = (mode === 'broadband') ? getPreferredMagBandInfo(o, broadbandBand) : null;
    const actualBroadbandBand = broadbandMagInfo?.band || broadbandBand;
    const bandpassNm = getRigBandpassNm(scope, mode, actualBroadbandBand);
    const eff = getRigEfficiency(scope, mode);
    const nebulaBandpassNm = getSNRNebulaBandpassNm();

    // caching key (only recompute when inputs change)
    const key = JSON.stringify({
      idx,
      mode,
      lineWanted,
      bandpassNm,
      broadbandBand,
      actualBroadbandBand,
      nebulaBandpassNm,
      bortle,
      sqm,
      dateIso: SELECTED_DATE_ISO || '',
      locLat: Number(getCurrentLocation()?.latitude) || 0,
      locLon: Number(getCurrentLocation()?.longitude) || 0,
      horizonMode: HORIZON_MODE || '',
      horizonFloor: getHorizonFloorDeg(),
      horizonName: HORIZON_PROFILE?.name || '',
      moonSpan: (getMoonTrackSpanForCurrentNight()?.trackStart || 0) + ',' + (getMoonTrackSpanForCurrentNight()?.trackEnd || 0),
      scope: scope?.name || '',
      d: Number(scope?.aperture_mm) || 0,
      f: Number(scope?.focal_mm) || 0,
      red: Number(red?.factor) || 1,
      cam: cam?.name || '',
      t: Math.round(tSec),
    });

    if (SNR_CACHE.has(key)) return SNR_CACHE.get(key);

    const A = telescopeAreaM2(scope);
    const objArea = objectEllipseAreaArcsec2(o);

    if (!A) { SNR_CACHE.set(key, null); return null; }
    if (!(Number.isFinite(objArea) && objArea > 0)) { SNR_CACHE.set(key, null); return null; }

    // Altitude/airmass factor
    const alt = (Number.isFinite(vis?.avgAltDeg) ? vis.avgAltDeg : vis?.maxAltDeg);
    const X = airmassFromAltDeg(alt || 45);
    const kMag = (mode === 'narrowband') ? 0.12 : 0.20;
    const trans = Math.pow(10, -0.4 * kMag * (X - 1));

    // Pick wavelength
    let lambdaNm = 550;
    if (mode === 'narrowband') lambdaNm = LINE_LAMBDA_NM.Halpha || 656.3;
    else {
      lambdaNm = BAND_LAMBDA_NM[actualBroadbandBand] || 550;
    }

    // Signal photons
    let S_phot_per_s_m2 = null;
    if (mode === 'narrowband') {
      const lf = getLineFluxMap(o);
      const fLine = lf.Halpha;
      if (Number.isFinite(fLine) && fLine > 0) {
        S_phot_per_s_m2 = lineFluxToPhotonFluxTotal(fLine, lambdaNm);
      }
    }

    // fallback: integrated magnitude is only valid for broadband mode
    if (S_phot_per_s_m2 == null && mode === 'broadband') {
      const mag = broadbandMagInfo?.mag;
      if (Number.isFinite(mag)) {
        S_phot_per_s_m2 = magToPhotonFluxTotal(mag, lambdaNm, bandpassNm);
      }
    }

    if (S_phot_per_s_m2 == null) { SNR_CACHE.set(key, null); return null; }

    // Sky photons per arcsec^2
    const sky_phot_per_s_m2_arcsec2 = sqmToSkyPhotonFluxPerArcsec2(sqm, lambdaNm, bandpassNm);
    if (sky_phot_per_s_m2_arcsec2 == null) { SNR_CACHE.set(key, null); return null; }

    const t = tSec;
    // Convert integrated fluxes to a *surface brightness* proxy, then estimate SNR
    // for a small measurement aperture (in pixels). This avoids silly 999+ SNR values
    // from summing the entire object.

    const scaleArcsecPerPx = computeImageScaleArcsecPerPixel();
    const pixAreaArcsec2 = (scaleArcsecPerPx && Number.isFinite(scaleArcsecPerPx))
      ? Math.max(0.05, Math.min(200, scaleArcsecPerPx * scaleArcsecPerPx))
      : 4.0;

    const AP_PX = 25; // 5×5 pixel box (tweak if you want)
    const apAreaArcsec2 = pixAreaArcsec2 * AP_PX;

    const S_surf = S_phot_per_s_m2 / Math.max(1, objArea); // photons/s/m2/arcsec2
    // Add moonlight as an extra sky background component (averaged over target-visible night time)
    const loc = getCurrentLocation();
    const moonExtra = computeMoonExtraSkyFluxPerArcsec2AvgForObject(loc, o, lambdaNm, bandpassNm, mode);
    const B_surf = sky_phot_per_s_m2_arcsec2 + (Number.isFinite(moonExtra) ? moonExtra : 0);             // photons/s/m2/arcsec2

    // Apply extinction/transmission to signal, and airmass scaling to sky
    const S = S_surf * apAreaArcsec2 * A * eff * t * trans;
    const B = B_surf * apAreaArcsec2 * A * eff * t * X;

    const snr = (S > 0) ? (S / Math.sqrt(S + B + 1e-12)) : 0;
    const out = Number.isFinite(snr) ? Math.max(0, Math.min(SNR_SCORE_CAP, snr)) : null;
    SNR_CACHE.set(key, out);
    return out;
  }

  function formatSNRScore(score){
    if (score == null || !Number.isFinite(score)) return '—';
    if (score >= 100) return score.toFixed(0);
    return score.toFixed(1);
  }

  function ensureSNRSelectOptions(){
    const bbSel = $('snrBroadbandSelect');
    if (bbSel && bbSel.options.length === 0) {
      bbSel.innerHTML = '';
      const opts = [
        ['B', 'Blue (B)'],
        ['V', 'Green (V)'],
        ['R', 'Red (R)'],
      ];
      for (const [value, label] of opts) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        bbSel.appendChild(opt);
      }
    }
    if (bbSel && !['B','V','R'].includes(String(bbSel.value || '').toUpperCase())) {
      bbSel.value = 'V';
    }

    const nbSel = $('snrNebulaBandpassSelect');
    if (nbSel && nbSel.options.length === 0) {
      nbSel.innerHTML = '';
      const opts = [
        ['20', '20 nm (Smart Scopes)'],
        ['9',  '9 nm'],
        ['6',  '6 nm'],
        ['3',  '3 nm'],
      ];
      for (const [value, label] of opts) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        nbSel.appendChild(opt);
      }
    }
    if (nbSel && !['20','9','6','3'].includes(String(nbSel.value || ''))) {
      nbSel.value = '20';
    }
  }

  function wireAdvancedModeToggle(){
    const adv = $('advancedToggle');
    if (!adv) return;
    adv.checked = isAdvancedModeEnabled();
    setAdvancedModeEnabled(adv.checked);

    adv.addEventListener('change', () => {
      setAdvancedModeEnabled(adv.checked);
    });

    const bortle = $('bortleSelect');
    if (bortle) {
      bortle.addEventListener('change', () => {
        updateBortleSQMLabel();
        SNR_CACHE.clear();
        refreshTableOnly();
        updateCaption();
        updateMobileChartInfo();
      });
    }

    const snrBroadbandSel = $('snrBroadbandSelect');
    const snrNebulaBandpassSel = $('snrNebulaBandpassSelect');

    if (snrBroadbandSel) {
      snrBroadbandSel.addEventListener('change', () => {
        SNR_CACHE.clear();
        refreshTableOnly();
        updateCaption();
        updateMobileChartInfo();
      });
    }

    if (snrNebulaBandpassSel) {
      snrNebulaBandpassSel.addEventListener('change', () => {
        SNR_CACHE.clear();
        refreshTableOnly();
        updateCaption();
        updateMobileChartInfo();
      });
    }
  }



  // -----------------------------
  // Smart camera / reducer selects
  // -----------------------------
  function rebuildSmartCameraSet() {
    SMART_CAMERA_NAMES = new Set(
      (TELESCOPES || [])
        .filter(t => isSmartTelescope(t))
        .map(t => getFixedCameraName(t))
        .filter(Boolean)
    );
  }

  function rebuildCameraSelect() {
    const camSel = $("cameraSelect");
    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const smart = isSmartTelescope(scope);

    if (!loadState.cameras.ok || CAMERAS_ALL.length === 0) {
      clearAndAddStatusOption(camSel, `❌ Cameras not loaded: ${loadState.cameras.err || "unknown"}`);
      camSel.disabled = true;
      return;
    }

    if (smart) {
      const fixedName = getFixedCameraName(scope);
      clearAndAddStatusOption(camSel, "🔒 Camera locked (smart telescope)");
      const opt = document.createElement("option");
      opt.value = fixedName || "__unknown_smart_camera__";
      opt.textContent = fixedName || "Built-in camera";
      camSel.appendChild(opt);
      camSel.selectedIndex = 1;
      camSel.disabled = true;
      return;
    }

    const userCameras = CAMERAS_ALL.filter(c => !SMART_CAMERA_NAMES.has(c.name));
    clearAndAddStatusOption(camSel, `✅ Loaded ${userCameras.length} cameras`);
    userCameras.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      camSel.appendChild(opt);
    });
    if (userCameras.length > 0) camSel.selectedIndex = 1;
    camSel.disabled = false;
  }

  function getSelectedCamera() {
    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const smart = isSmartTelescope(scope);
    if (smart) {
      const fixedName = getFixedCameraName(scope);
      return CAMERAS_ALL.find(c => c.name === fixedName) || null;
    }
    const name = $("cameraSelect").value;
    return CAMERAS_ALL.find(c => c.name === name) || null;
  }

  function rebuildReducerSelect() {
    const redSel = $("reducerSelect");
    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const smart = isSmartTelescope(scope);

    if (!loadState.telescopes.ok || !Array.isArray(REDUCERS) || REDUCERS.length === 0) {
      clearAndAddStatusOption(redSel, `❌ Reducers not loaded: ${loadState.telescopes.err || "unknown"}`);
      redSel.disabled = true;
      return;
    }

    if (smart) {
      const noneIdx = REDUCERS.findIndex(r => Number(r.factor) === 1.0);
      const locked = noneIdx >= 0 ? REDUCERS[noneIdx] : { factor: 1.0, name: "None (1.0x)" };
      clearAndAddStatusOption(redSel, "🔒 Locked to 1.0x (smart telescope)");
      const opt = document.createElement("option");
      opt.value = String(noneIdx >= 0 ? noneIdx : 0);
      opt.textContent = locked.name;
      redSel.appendChild(opt);
      redSel.selectedIndex = 1;
      redSel.disabled = true;
      return;
    }

    clearAndAddStatusOption(redSel, `✅ Loaded ${REDUCERS.length} reducers`);
    REDUCERS.forEach((r, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = r.name;
      redSel.appendChild(opt);
    });
    const noneIdx = REDUCERS.findIndex(r => Number(r.factor) === 1.0);
    if (noneIdx >= 0) redSel.value = String(noneIdx);
    redSel.disabled = false;
  }

  function getSelectedReducer() {
    const idx = Number.parseInt($("reducerSelect").value, 10);
    return Number.isFinite(idx) ? REDUCERS[idx] : REDUCERS[0];
  }

  // -----------------------------
  // Type filter
  // -----------------------------
  function buildTypeFilterOptions() {
    const sel = $("typeFilter");
    if (!sel || !Array.isArray(OBJECTS)) return;

    const prev = sel.value || "__all__";

    const types = new Set();
    for (const o of OBJECTS) {
      const t = String(o?.type ?? "").trim();
      if (t) types.add(t);
    }
    const sorted = Array.from(types).sort((a,b)=>a.localeCompare(b));

    sel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "__all__";
    allOpt.textContent = "All";
    sel.appendChild(allOpt);

    for (const t of sorted) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }

    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    else sel.value = "__all__";
  }

  function currentTypeFilter() {
    const sel = $("typeFilter");
    return sel ? sel.value : "__all__";
  }

  // -----------------------------
  // Survey auto-defaults (based on Type filter)
  // -----------------------------
  const SURVEY_DSS2_COLOR = "P/DSS2/color";
  const SURVEY_NSNS_OHS   = "https://www.simg.de/nebulae3/dr0_2/ohs8/"; // your nebula default

  function preferredSurveyForTypeFilter(typeFilterValue){
    if (!typeFilterValue || typeFilterValue === "__all__") return SURVEY_DSS2_COLOR;

    const s = String(typeFilterValue).toLowerCase();

    // galaxy / galaxies -> DSS2
    if (s.includes("gal")) return SURVEY_DSS2_COLOR;

    // nebula-ish -> NSNS OHS
    if (s.includes("neb") || s.includes("hii") || s.includes("h ii") || s.includes("pn") || s.includes("planetary")) {
      return SURVEY_NSNS_OHS;
    }

    return SURVEY_DSS2_COLOR;
  }

  function applyPreferredSurveyFromTypeFilter(){
    const sel = $("surveySelect");
    if (!sel) return;

    const preferred = preferredSurveyForTypeFilter(currentTypeFilter());
    if (sel.value !== preferred) sel.value = preferred;
  }

  // -----------------------------
  // Sun times + night window
  // -----------------------------
  function clamp360(deg) {
    let x = deg % 360;
    if (x < 0) x += 360;
    return x;
  }

  function julianDay0UTC(y,m,d){
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y/100);
    const B = 2 - A + Math.floor(A/4);
    return Math.floor(365.25*(y + 4716)) + Math.floor(30.6001*(m + 1)) + d + B - 1524.5;
  }

  function sunParamsForDate(y,m,d){
    const jd = julianDay0UTC(y,m,d);
    const t = (jd - 2451545.0) / 36525.0;

    const L0 = clamp360(280.46646 + t*(36000.76983 + t*0.0003032));
    const M  = clamp360(357.52911 + t*(35999.05029 - 0.0001537*t));
    const e  = 0.016708634 - t*(0.000042037 + 0.0000001267*t);

    const Mr = M*RAD;
    const C = (Math.sin(Mr) * (1.914602 - t*(0.004817 + 0.000014*t)))
            + (Math.sin(2*Mr) * (0.019993 - 0.000101*t))
            + (Math.sin(3*Mr) * 0.000289);

    const trueLong = L0 + C;
    const omega = (125.04 - 1934.136*t)*RAD;
    const lambda = (trueLong - 0.00569 - 0.00478*Math.sin(omega))*RAD;

    const meanObliq = 23 + (26 + ((21.448 - t*(46.815 + t*(0.00059 - t*0.001813))))/60)/60;
    const obliqCorr = (meanObliq + 0.00256*Math.cos(omega))*RAD;

    const sinDecl = Math.sin(obliqCorr) * Math.sin(lambda);
    const decl = Math.asin(sinDecl);

    const yterm = Math.tan(obliqCorr/2);
    const y2 = yterm*yterm;

    const L0r = L0*RAD;

    const eqTime =
      4 * DEG * (
        y2*Math.sin(2*L0r) -
        2*e*Math.sin(Mr) +
        4*e*y2*Math.sin(Mr)*Math.cos(2*L0r) -
        0.5*y2*y2*Math.sin(4*L0r) -
        1.25*e*e*Math.sin(2*Mr)
      );

    return { decl, eqTimeMin: eqTime };
  }

  function computeSunriseSunsetUtc(y,m,d,latDeg,lonDeg){
    const { decl, eqTimeMin } = sunParamsForDate(y,m,d);
    const lat = latDeg*RAD;

    const cosH =
      (Math.cos(90.833*RAD) / (Math.cos(lat)*Math.cos(decl))) -
      (Math.tan(lat)*Math.tan(decl));

    if (cosH > 1 || cosH < -1) {
      return { sunriseValid:false, sunsetValid:false, sunriseUtc:null, sunsetUtc:null };
    }

    const H = Math.acos(cosH) * DEG;
    const solarNoonMin = 720 - 4*lonDeg - eqTimeMin;

    const sunriseMin = solarNoonMin - 4*H;
    const sunsetMin  = solarNoonMin + 4*H;

    const midnight = Date.UTC(y, m-1, d, 0, 0, 0);

    const sunriseUtc = new Date(midnight + sunriseMin*60000);
    const sunsetUtc  = new Date(midnight + sunsetMin*60000);

    return { sunriseValid:true, sunsetValid:true, sunriseUtc, sunsetUtc };
  }

  function getZonedYMD(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-GB", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" });
    const parts = dtf.formatToParts(date).reduce((acc,p)=>{ acc[p.type]=p.value; return acc; }, {});
    return { y:Number(parts.year), m:Number(parts.month), d:Number(parts.day) };
  }

  function formatLocalHM(dateUtc, timeZone){
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", hour12:false });
    return fmt.format(dateUtc);
  }

  function dayIndexFromYmd(ymd){
    return Math.floor(Date.UTC(ymd.y, ymd.m - 1, ymd.d) / 86400000);
  }

  function formatTimeRangeLocal(startMsUtc, endMsUtc, timeZone){
    if (startMsUtc == null || endMsUtc == null) return "—";

    const start = formatLocalHM(new Date(startMsUtc), timeZone);
    const end   = formatLocalHM(new Date(endMsUtc), timeZone);

    const a = getZonedYMD(new Date(startMsUtc), timeZone);
    const b = getZonedYMD(new Date(endMsUtc), timeZone);

    const dd = dayIndexFromYmd(b) - dayIndexFromYmd(a);
    const suffix = dd === 0 ? "" : (dd === 1 ? " (+1d)" : ` (+${dd}d)`);

    return `${start}–${end}${suffix}`;
  }

  function buildNightWindowUtcForYMD(location, y, m, d){
    const tz = location.timezone;
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);

    const today = computeSunriseSunsetUtc(y,m,d,lat,lon);
    const next = new Date(Date.UTC(y,m-1,d,0,0,0) + 86400000);
    const y2 = next.getUTCFullYear(), m2 = next.getUTCMonth()+1, d2 = next.getUTCDate();
    const tomorrow = computeSunriseSunsetUtc(y2,m2,d2,lat,lon);

    if (today.sunsetValid && tomorrow.sunriseValid) {
      let startUtc = today.sunsetUtc;
      let endUtc = tomorrow.sunriseUtc;
      if (endUtc <= startUtc) endUtc = new Date(endUtc.getTime() + 86400000);
      return { startUtc, endUtc, sunsetLocal: formatLocalHM(startUtc, tz), sunriseLocal: formatLocalHM(endUtc, tz), tz };
    }

    const guessUtc = Date.UTC(y, m-1, d, 0, 0, 0);
    return { startUtc: new Date(guessUtc - 6*3600000), endUtc: new Date(guessUtc + 6*3600000), sunsetLocal:"—", sunriseLocal:"—", tz };
  }

  function buildNightWindowUtc(location){
    const ymd = getBaseYmdForLocation(location);
    return buildNightWindowUtcForYMD(location, ymd.y, ymd.m, ymd.d);
  }

  function buildDaySpansUtc(location){
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);

    const base = getBaseYmdForLocation(location);
    const baseUtc = new Date(Date.UTC(base.y, base.m-1, base.d, 0, 0, 0));

    function ymdFromUtcDate(utcDate){
      return { y: utcDate.getUTCFullYear(), m: utcDate.getUTCMonth()+1, d: utcDate.getUTCDate() };
    }

    const dates = [
      new Date(baseUtc.getTime() - 86400000),
      baseUtc,
      new Date(baseUtc.getTime() + 86400000)
    ];

    const spans = [];
    for (const dt of dates) {
      const dd = ymdFromUtcDate(dt);
      const st = computeSunriseSunsetUtc(dd.y, dd.m, dd.d, lat, lon);
      if (st.sunriseValid && st.sunsetValid && st.sunsetUtc > st.sunriseUtc) {
        spans.push({ startMs: st.sunriseUtc.getTime(), endMs: st.sunsetUtc.getTime() });
      }
    }
    return spans;
  }

  function isDayMs(msUtc){
    for (const s of DAY_SPANS) {
      if (msUtc >= s.startMs && msUtc <= s.endMs) return true;
    }
    return false;
  }

  // -----------------------------
  // Alt/Az
  // -----------------------------
  function jdFromDate(date) {
    return (date.getTime() / 86400000) + 2440587.5;
  }

  function gmstDeg(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const gmst =
      280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * T * T -
      (T * T * T) / 38710000.0;
    return clamp360(gmst);
  }

  function parseNums(str) {
    const m = String(str).match(/-?\d+(\.\d+)?/g);
    return m ? m.map(Number) : null;
  }

  function parseRaDeg(ra) {
    if (ra == null) return null;
    if (typeof ra === "number") return ra <= 24 ? ra * 15 : ra;
    const s = String(ra).trim();
    if (!s) return null;
    const nums = parseNums(s);
    if (!nums || nums.length === 0) return null;
    if (s.includes("h") || s.includes(":")) {
      const h = nums[0] ?? 0;
      const m = nums[1] ?? 0;
      const sec = nums[2] ?? 0;
      return (h + m/60 + sec/3600) * 15;
    }
    const v = nums[0];
    return v <= 24 ? v * 15 : v;
  }

  function parseDecDeg(dec) {
    if (dec == null) return null;
    if (typeof dec === "number") return dec;
    const s = String(dec).trim();
    if (!s) return null;
    const nums = parseNums(s);
    if (!nums || nums.length === 0) return null;
    const sign = s.startsWith("-") ? -1 : 1;
    const d = Math.abs(nums[0] ?? 0);
    const m = nums[1] ?? 0;
    const sec = nums[2] ?? 0;
    return sign * (d + m/60 + sec/3600);
  }

  function raDecToAltAz(utcDate, raDeg, decDeg, latDeg, lonDeg){
    const jd = jdFromDate(utcDate);
    const lstDeg = clamp360(gmstDeg(jd) + lonDeg);
    let H = lstDeg - raDeg;
    H = ((H + 540) % 360) - 180;

    const sinDec = Math.sin(decDeg*RAD);
    const cosDec = Math.cos(decDeg*RAD);
    const sinLat = Math.sin(latDeg*RAD);
    const cosLat = Math.cos(latDeg*RAD);

    const cosH = Math.cos(H*RAD);
    const sinH = Math.sin(H*RAD);

    const sinAlt = sinDec*sinLat + cosDec*cosLat*cosH;
    const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;

    const y = -sinH*cosDec;
    const x = sinDec*cosLat - cosDec*sinLat*cosH;
    let azDeg = Math.atan2(y, x) * DEG;
    if (azDeg < 0) azDeg += 360;

    return { altDeg, azDeg };
  }

  // -----------------------------
  // Moon (phase, position, separation)
  // -----------------------------
  function sinDeg(x){ return Math.sin(x*RAD); }
  function cosDeg(x){ return Math.cos(x*RAD); }

  function eclToEqRaDec(lonDeg, latDeg, epsDeg){
    const lon = lonDeg * RAD;
    const lat = latDeg * RAD;
    const eps = epsDeg * RAD;

    const x = Math.cos(lon) * Math.cos(lat);
    const y = Math.sin(lon) * Math.cos(lat);
    const z = Math.sin(lat);

    const xeq = x;
    const yeq = y * Math.cos(eps) - z * Math.sin(eps);
    const zeq = y * Math.sin(eps) + z * Math.cos(eps);

    let ra = Math.atan2(yeq, xeq) * DEG;
    if (ra < 0) ra += 360;
    const dec = Math.asin(Math.max(-1, Math.min(1, zeq))) * DEG;
    return { raDeg: ra, decDeg: dec };
  }

  function sunEclipticLonDegFromJd(jd){
    const d = jd - 2451545.0;
    const g = clamp360(357.529 + 0.98560028 * d); // mean anomaly
    const q = clamp360(280.459 + 0.98564736 * d); // mean longitude
    const L = clamp360(q + 1.915 * sinDeg(g) + 0.020 * sinDeg(2*g));
    return L;
  }

  function moonEclipticLonLatDegFromJd(jd){
    // Low-precision Moon position (good enough for planning / separation warnings)
    const d = jd - 2451545.0;

    const L = clamp360(218.316 + 13.176396 * d);   // mean longitude
    const M = clamp360(134.963 + 13.064993 * d);   // mean anomaly
    const F = clamp360(93.272  + 13.229350 * d);   // mean distance
    const D = clamp360(297.850 + 12.190749 * d);   // elongation

    let lon = L;
    lon += 6.289 * sinDeg(M);
    lon += 1.274 * sinDeg(2*D - M);
    lon += 0.658 * sinDeg(2*D);
    lon += 0.214 * sinDeg(2*M);
    lon += 0.110 * sinDeg(D);

    let lat = 0;
    lat += 5.128 * sinDeg(F);
    lat += 0.280 * sinDeg(M + F);
    lat += 0.277 * sinDeg(M - F);
    lat += 0.173 * sinDeg(2*D - F);
    lat += 0.055 * sinDeg(2*D + F - M);
    lat += 0.046 * sinDeg(2*D - F - M);
    lat += 0.033 * sinDeg(2*D + F);
    lat += 0.017 * sinDeg(2*M + F);

    return { lonDeg: clamp360(lon), latDeg: lat };
  }

  function moonRaDecFromUtcDate(utcDate){
    const jd = jdFromDate(utcDate);
    const d = jd - 2451545.0;
    const eps = 23.439 - 0.0000004 * d;
    const ecl = moonEclipticLonLatDegFromJd(jd);
    const eq = eclToEqRaDec(ecl.lonDeg, ecl.latDeg, eps);
    return { ...eq, lonDeg: ecl.lonDeg, latDeg: ecl.latDeg, epsDeg: eps };
  }

  function moonPhaseInfoFromUtcDate(utcDate){
    const jd = jdFromDate(utcDate);
    const d = jd - 2451545.0;
    const eps = 23.439 - 0.0000004 * d;

    const sunLon = sunEclipticLonDegFromJd(jd);
    const moonEcl = moonEclipticLonLatDegFromJd(jd);

    // Elongation (Moon - Sun)
    let elong = clamp360(moonEcl.lonDeg - sunLon);
    if (elong > 180) elong = 360 - elong;

    const illum = (1 - Math.cos(elong * RAD)) / 2; // 0..1

    // Waxing/waning: compare true ecliptic longitudes
    const waxing = clamp360(moonEcl.lonDeg - sunLon) < 180;

    const pct = Math.round(illum * 100);
    let name = "";
    if (pct <= 2) name = "New";
    else if (pct < 48) name = waxing ? "Waxing crescent" : "Waning crescent";
    else if (pct <= 52) name = waxing ? "First quarter" : "Last quarter";
    else if (pct < 98) name = waxing ? "Waxing gibbous" : "Waning gibbous";
    else name = "Full";

    return { illumFrac: illum, illumPct: pct, waxing, name, elongDeg: elong, epsDeg: eps };
  }

  function angularSeparationDeg(ra1Deg, dec1Deg, ra2Deg, dec2Deg){
    const ra1 = ra1Deg * RAD, ra2 = ra2Deg * RAD;
    const d1 = dec1Deg * RAD, d2 = dec2Deg * RAD;

    const s = Math.sin(d1)*Math.sin(d2) + Math.cos(d1)*Math.cos(d2)*Math.cos(ra1 - ra2);
    const c = Math.max(-1, Math.min(1, s));
    return Math.acos(c) * DEG;
  }

  let MOON_TRACK_CACHE = { key: null, pts: null, phase: null, times: null, moonRa: null, moonDec: null };

  function getMoonTrackForWindow(loc, trackStartMs, trackEndMs, stepMs){
    const latDeg = Number(loc.latitude);
    const lonDeg = Number(loc.longitude);
    const key = `${latDeg.toFixed(5)},${lonDeg.toFixed(5)}|${trackStartMs}|${trackEndMs}|${stepMs}`;

    if (MOON_TRACK_CACHE.key === key && MOON_TRACK_CACHE.pts) return MOON_TRACK_CACHE;

    const pts = [];
    const times = [];
    const moonRa = [];
    const moonDec = [];

    for (let t = trackStartMs; t <= trackEndMs; t += stepMs) {
      const dt = new Date(t);
      const m = moonRaDecFromUtcDate(dt);
      const aa = raDecToAltAz(dt, m.raDeg, m.decDeg, latDeg, lonDeg);
      pts.push({ t, altDeg: aa.altDeg, azDeg: aa.azDeg });
      times.push(t);
      moonRa.push(m.raDeg);
      moonDec.push(m.decDeg);
    }

    if (pts.length === 0 || pts[pts.length-1].t !== trackEndMs) {
      const dt = new Date(trackEndMs);
      const m = moonRaDecFromUtcDate(dt);
      const aa = raDecToAltAz(dt, m.raDeg, m.decDeg, latDeg, lonDeg);
      pts.push({ t: trackEndMs, altDeg: aa.altDeg, azDeg: aa.azDeg });
      times.push(trackEndMs);
      moonRa.push(m.raDeg);
      moonDec.push(m.decDeg);
    }

    const mid = new Date((trackStartMs + trackEndMs) / 2);
    const phase = moonPhaseInfoFromUtcDate(mid);

    MOON_TRACK_CACHE = { key, pts, phase, times, moonRa, moonDec };
    return MOON_TRACK_CACHE;
  }

  function computeMoonSeparationTonight(loc, objRaDeg, objDecDeg, vis){
    if (!loc || !NIGHT_WINDOW || objRaDeg == null || objDecDeg == null) return null;

    const sunsetMs = NIGHT_WINDOW.startUtc.getTime();
    const sunriseMs = NIGHT_WINDOW.endUtc.getTime();
    const stepMs = Math.max(1, VIS_STEP_MIN) * 60 * 1000;

    // Match the same extended span logic used in drawNightChart
    let trackStart = sunsetMs;
    let trackEnd = sunriseMs;
    const minSpan = 24*3600000;
    const span = trackEnd - trackStart;
    if (span < minSpan) {
      const extra = Math.floor((minSpan - span) / 2);
      trackStart -= extra;
      trackEnd += extra;
    }

    const track = getMoonTrackForWindow(loc, trackStart, trackEnd, stepMs);

    let minSep = null;
    let minT = null;

    for (let i = 0; i < track.times.length; i++) {
      const sep = angularSeparationDeg(objRaDeg, objDecDeg, track.moonRa[i], track.moonDec[i]);
      if (minSep == null || sep < minSep) { minSep = sep; minT = track.times[i]; }
    }

    // Separation at the midpoint of best window (if available)
    let bestSep = null;
    let bestT = null;
    if (vis?.bestStartUtcMs != null && vis?.bestEndUtcMs != null) {
      bestT = Math.round((vis.bestStartUtcMs + vis.bestEndUtcMs) / 2);
      // Find nearest sample
      let jBest = 0;
      let bestDt = Infinity;
      for (let i = 0; i < track.times.length; i++) {
        const dt = Math.abs(track.times[i] - bestT);
        if (dt < bestDt) { bestDt = dt; jBest = i; }
      }
      bestSep = angularSeparationDeg(objRaDeg, objDecDeg, track.moonRa[jBest], track.moonDec[jBest]);
    }

    const tz = NIGHT_WINDOW?.tz || loc?.timezone || "UTC";
    const minTimeTxt = (minT != null) ? formatLocalHM(new Date(minT), tz) : null;
    const bestTimeTxt = (bestT != null) ? formatLocalHM(new Date(bestT), tz) : null;

    return {
      phase: track.phase,
      minSepDeg: minSep,
      minTimeTxt,
      bestSepDeg: bestSep,
      bestTimeTxt
    };
  }


  // Standalone horizon: uses ONLY numeric floor OR ONLY custom profile (no stacking)
  function computeVisibilityForObjectInWindow(location, horizonAtAzFn, raDeg, decDeg, startUtc, endUtc){
    const latDeg = Number(location.latitude);
    const lonDeg = Number(location.longitude);

    const stepSec = Math.max(1, VIS_STEP_MIN) * 60;

    const startMs = startUtc.getTime();
    const endMs = endUtc.getTime();

    const timesMs = [];
    for (let t = startMs; t <= endMs; t += stepSec*1000) timesMs.push(t);
    if (timesMs[timesMs.length - 1] !== endMs) timesMs.push(endMs);

    const n = timesMs.length;
    const alts = new Array(n);
    const hzs  = new Array(n);

    let maxAlt = -1e9;
    for (let i = 0; i < n; i++) {
      const { altDeg, azDeg } = raDecToAltAz(new Date(timesMs[i]), raDeg, decDeg, latDeg, lonDeg);
      alts[i] = altDeg;
      hzs[i] = horizonAtAzFn(azDeg);
      if (altDeg > maxAlt) maxAlt = altDeg;
    }

    let visibleSec = 0;
    let sumAltSec = 0;

    let wasAbove = ((alts[0] - hzs[0]) >= 0);
    let segStartMs = wasAbove ? timesMs[0] : null;

    let bestDurSec = 0;
    let bestStart = null;
    let bestEnd = null;

    for (let i = 0; i < n - 1; i++) {
      const t0 = timesMs[i];
      const t1 = timesMs[i+1];
      const dtSec = (t1 - t0) / 1000;

      const alt0 = alts[i];
      const alt1 = alts[i+1];

      const hz0 = hzs[i];
      const hz1 = hzs[i+1];

      const d0 = alt0 - hz0;
      const d1 = alt1 - hz1;

      const a0 = (d0 >= 0);
      const a1 = (d1 >= 0);

      if (a0 && a1) {
        visibleSec += dtSec;
        sumAltSec += ((alt0 + alt1) * 0.5) * dtSec;
        continue;
      }
      if (!a0 && !a1) continue;

      const denom = (d0 - d1);
      let u = (denom === 0) ? 0.5 : (d0 / denom);
      u = clamp(u, 0, 1);

      const tCross = t0 + u * (t1 - t0);
      const altCross = alt0 + u * (alt1 - alt0);

      if (!a0 && a1) {
        const dtAbove = (t1 - tCross) / 1000;
        visibleSec += dtAbove;
        sumAltSec += ((altCross + alt1) * 0.5) * dtAbove;

        if (!wasAbove) { segStartMs = tCross; wasAbove = true; }
      } else if (a0 && !a1) {
        const dtAbove = (tCross - t0) / 1000;
        visibleSec += dtAbove;
        sumAltSec += ((alt0 + altCross) * 0.5) * dtAbove;

        if (wasAbove && segStartMs != null) {
          const segEndMs = tCross;
          const durSec = Math.max(0, (segEndMs - segStartMs) / 1000);
          if (durSec > bestDurSec) { bestDurSec = durSec; bestStart = segStartMs; bestEnd = segEndMs; }
          segStartMs = null;
          wasAbove = false;
        }
      }
    }

    if (wasAbove && segStartMs != null) {
      const segEndMs = timesMs[timesMs.length - 1];
      const durSec = Math.max(0, (segEndMs - segStartMs) / 1000);
      if (durSec > bestDurSec) { bestDurSec = durSec; bestStart = segStartMs; bestEnd = segEndMs; }
    }

    const avgAltDeg = (visibleSec > 0) ? (sumAltSec / visibleSec) : null;

    return {
      visibleSec,
      totalMinutes: Math.ceil(visibleSec / 60),
      maxAltDeg: Number.isFinite(maxAlt) ? maxAlt : null,
      avgAltDeg,
      bestStartUtcMs: bestStart,
      bestEndUtcMs: bestEnd
    };
  }

  function computeVisibilityForAllObjects(location){
    NIGHT_WINDOW = buildNightWindowUtc(location);
    DAY_SPANS = buildDaySpansUtc(location);

    const horizonAtAzFn = getHorizonAtAzFn();
    const results = new Map();

    for (let idx = 0; idx < OBJECTS.length; idx++) {
      const o = OBJECTS[idx];
      const raDeg = parseRaDeg(o.ra);
      const decDeg = parseDecDeg(o.dec);

      if (raDeg == null || decDeg == null) {
        results.set(idx, { visibleSec: 0, totalMinutes: 0, maxAltDeg: null, avgAltDeg: null, bestStartUtcMs: null, bestEndUtcMs: null });
        continue;
      }

      const r = computeVisibilityForObjectInWindow(
        location, horizonAtAzFn, raDeg, decDeg,
        NIGHT_WINDOW.startUtc, NIGHT_WINDOW.endUtc
      );
      results.set(idx, r);
    }

    return results;
  }

  // -----------------------------
  // Pixel size filter
  // -----------------------------
  function getObjectArcmin(o) {
    const aRaw = o?.size_major_arcmin;
    const bRaw = o?.size_minor_arcmin;

    const a = (aRaw === null || aRaw === undefined || aRaw === "") ? NaN : Number(aRaw);
    const b = (bRaw === null || bRaw === undefined || bRaw === "") ? NaN : Number(bRaw);

    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return { major: Math.max(a, b), minor: Math.min(a, b) };
    }
    if (Number.isFinite(a) && a > 0) {
      return { major: a, minor: a };
    }

    const sRaw = o?.size;
    const s = (sRaw === null || sRaw === undefined || sRaw === "") ? NaN : Number(sRaw);
    if (Number.isFinite(s) && s > 0) return { major: s, minor: s };

    return { major: 0, minor: 0 };
  }

  function computeImageScaleArcsecPerPixel() {
    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const red = getSelectedReducer();
    const cam = getSelectedCamera();
    if (!scope || !red || !cam) return null;

    const effFocal = Number(scope.focal_mm) * Number(red.factor);
    const px = Number(cam.pixel_um);
    if (!Number.isFinite(effFocal) || effFocal <= 0 || !Number.isFinite(px) || px <= 0) return null;

    return 206.265 * px / effFocal; // internal arcsec/px
  }

  function objectPixelsMajor(o, scaleArcsecPerPx) {
    const { major } = getObjectArcmin(o);
    const majorArcsec = major * 60;
    const majorPx = (scaleArcsecPerPx > 0) ? (majorArcsec / scaleArcsecPerPx) : 0;
    return majorPx;
  }

  function getMinSizePercent(){
    const el = $("minSizePercent");
    const v = Number(el?.value ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  function sensorPixelsMax(){
    const cam = getSelectedCamera();
    if (!cam) return null;

    const wmm = Number(cam.sensor_w_mm);
    const hmm = Number(cam.sensor_h_mm);
    const pxu = Number(cam.pixel_um);

    if (![wmm,hmm,pxu].every(Number.isFinite) || pxu <= 0) return null;

    const wpx = (wmm * 1000) / pxu;
    const hpx = (hmm * 1000) / pxu;
    return Math.max(wpx, hpx);
  }

  function minSizePixelsThreshold(){
    const maxPx = sensorPixelsMax();
    if (!Number.isFinite(maxPx)) return 0;
    return (getMinSizePercent() / 100) * maxPx;
  }

  function applyFilters() {
    const tf = currentTypeFilter();

    // ✅ Show ALL objects (still respects Type dropdown)
    if (SHOW_ALL_OBJECTS) {
      FILTERED_INDICES = [];
      for (let idx = 0; idx < OBJECTS.length; idx++) {
        const o = OBJECTS[idx];

        // ✅ name/common-name search
        if (!matchesNameSearch(o)) continue;

        if (tf !== "__all__") {
          const t = String(o?.type ?? "");
          if (t !== tf) continue;
        }
        FILTERED_INDICES.push(idx);
      }
      return;
    }

    // ✅ Normal filtered mode (your original logic)
    const scale = computeImageScaleArcsecPerPixel();
    const minPx = minSizePixelsThreshold();

    if (!scale) { FILTERED_INDICES = []; return; }

    FILTERED_INDICES = [];
    for (let idx = 0; idx < OBJECTS.length; idx++) {
      const o = OBJECTS[idx];

      // ✅ name/common-name search
      if (!matchesNameSearch(o)) continue;

      const visSec = VIS_RESULTS.get(idx)?.visibleSec ?? 0;
      if (visSec <= 0) continue;

      if (tf !== "__all__") {
        const t = String(o?.type ?? "");
        if (t !== tf) continue;
      }

      const majorPx = objectPixelsMajor(o, scale);
      if (!(majorPx >= minPx)) continue;

      FILTERED_INDICES.push(idx);
    }
  }

  // -----------------------------
  // FoV labels (degrees + arcminutes)
  // -----------------------------
  function calcFovDegrees(sensor_mm, focal_mm) {
    return (2 * Math.atan(sensor_mm / (2 * focal_mm))) * DEG;
  }

  function computeRigFovDegNullable(mosaicFactor){
    const scope = getSelected($("telescopeSelect"), TELESCOPES);
    const red = getSelectedReducer();
    const cam = getSelectedCamera();
    if (!scope || !red || !cam) return null;

    const effFocal = Number(scope.focal_mm) * Number(red.factor);
    if (!Number.isFinite(effFocal) || effFocal <= 0) return null;

    const fovW = calcFovDegrees(Number(cam.sensor_w_mm), effFocal);
    const fovH = calcFovDegrees(Number(cam.sensor_h_mm), effFocal);

    const mosaic = Number(mosaicFactor) || 1;

    let f = Math.max(fovW, fovH) * mosaic;
    if (!Number.isFinite(f) || f <= 0) return null;

    f = Math.max(0.05, Math.min(60, f));
    return f;
  }

  function computeRigFovDeg() {
    const mosaic = Number($("mosaicRange").value) || 1;
    return computeRigFovDegNullable(mosaic) ?? 2.0;
  }

  function formatDegArcmin(deg){
    if (!Number.isFinite(deg)) return "—";
    const arcmin = deg * 60;
    return `${deg.toFixed(2)}° / ${arcmin.toFixed(1)}′`;
  }

  function updateFovLabels(){
    const pct = getMinSizePercent();
    const minPx = minSizePixelsThreshold();

    const scaleArcsecPerPx = computeImageScaleArcsecPerPixel();
    const minDeg = Number.isFinite(scaleArcsecPerPx) ? (minPx * scaleArcsecPerPx / 3600) : NaN;

    const mosaic = Number($("mosaicRange").value) || 1;
    const mosaicFovDeg = computeRigFovDegNullable(mosaic);

    const infoEl = $("minSizeInfo");
    const pillEl = $("minSizePill");
    const mosEl  = $("mosaicFovLabel");

    if (pillEl) pillEl.textContent = `${pct.toFixed(1)}%`;

    if (infoEl) {
      const pxTxt = Number.isFinite(minPx) ? `${Math.round(minPx)} px` : "—";
      const angTxt = Number.isFinite(minDeg) ? formatDegArcmin(minDeg) : "—";
      infoEl.textContent = ` • ≈ ${pxTxt} • ${angTxt}`;
    }

    if (mosEl) mosEl.textContent = ` • FoV: ${formatDegArcmin(mosaicFovDeg)}`;
  }

  // -----------------------------
  // Table rendering & sorting
  // -----------------------------
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
    const keys = ["name","common_name","magnitude","size","type","subtype","snr","visibility"];

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
  }

  function sortLabel() {
    const map = { name:"Name", common_name:"Common Name", magnitude:"Mag", size:"Size", type:"Type", subtype:"Subtype", snr:"SNR", visibility:"Visibility" };
    return `${map[sortState.key] || sortState.key} (${sortState.dir === "asc" ? "ascending" : "descending"})`;
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
      case "type": return String(o?.type ?? "").toLowerCase();
      case "subtype": return String(o?.subtype ?? "").toLowerCase();
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
    if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
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
        <td class="mono">${formatMobileMergedName(o)}</td>

        <!-- mobile visibility (2nd col) -->
        <td class="vis-cell mobile-only">${visH.toFixed(2)}h</td>

        <td class="snr-cell advanced-only mobile-only">${formatSNRScore(computeSNRScoreForIdx(idx))}</td>

        <td class="desktop-only">${safe(o.common_name)}</td>
        <td class="advanced-only desktop-only">${formatObjectMagnitude(o)}</td>
        <td class="advanced-only desktop-only">${formatSize(o)}</td>
        <td>${safe(o.type)}</td>
        <td class="desktop-only">${safe(o.subtype)}</td>

        <td class="snr-cell advanced-only desktop-only">${formatSNRScore(computeSNRScoreForIdx(idx))}</td>

        <!-- desktop visibility (last col) -->
        <td class="vis-cell desktop-only">${visH.toFixed(2)}h</td>
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
      $("objectsTbody").innerHTML = `<tr><td colspan="10" class="muted" style="padding:12px;">No objects match your filters.</td></tr>`;
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
    $("objectsTbody").innerHTML = `<tr><td colspan="10" class="muted" style="padding:12px;">Calculating…</td></tr>`;
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
      ? formatTimeRangeLocal(vis.bestStartUtcMs, vis.bestEndUtcMs, tz)
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
      const moonHtml = (moon && moon.phase)
        ? `&nbsp;•&nbsp; Moon: <code>${moon.phase.illumPct}%</code> ${moon.phase.name}${(moon.minSepDeg!=null && moon.minTimeTxt) ? `&nbsp;•&nbsp; Closest: <code>${moon.minSepDeg.toFixed(0)}°</code> <span class="muted">@ ${moon.minTimeTxt}</span>` : ``}`
        : ``;

box.innerHTML = `
      <div class="t1">${safe(getObjectDisplayNamePlain(obj))}</div>
      <div class="t2">
        Sunset–Sunrise: <code>${safe(d.sunsetSunrise)}</code>
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

    const surveyLabel = $("surveySelect")?.selectedOptions?.[0]?.textContent || $("surveySelect")?.value || "—";
    const fovDeg = computeRigFovDeg();

    const raTxt = (raDeg == null) ? "—" : `${raDeg.toFixed(4)}°`;
    const decTxt = (decDeg == null) ? "—" : `${decDeg.toFixed(4)}°`;

    return `Sky Image (Aladin): <code>${safe(surveyLabel)}</code> • Center: RA <code>${raTxt}</code>, Dec <code>${decTxt}</code> • FoV ≈ <code>${fovDeg.toFixed(2)}°</code>`;
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
      const moonHtml = (moon && moon.phase)
        ? `&nbsp;•&nbsp; Moon: <code>${moon.phase.illumPct}%</code> ${moon.phase.name}${(moon.minSepDeg!=null && moon.minTimeTxt) ? `&nbsp;•&nbsp; Closest: <code>${moon.minSepDeg.toFixed(0)}°</code> <span class=\"muted\">@ ${moon.minTimeTxt}</span>` : ``}`
        : ``;


      cap.innerHTML = `
        <div><strong>Tonight’s Visibility</strong> • ${nameLine}</div>
        <div style="margin-top:4px;">
          Sunset–Sunrise: <code>${safe(d.sunsetSunrise)}</code>
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
          Sunset–Sunrise: <code>${safe(d.sunsetSunrise)}</code>
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
    const maxH = maxMins / 60;

    cap.innerHTML = `
      <div><strong>Monthly Visibility</strong> • ${nameLine}</div>
      <div style="margin-top:4px;">
        Year: <code>${YEAR_DATA.year}</code>
        &nbsp;•&nbsp; Best month (mid-month sample): <code>${bestLabel}</code>
        &nbsp;•&nbsp; Max: <code>${maxH.toFixed(2)}h</code>${magHtml}${lineHtml}${snrHtml}
      </div>
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
      imagePane.style.display = "";
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

  function drawAltAzGrid(ctx, cx, cy, radiusMax) {
    ctx.save();

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
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

    ctx.fillStyle = "rgba(255,255,255,0.82)";
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
    ctx.fillStyle = "rgba(255,255,255,0.92)";
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
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
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
    // (gridMode currently unused; kept for future expansion)
    void getGridMode();

    const { ctx, w, h } = prepareCanvas(canvas, 380);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(0, 0, w, h);

    const cx = w/2;
    const cy = h/2;
    const radiusMax = 0.46 * Math.min(w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusMax, 0, Math.PI*2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "16px ui-sans-serif, system-ui";
    const pad = 12;
    ctx.fillText("N", cx - 6, cy - radiusMax - pad);
    ctx.fillText("S", cx - 6, cy + radiusMax + pad + 16);
    ctx.fillText("E", cx + radiusMax + pad, cy + 6);
    ctx.fillText("W", cx - radiusMax - pad - 14, cy + 6);

    // Grid
    drawAltAzGrid(ctx, cx, cy, radiusMax);

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
        const hMid = horizonAtAzFn(mid.azDeg);
        if (mid.altDeg < hMid) continue;

        const day = isDayMs(midT);
        ctx.strokeStyle = day ? "rgba(230,230,230,0.28)" : "rgba(245,245,245,0.55)";
        strokeMoonSeg(A, B);
      }

      // Current position marker
      {
        const now = Date.now();
        const mm = moonRaDecFromUtcDate(new Date(now));
        const latDegMoon = Number(loc.latitude);
        const lonDegMoon = Number(loc.longitude);
        const aa = raDecToAltAz(new Date(now), mm.raDeg, mm.decDeg, latDegMoon, lonDegMoon);
        const hNow = horizonAtAzFn(aa.azDeg);
        if (aa.altDeg >= hNow) {
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
    }

    for (let i = 1; i < pts.length; i++) {
      const A = pts[i-1];
      const B = pts[i];
      const midT = (A.t + B.t) / 2;

      const mid = raDecToAltAz(new Date(midT), raDeg, decDeg, latDeg, lonDeg);
      const hMid = horizonAtAzFn(mid.azDeg);
      if (mid.altDeg < hMid) continue;

      const day = isDayMs(midT);
      const col = day ? "rgba(255,200,90,0.62)" : "rgba(120,170,255,0.92)";
      strokeSegment(A, B, col);
    }

    // Night event times: sunset/sunrise, horizon rise/set (custom horizon), meridian (max altitude)
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

      // Meridian ~= max altitude time during the night window
      let meridianMs = null;
      let maxAlt = -1e9;
      for (const p of nightPts) {
        if (p.altDeg > maxAlt) { maxAlt = p.altDeg; meridianMs = p.t; }
      }

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

      const WHITE = "rgba(255,255,255,0.95)";
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
      // Horizon rise/set + meridian are shown only if the object is above your selected horizon at that moment.
      const drawMarker = (tMs, label, fillStyle, textStyle, requireAboveHorizon) => {
        if (tMs == null) return;

        const aa = raDecToAltAz(new Date(tMs), raDeg, decDeg, latDeg, lonDeg);
        const hz = horizonAtAzFn(aa.azDeg);

        if (requireAboveHorizon) {
          if (aa.altDeg < hz) return;
        } else {
          if (aa.altDeg < 0) return;
        }

        const xy = projectAltAz(aa.altDeg, aa.azDeg, cx, cy, radiusMax);

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
      drawMarker(nightStartMs, "SS", COL_SUN, "rgba(0,0,0,0.92)", false);
      drawMarker(nightEndMs,   "SR", COL_SUN, "rgba(0,0,0,0.92)", false);

      // Horizon rise / set (green triangles) and meridian (magenta)
      drawMarker(riseMs,     "▲", COL_HZN, "rgba(0,0,0,0.92)", true);
      drawMarker(meridianMs, "M", COL_MER, "rgba(255,255,255,0.95)", true);
      drawMarker(setMs,      "▼", COL_HZN, "rgba(0,0,0,0.92)", true);
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

    // Moon phase icon (top-right)
    {
      const rMoon = clamp(Math.floor(Math.min(w, h) * 0.05), 14, 20);
      drawMoonPhaseIconOnCanvas(ctx, w - 12 - rMoon, 12 + rMoon, rMoon, moonPhaseForIcon);
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
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText("Select an object to compute Monthly Visibility.", 18, 34);
      return;
    }

    const mins = YEAR_DATA.months;
    const maxMins = Math.max(0, ...mins);

    const maxH = maxMins / 60;
    const yMaxH = Math.max(2, Math.ceil(maxH / 2) * 2);
    const yMaxMins = yMaxH * 60;

    const left = 56;
    const top = 34;
    const right = w - 18;
    const bottom = h - 54;

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "13px ui-sans-serif, system-ui";

    for (let hh = 0; hh <= yMaxH; hh += 2) {
      const f = (hh / yMaxH);
      const y = bottom - f * (bottom - top);

      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      ctx.fillText(`${hh}h`, 12, y + 4);
    }

    const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const gap = 8;
    const barW = Math.max(10, ((right - left) - gap*11) / 12);

    for (let i = 0; i < 12; i++) {
      const x = left + i*(barW + gap);
      const barH = (mins[i] / yMaxMins) * (bottom - top);
      const y = bottom - barH;

      const isNow = (i === YEAR_DATA.currentMonthIdx);
      ctx.fillStyle = isNow ? "rgba(255,200,90,0.80)" : "rgba(120,170,255,0.70)";
      ctx.fillRect(x, y, barW, barH);

      YEAR_BAR_HITBOXES.push({ idx: i, x, w: barW, top, bottom });

      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = "12px ui-sans-serif, system-ui";
      const label = monthsShort[i];
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, x + (barW - tw)/2, bottom + 18);
    }

    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText(`Monthly Visibility (${YEAR_DATA.year})`, left, 20);

    ctx.fillStyle = "rgba(255,200,90,0.92)";
    ctx.font = "13px ui-sans-serif, system-ui";
    ctx.fillText(`Max: ${maxH.toFixed(2)}h`, right - 110, 20);
  }

  // -----------------------------
  // Aladin integration
  // -----------------------------
  function initAladinIfNeeded() {
    if (aladin || aladinInitStarted) return;

    if (!window.A || !A.init) {
      updateCaption();
      return;
    }

    aladinInitStarted = true;

    A.init.then(() => {
      aladin = A.aladin("#aladinDiv", {
        survey: $("surveySelect").value,
        fov: 1.5,
        target: "0 0"
      });
      aladinReady = true;
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
    if (!obj) return;

    const raDeg = parseRaDeg(obj.ra);
    const decDeg = parseDecDeg(obj.dec);
    if (raDeg == null || decDeg == null) return;

    const survey = $("surveySelect").value;
    if (typeof aladin.setImageSurvey === "function") aladin.setImageSurvey(survey);

    aladinGoto(raDeg, decDeg);
    aladinSetFovDeg(computeRigFovDeg());
  }

  function updateObjectsStatus(){
    const mode = SHOW_ALL_OBJECTS ? "all objects" : "filtered";
    const q = (NAME_QUERY || "").trim();
    const qTxt = q ? ` • search: "${q}"` : "";

    $("objectsStatus").textContent =
      `✅ Showing ${FILTERED_INDICES.length}/${OBJECTS.length} (${mode})${qTxt} • sorted by ${sortLabel()}`;
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
  function wireTableClick() {
    const tbody = $("objectsTbody");
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-idx]");
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;

      selectedObjectIdx = idx;

      for (const row of tbody.querySelectorAll("tr")) row.classList.remove("selected");
      tr.classList.add("selected");

      if (viewMode === "night") drawNightChart();
      if (viewMode === "year") { computeYearIfPossible(); drawYearChart(); }
      if (viewMode === "image") updateAladinFromSelection(true);

      updateCaption();
      updateMobileChartInfo();
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
      $("objectsTbody").innerHTML = `<tr><td colspan="10" class="muted" style="padding:12px;">No objects loaded.</td></tr>`;
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
      if (viewMode === "image") updateAladinFromSelection(true);
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
  // Init
  // -----------------------------
  (async function init() {
    await loadAllJson();
    await populateAllSelects();

    wireEvents();
    wireTypeFilter();
    wireTableClick();
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
    wireCustomTelescopeInputs();
    updateCustomTelescopeUI();

    // Advanced mode controls (optional)
    ensureBortleOptions();
    ensureSNRSelectOptions();
    updateAdvancedUI();
    wireAdvancedModeControls();
    await applyUrlStateFromQuery();
    wirePlannerLinkUI();

    $("viewNight").checked = true;
    setViewMode("night");

    updateAllResponsiveUI();
    updatePlannerLinkUI({ replaceBrowserUrl: true });
    updateCaption();
    drawNightChart();
    updateMobileChartInfo();
  })();

})();
