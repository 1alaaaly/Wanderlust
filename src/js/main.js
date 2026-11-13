
const CONFIG = {
  NAGER: "https://date.nager.at/api/v3",
  COUNTRIES: "https://restcountries.com/v3.1",
  METEO: "https://api.open-meteo.com/v1/forecast",
  GEO: "https://geocoding-api.open-meteo.com/v1/search",
  CITIES: "https://countriesnow.space/api/v0.1/countries/cities",
  TICKETMASTER: "https://app.ticketmaster.com/discovery/v2/events.json",
  // Put your Ticketmaster key here (from the Postman docs). Without it, mock events are shown.
  TICKETMASTER_KEY: "",
  RATES: "https://open.er-api.com/v6/latest",
  SUN: "https://api.sunrise-sunset.org/json",
  STORAGE_PLANS: "wanderlust_plans",
  STORAGE_DEST: "wanderlust_destination",
};

// Used only if the countries API can't be reached
const FALLBACK_COUNTRIES = "AD Andorra|AL Albania|AM Armenia|AR Argentina|AT Austria|AU Australia|BA Bosnia and Herzegovina|BB Barbados|BE Belgium|BG Bulgaria|BJ Benin|BO Bolivia|BR Brazil|BS Bahamas|BW Botswana|BY Belarus|BZ Belize|CA Canada|CH Switzerland|CL Chile|CN China|CO Colombia|CR Costa Rica|CU Cuba|CY Cyprus|CZ Czechia|DE Germany|DK Denmark|DO Dominican Republic|EC Ecuador|EE Estonia|EG Egypt|ES Spain|FI Finland|FR France|GA Gabon|GB United Kingdom|GD Grenada|GE Georgia|GL Greenland|GM Gambia|GR Greece|GT Guatemala|GY Guyana|HK Hong Kong|HN Honduras|HR Croatia|HT Haiti|HU Hungary|ID Indonesia|IE Ireland|IS Iceland|IT Italy|JM Jamaica|JP Japan|KE Kenya|KR South Korea|KZ Kazakhstan|LI Liechtenstein|LS Lesotho|LT Lithuania|LU Luxembourg|LV Latvia|MA Morocco|MC Monaco|MD Moldova|ME Montenegro|MG Madagascar|MK North Macedonia|MN Mongolia|MT Malta|MX Mexico|MZ Mozambique|NA Namibia|NE Niger|NG Nigeria|NI Nicaragua|NL Netherlands|NO Norway|NZ New Zealand|PA Panama|PE Peru|PG Papua New Guinea|PL Poland|PR Puerto Rico|PT Portugal|PY Paraguay|RO Romania|RS Serbia|RU Russia|SE Sweden|SG Singapore|SI Slovenia|SK Slovakia|SM San Marino|SR Suriname|SV El Salvador|TN Tunisia|TR Turkey|UA Ukraine|US United States|UY Uruguay|VA Vatican City|VE Venezuela|VN Vietnam|ZA South Africa|ZW Zimbabwe"
  .split("|")
  .map((x) => ({ countryCode: x.slice(0, 2), name: x.slice(3) }));

/* ------------------------------ Helpers ------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const flagEmoji = (code) =>
  [...code.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Parse "YYYY-MM-DD" as a local date (avoids timezone shifts)
const parseDate = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtShort = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const heartIcon = (saved) => `<i class="fa-${saved ? "solid" : "regular"} fa-heart"></i>`;

/* ================================ Api ================================ */
class Api {
  async get(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }
  async countries() {
    return this.get(`${CONFIG.NAGER}/AvailableCountries`);
  }
  async countryInfo(code) {
    const data = await this.get(`${CONFIG.COUNTRIES}/alpha/${code}`);
    return Array.isArray(data) ? data[0] : data;
  }
  async holidays(year, code) {
    return this.get(`${CONFIG.NAGER}/PublicHolidays/${year}/${code}`);
  }
  async longWeekends(year, code) {
    return this.get(`${CONFIG.NAGER}/LongWeekend/${year}/${code}`);
  }
  async cities(countryName) {
    const data = await this.get(CONFIG.CITIES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: countryName }),
    });
    return data.data || [];
  }
  async geocode(city, code) {
    const data = await this.get(
      `${CONFIG.GEO}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`
    );
    const results = data.results || [];
    return results.find((r) => r.country_code === code) || results[0] || null;
  }
  async weather(lat, lon) {
    const q = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
      hourly: "temperature_2m,weather_code",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
      timezone: "auto",
      forecast_days: 7,
    });
    return this.get(`${CONFIG.METEO}?${q}`);
  }
  async events(city, code) {
    if (!CONFIG.TICKETMASTER_KEY) throw new Error("No Ticketmaster key");
    const q = new URLSearchParams({
      apikey: CONFIG.TICKETMASTER_KEY,
      city,
      countryCode: code,
      size: 12,
      sort: "date,asc",
    });
    const data = await this.get(`${CONFIG.TICKETMASTER}?${q}`);
    return data._embedded?.events || [];
  }
  async rates(base = "USD") {
    const data = await this.get(`${CONFIG.RATES}/${base}`);
    return data.rates || data.conversion_rates;
  }
  async sun(lat, lon, date) {
    const data = await this.get(`${CONFIG.SUN}?lat=${lat}&lng=${lon}&date=${date}&formatted=0`);
    return data.results;
  }
}

/* ============================ PlansManager ============================ */
class PlansManager {
  constructor(onChange) {
    this.onChange = onChange;
    this.plans = this.#load();
  }
  #load() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.STORAGE_PLANS)) || [];
    } catch {
      return [];
    }
  }
  #persist() {
    try {
      localStorage.setItem(CONFIG.STORAGE_PLANS, JSON.stringify(this.plans));
    } catch {
      /* storage unavailable */
    }
    this.onChange(this.plans);
  }
  has(id) {
    return this.plans.some((p) => p.id === id);
  }
  /** Adds the plan or removes it if already saved. Returns true when saved. */
  toggle(plan) {
    if (this.has(plan.id)) {
      this.remove(plan.id);
      return false;
    }
    this.plans.push({ ...plan, savedAt: Date.now() });
    this.#persist();
    return true;
  }
  remove(id) {
    this.plans = this.plans.filter((p) => p.id !== id);
    this.#persist();
  }
  clear() {
    this.plans = [];
    this.#persist();
  }
  count(type) {
    return type === "all" ? this.plans.length : this.plans.filter((p) => p.type === type).length;
  }
}

/* ================================ Ui ================================ */
class Ui {
  constructor() {
    this.loader = $("#loading-overlay");
    this.loaderText = $("#loading-text");
    this.toasts = $("#toast-container");
    this.modal = $("#modal-overlay");
    this.modalBody = $("#modal-body");
    $("#modal-close-btn").addEventListener("click", () => this.closeModal());
    this.modal.addEventListener("click", (e) => e.target === this.modal && this.closeModal());
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.closeModal());
  }
  showLoading(text = "Loading...") {
    this.loaderText.textContent = text;
    this.loader.classList.remove("hidden");
  }
  hideLoading() {
    this.loader.classList.add("hidden");
  }
  toast(message, type = "info") {
    const icons = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span>
      <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`;
    const remove = () => el.remove();
    $(".toast-close", el).addEventListener("click", remove);
    this.toasts.appendChild(el);
    setTimeout(remove, 3500);
  }
  openModal(html) {
    this.modalBody.innerHTML = html;
    this.modal.classList.remove("hidden");
  }
  closeModal() {
    this.modal.classList.add("hidden");
  }
  async confirm(title, text) {
    if (window.Swal) {
      const r = await Swal.fire({
        title,
        text,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        confirmButtonText: "Yes, do it",
      });
      return r.isConfirmed;
    }
    return window.confirm(`${title}\n${text}`);
  }
  emptyState(icon, title, text) {
    return `<div class="empty-state"><div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
      <h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }
}

/* =============================== Router =============================== */
class Router {
  // view id -> URL segment
  static PATHS = {
    dashboard: "",
    holidays: "holidays",
    events: "events",
    weather: "weather",
    "long-weekends": "long-weekends",
    currency: "currency",
    "sun-times": "sun-times",
    "my-plans": "plans",
  };
  static TITLES = {
    dashboard: ["Dashboard", "Welcome back! Ready to plan your next adventure?"],
    holidays: ["Holidays", "Public holidays to help you time your trip"],
    events: ["Events", "Concerts, sports and arts in your destination"],
    weather: ["Weather", "7-day forecast with all the details"],
    "long-weekends": ["Long Weekends", "Perfect windows for a mini-trip"],
    currency: ["Currency Converter", "Live exchange rates"],
    "sun-times": ["Sun Times", "Sunrise, sunset and golden hour"],
    "my-plans": ["My Plans", "Everything you saved for your trip"],
  };
  constructor(onNavigate) {
    this.onNavigate = onNavigate;
    this.current = null;
    this.base = Router.findBase();
    $$("[data-view]").forEach((link) =>
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.go(link.dataset.view);
      })
    );
    window.addEventListener("popstate", () => this.show(this.fromLocation(), false));
    window.addEventListener("hashchange", () => this.show(this.fromLocation(), false));
  }
  /** Directory the app is served from (so URLs stay inside it, e.g. /Wanderlust/weather). */
  static findBase() {
    const routes = Object.values(Router.PATHS).filter(Boolean).concat("my-plans");
    const parts = location.pathname.split("/");
    const last = parts[parts.length - 1].toLowerCase().replace(/\.html$/, "");
    if (last === "index" || routes.includes(last) || last.endsWith(".html")) parts.pop();
    else if (last === "") parts.pop();
    return parts.join("/") + "/";
  }
  fromLocation() {
    const seg = (location.hash.replace(/^#\/?/, "") || location.pathname.split("/").filter(Boolean).pop() || "")
      .toLowerCase()
      .replace(/\.html$/, "");
    if (seg === "my-plans") return "my-plans";
    const entry = Object.entries(Router.PATHS).find(([, p]) => p === seg);
    return entry ? entry[0] : "dashboard";
  }
  go(view) {
    this.show(view, true);
  }
  show(view, push) {
    if (!Object.hasOwn(Router.PATHS, view)) view = "dashboard";
    if (push && view !== this.current) {
      const url = this.base + Router.PATHS[view];
      try {
        history.pushState({ view }, "", url);
      } catch {
        // e.g. opened via file:// – fall back to hash URLs
        location.hash = "/" + Router.PATHS[view];
      }
    }
    this.current = view;
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `${view}-view`));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    const [title, subtitle] = Router.TITLES[view];
    $("#page-title").textContent = title;
    $("#page-subtitle").textContent = subtitle;
    $("#sidebar").classList.remove("open");
    $("#sidebar-overlay").classList.add("hidden");
    window.scrollTo({ top: 0 });
    this.onNavigate(view);
  }
}

/* ============================ Destination ============================ */
/** Holds the current selection plus data shared across views. */
class Destination {
  constructor() {
    this.code = "";
    this.countryName = "";
    this.city = "";
    this.year = new Date().getFullYear();
    this.info = null; // REST Countries payload
    this.coords = null; // { lat, lon, tz }
  }
  get isSet() {
    return Boolean(this.code);
  }
  get flag() {
    return `https://flagcdn.com/w40/${this.code.toLowerCase()}.png`;
  }
  save() {
    try {
      localStorage.setItem(
        CONFIG.STORAGE_DEST,
        JSON.stringify({ code: this.code, city: this.city, year: this.year })
      );
    } catch {
      /* ignore */
    }
  }
  static restore() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.STORAGE_DEST));
    } catch {
      return null;
    }
  }
}

/* ============================ Base View ============================ */
class BaseView {
  constructor(app) {
    this.app = app;
    this.api = app.api;
    this.ui = app.ui;
    this.dest = app.dest;
  }
  /** Header badge ("🇪🇬 Egypt • Cairo") inside a view header card */
  badge(withCity = true, withYear = false) {
    const d = this.dest;
    return `<div class="current-selection-badge">
      <img src="${d.flag}" alt="${esc(d.countryName)}" class="selection-flag">
      <span>${esc(d.countryName)}</span>
      ${withCity ? `<span class="selection-city">• ${esc(d.city)}</span>` : ""}
      ${withYear ? `<span class="selection-year">${d.year}</span>` : ""}
    </div>`;
  }
  setBadge(container, html) {
    if (container) container.innerHTML = html;
  }
  noDestination(el) {
    el.innerHTML = this.ui.emptyState(
      "fa-earth-americas",
      "No destination selected",
      "Pick a country on the Dashboard and press Explore."
    );
  }
  loadingBox(el, text = "Loading...") {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-spinner fa-spin"></i></div><p>${esc(text)}</p></div>`;
  }
  errorBox(el, msg) {
    el.innerHTML = this.ui.emptyState("fa-triangle-exclamation", "Something went wrong", msg);
  }
}

/* ============================ Dashboard ============================ */
class DashboardView extends BaseView {
  constructor(app) {
    super(app);
    this.clockTimer = null;
    this.countrySelect = $("#global-country");
    this.citySelect = $("#global-city");
    this.yearSelect = $("#global-year");
    this.#fillYears();
    this.countrySelect.addEventListener("change", () => this.#onCountryChange());
    $("#global-search-btn").addEventListener("click", () => app.explore());
    $("#clear-selection-btn").addEventListener("click", () => app.clearDestination());
  }
  #fillYears() {
    const y = new Date().getFullYear();
    this.yearSelect.innerHTML = Array.from({ length: 5 }, (_, i) => y - 1 + i)
      .map((v) => `<option value="${v}" ${v === y ? "selected" : ""}>${v}</option>`)
      .join("");
  }
  async populateCountries() {
    let list;
    try {
      list = await this.api.countries();
      if (!Array.isArray(list) || !list.length) throw new Error("empty");
    } catch {
      list = [...FALLBACK_COUNTRIES];
      this.ui.toast("Using offline country list (API unreachable)", "info");
    }
    {
      list.sort((a, b) => a.name.localeCompare(b.name));
      this.countrySelect.innerHTML =
        `<option value="">Select Country</option>` +
        list
          .map((c) => `<option value="${c.countryCode}" data-name="${esc(c.name)}">${flagEmoji(c.countryCode)} ${esc(c.name)}</option>`)
          .join("");
      $("#stat-countries").textContent = list.length;
    }
  }
  async #onCountryChange() {
    const code = this.countrySelect.value;
    if (!code) {
      this.citySelect.innerHTML = `<option value="">Select City</option>`;
      return;
    }
    await this.populateCities(code);
  }
  /** Fill the city select with the capital plus any extra cities we can find. */
  async populateCities(code, selected) {
    const name = this.countrySelect.selectedOptions[0]?.dataset.name || "";
    this.citySelect.innerHTML = `<option value="">Loading cities...</option>`;
    let capital = "";
    let cities = [];
    try {
      const info = await this.api.countryInfo(code);
      capital = info.capital?.[0] || "";
      this.app.cacheInfo(code, info);
    } catch {
      /* ignore */
    }
    try {
      cities = (await this.api.cities(name)).slice(0, 80);
    } catch {
      /* fallback to capital only */
    }
    const set = [...new Set([capital, ...cities].filter(Boolean))];
    if (!set.length) set.push(name);
    this.citySelect.innerHTML = set.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    this.citySelect.value = selected && set.includes(selected) ? selected : capital || set[0];
  }
  render() {
    const d = this.dest;
    const box = $("#selected-destination");
    const section = $("#dashboard-country-info-section");
    clearInterval(this.clockTimer);
    if (!d.isSet) {
      box.classList.add("hidden");
      section.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    section.classList.remove("hidden");
    $("#selected-country-flag").src = `https://flagcdn.com/w80/${d.code.toLowerCase()}.png`;
    $("#selected-country-flag").alt = d.countryName;
    $("#selected-country-name").textContent = d.countryName;
    $("#selected-city-name").textContent = `• ${d.city}`;
    this.#renderInfo();
  }
  #renderInfo() {
    const d = this.dest;
    const i = d.info;
    const target = $("#dashboard-country-info");
    if (!i) {
      this.errorBox(target, "Country details are unavailable right now.");
      return;
    }
    const tzLabel = i.timezones?.[0] || "UTC";
    const currencies = Object.entries(i.currencies || {})
      .map(([code, c]) => `<span class="extra-tag">${esc(c.name)} (${esc(code)} ${esc(c.symbol || "")})</span>`)
      .join("");
    const langs = Object.values(i.languages || {})
      .map((l) => `<span class="extra-tag">${esc(l)}</span>`)
      .join("");
    const borders = (i.borders || []).length
      ? i.borders.map((b) => `<span class="extra-tag border-tag">${esc(b)}</span>`).join("")
      : `<span class="extra-tag">Island / no land borders</span>`;
    const calling = i.idd?.root ? i.idd.root + (i.idd.suffixes?.length === 1 ? i.idd.suffixes[0] : "") : "N/A";
    const detail = (icon, label, value) =>
      `<div class="dashboard-country-detail"><i class="fa-solid ${icon}"></i>
        <span class="label">${label}</span><span class="value">${esc(value)}</span></div>`;
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "N/A");
    target.innerHTML = `
      <div class="dashboard-country-header">
        <img src="${esc(i.flags?.png || `https://flagcdn.com/w160/${d.code.toLowerCase()}.png`)}" alt="${esc(d.countryName)}" class="dashboard-country-flag">
        <div class="dashboard-country-title">
          <h3>${esc(i.name.common)}</h3>
          <p class="official-name">${esc(i.name.official)}</p>
          <span class="region"><i class="fa-solid fa-location-dot"></i> ${esc(i.region)}${i.subregion ? " • " + esc(i.subregion) : ""}</span>
        </div>
      </div>
      <div class="dashboard-local-time">
        <div class="local-time-display">
          <i class="fa-solid fa-clock"></i>
          <span class="local-time-value" id="country-local-time">--:--:--</span>
          <span class="local-time-zone">${esc(tzLabel)}</span>
        </div>
      </div>
      <div class="dashboard-country-grid">
        ${detail("fa-building-columns", "Capital", i.capital?.join(", ") || "N/A")}
        ${detail("fa-users", "Population", (i.population || 0).toLocaleString())}
        ${detail("fa-ruler-combined", "Area", `${(i.area || 0).toLocaleString()} km²`)}
        ${detail("fa-globe", "Continent", i.continents?.[0] || i.region)}
        ${detail("fa-phone", "Calling Code", calling)}
        ${detail("fa-car", "Driving Side", cap(i.car?.side))}
        ${detail("fa-calendar-week", "Week Starts", cap(i.startOfWeek))}
      </div>
      <div class="dashboard-country-extras">
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-coins"></i> Currency</h4><div class="extra-tags">${currencies || "N/A"}</div></div>
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-language"></i> Languages</h4><div class="extra-tags">${langs || "N/A"}</div></div>
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-map-location-dot"></i> Neighbors</h4><div class="extra-tags">${borders}</div></div>
      </div>
      <div class="dashboard-country-actions">
        <a href="${esc(i.maps?.googleMaps || "https://www.google.com/maps")}" target="_blank" rel="noopener" class="btn-map-link">
          <i class="fa-solid fa-map"></i> View on Google Maps</a>
      </div>`;
    this.#startClock();
  }
  #startClock() {
    const tick = () => {
      const el = $("#country-local-time");
      if (!el) return clearInterval(this.clockTimer);
      el.textContent = this.app.timeIn(this.dest, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    tick();
    this.clockTimer = setInterval(tick, 1000);
  }
}

/* ============================== Holidays ============================== */
class HolidaysView extends BaseView {
  constructor(app) {
    super(app);
    this.content = $("#holidays-content");
    this.items = [];
  }
  async load() {
    const d = this.dest;
    if (!d.isSet) {
      this.items = [];
      this.setBadge($("#holidays-selection"), "");
      return this.noDestination(this.content);
    }
    this.setBadge($("#holidays-selection"), this.badge(false, true));
    this.loadingBox(this.content, "Loading holidays...");
    try {
      const data = await this.api.holidays(d.year, d.code);
      this.items = data.map((h) => ({
        id: `holiday-${d.code}-${h.date}`,
        type: "holiday",
        title: h.name,
        subtitle: h.localName,
        date: h.date,
        countryCode: d.code,
        country: d.countryName,
        city: d.city,
        extra: (h.types || ["Public"])[0],
      }));
      $("#stat-holidays").textContent = this.items.length;
      this.render();
    } catch (err) {
      $("#stat-holidays").textContent = 0;
      this.errorBox(this.content, "We couldn't load holidays for this country and year.");
    }
  }
  render() {
    if (!this.items.length) {
      this.content.innerHTML = this.ui.emptyState("fa-calendar-xmark", "No holidays found", "Try another year or country.");
      return;
    }
    this.content.innerHTML = this.items
      .map((h) => {
        const dt = parseDate(h.date);
        const saved = this.app.plans.has(h.id);
        return `<div class="holiday-card">
          <div class="holiday-card-header">
            <div class="holiday-date-box"><span class="day">${dt.getDate()}</span><span class="month">${MONTHS[dt.getMonth()]}</span></div>
            <button class="holiday-action-btn ${saved ? "saved" : ""}" data-save="${esc(h.id)}" title="Save to My Plans">${heartIcon(saved)}</button>
          </div>
          <h3>${esc(h.title)}</h3>
          <p class="holiday-name">${esc(h.subtitle)}</p>
          <div class="holiday-card-footer">
            <span class="holiday-day-badge"><i class="fa-regular fa-calendar"></i> ${DAYS[dt.getDay()]}</span>
            <span class="holiday-type-badge">${esc(h.extra)}</span>
          </div>
        </div>`;
      })
      .join("");
  }
}

/* ============================ Long Weekends ============================ */
class LongWeekendsView extends BaseView {
  constructor(app) {
    super(app);
    this.content = $("#lw-content");
    this.items = [];
  }
  async load() {
    const d = this.dest;
    const badgeBox = $("#long-weekends-view .view-header-selection");
    if (!d.isSet) {
      this.items = [];
      this.setBadge(badgeBox, "");
      return this.noDestination(this.content);
    }
    this.setBadge(badgeBox, this.badge(false, true));
    this.loadingBox(this.content, "Finding long weekends...");
    try {
      const data = await this.api.longWeekends(d.year, d.code);
      this.items = data.map((lw, i) => ({
        id: `lw-${d.code}-${lw.startDate}`,
        type: "longweekend",
        title: `Long Weekend #${i + 1}`,
        subtitle: `${lw.dayCount} days`,
        date: lw.startDate,
        endDate: lw.endDate,
        dayCount: lw.dayCount,
        needBridge: lw.needBridgeDays,
        countryCode: d.code,
        country: d.countryName,
        city: d.city,
      }));
      this.render();
    } catch {
      this.errorBox(this.content, "We couldn't load long weekends for this selection.");
    }
  }
  render() {
    if (!this.items.length) {
      this.content.innerHTML = this.ui.emptyState("fa-umbrella-beach", "No long weekends", "Nothing found for this year.");
      return;
    }
    this.content.innerHTML = this.items
      .map((lw) => {
        const start = parseDate(lw.date);
        const end = parseDate(lw.endDate);
        const saved = this.app.plans.has(lw.id);
        const days = [];
        for (let t = new Date(start); t <= end && days.length < 10; t.setDate(t.getDate() + 1)) {
          const wk = t.getDay() === 5 || t.getDay() === 6 || t.getDay() === 0;
          days.push(`<div class="lw-day ${wk ? "weekend" : ""}"><span class="name">${DAYS[t.getDay()].slice(0, 3)}</span><span class="num">${t.getDate()}</span></div>`);
        }
        return `<div class="lw-card">
          <div class="lw-card-header">
            <span class="lw-badge"><i class="fa-solid fa-calendar-days"></i> ${lw.dayCount} Days</span>
            <button class="holiday-action-btn ${saved ? "saved" : ""}" data-save="${esc(lw.id)}" title="Save to My Plans">${heartIcon(saved)}</button>
          </div>
          <h3>${esc(lw.title)}</h3>
          <div class="lw-dates"><i class="fa-regular fa-calendar"></i> ${fmtShort(start)} - ${fmtShort(end)}, ${end.getFullYear()}</div>
          ${
            lw.needBridge
              ? `<div class="lw-info-box warning"><i class="fa-solid fa-info-circle"></i> Requires taking a bridge day off</div>`
              : `<div class="lw-info-box success"><i class="fa-solid fa-check-circle"></i> No extra days off needed!</div>`
          }
          <div class="lw-days-visual">${days.join("")}</div>
        </div>`;
      })
      .join("");
  }
}

/* =============================== Events =============================== */
class EventsView extends BaseView {
  static IMAGES = {
    Music: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=200&fit=crop",
    Sports: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&h=200&fit=crop",
    Arts: "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=400&h=200&fit=crop",
    Family: "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=200&fit=crop",
  };
  constructor(app) {
    super(app);
    this.content = $("#events-content");
    this.items = [];
  }
  async load() {
    const d = this.dest;
    const badgeBox = $("#events-view .view-header-selection");
    if (!d.isSet) {
      this.items = [];
      this.setBadge(badgeBox, "");
      return this.noDestination(this.content);
    }
    $("#events-view .view-header-content p").textContent = `Discover concerts, sports, theatre and more in ${d.city}`;
    this.setBadge(badgeBox, this.badge(true));
    this.loadingBox(this.content, "Finding events...");
    let events = [];
    try {
      const raw = await this.api.events(d.city, d.code);
      events = raw.map((e) => this.#fromTicketmaster(e));
    } catch {
      /* fall through to mock events */
    }
    if (!events.length) events = this.#mock();
    this.items = events;
    $("#stat-events").textContent = events.length;
    this.render();
  }
  #fromTicketmaster(e) {
    const d = this.dest;
    const venue = e._embedded?.venues?.[0];
    const date = e.dates?.start?.localDate || `${d.year}-01-01`;
    const category = e.classifications?.[0]?.segment?.name || "Event";
    return {
      id: `event-${e.id}`,
      type: "event",
      title: e.name,
      date,
      time: (e.dates?.start?.localTime || "").slice(0, 5),
      venue: venue ? `${venue.name}, ${venue.city?.name || d.city}` : d.city,
      category,
      image: [...(e.images || [])].sort((a, b) => b.width - a.width)[0]?.url || EventsView.IMAGES[category] || EventsView.IMAGES.Music,
      url: e.url || "#",
      countryCode: d.code,
      country: d.countryName,
      city: d.city,
    };
  }
  #mock() {
    const d = this.dest;
    const base = [
      ["Music", "Jazz Night Live", "Opera House", 2, 15, "20:00"],
      ["Sports", "Football Match", "National Stadium", 2, 22, "19:00"],
      ["Arts", "Theatre Play", "Cultural Center", 3, 5, "21:00"],
      ["Music", "Symphony Orchestra", "Grand Concert Hall", 3, 12, "19:30"],
      ["Music", "Open Air Festival", "City Park", 4, 3, "18:00"],
      ["Sports", "Basketball Night", "Sports Arena", 4, 18, "20:30"],
      ["Arts", "Contemporary Art Expo", "Modern Art Gallery", 5, 9, "10:00"],
      ["Family", "Family Fun Day", "Central Square", 5, 24, "11:00"],
    ];
    return base.map(([category, name, venue, m, day, time]) => ({
      id: `event-mock-${d.code}-${d.city}-${d.year}-${m}-${day}`.replace(/\s+/g, "-"),
      type: "event",
      title: `${name} in ${d.city}`,
      date: `${d.year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time,
      venue: `${d.city} ${venue}, ${d.city}`,
      category,
      image: EventsView.IMAGES[category],
      url: "#",
      mock: true,
      countryCode: d.code,
      country: d.countryName,
      city: d.city,
    }));
  }
  render() {
    this.content.innerHTML = this.items
      .map((e) => {
        const dt = parseDate(e.date);
        const saved = this.app.plans.has(e.id);
        return `<div class="event-card">
          <div class="event-card-image">
            <img src="${esc(e.image)}" alt="${esc(e.title)}" loading="lazy">
            <span class="event-card-category">${esc(e.category)}</span>
            <button class="event-card-save ${saved ? "saved" : ""}" data-save="${esc(e.id)}">${heartIcon(saved)}</button>
          </div>
          <div class="event-card-body">
            <h3>${esc(e.title)}</h3>
            <div class="event-card-info">
              <div><i class="fa-regular fa-calendar"></i>${fmtShort(dt)}, ${dt.getFullYear()}${e.time ? " at " + esc(e.time) : ""}</div>
              <div><i class="fa-solid fa-location-dot"></i>${esc(e.venue)}</div>
            </div>
            <div class="event-card-footer">
              <button class="btn-event ${saved ? "saved" : ""}" data-save="${esc(e.id)}">${heartIcon(saved)} ${saved ? "Saved" : "Save"}</button>
              <a href="${esc(e.url)}" target="_blank" rel="noopener" class="btn-buy-ticket"><i class="fa-solid fa-ticket"></i> Buy Tickets</a>
            </div>
          </div>
        </div>`;
      })
      .join("");
  }
}

/* =============================== Weather =============================== */
class WeatherView extends BaseView {
  static CODES = {
    0: ["Clear sky", "fa-sun", "weather-sunny"],
    1: ["Mainly clear", "fa-sun", "weather-sunny"],
    2: ["Partly cloudy", "fa-cloud-sun", "weather-cloudy"],
    3: ["Overcast", "fa-cloud", "weather-cloudy"],
    45: ["Fog", "fa-smog", "weather-foggy"],
    48: ["Rime fog", "fa-smog", "weather-foggy"],
    51: ["Light drizzle", "fa-cloud-rain", "weather-rainy"],
    53: ["Drizzle", "fa-cloud-rain", "weather-rainy"],
    55: ["Heavy drizzle", "fa-cloud-rain", "weather-rainy"],
    61: ["Light rain", "fa-cloud-rain", "weather-rainy"],
    63: ["Rain", "fa-cloud-showers-heavy", "weather-rainy"],
    65: ["Heavy rain", "fa-cloud-showers-heavy", "weather-rainy"],
    71: ["Light snow", "fa-snowflake", "weather-snowy"],
    73: ["Snow", "fa-snowflake", "weather-snowy"],
    75: ["Heavy snow", "fa-snowflake", "weather-snowy"],
    77: ["Snow grains", "fa-snowflake", "weather-snowy"],
    80: ["Rain showers", "fa-cloud-sun-rain", "weather-rainy"],
    81: ["Rain showers", "fa-cloud-sun-rain", "weather-rainy"],
    82: ["Violent showers", "fa-cloud-showers-heavy", "weather-rainy"],
    85: ["Snow showers", "fa-snowflake", "weather-snowy"],
    86: ["Snow showers", "fa-snowflake", "weather-snowy"],
    95: ["Thunderstorm", "fa-bolt", "weather-stormy"],
    96: ["Thunderstorm with hail", "fa-bolt", "weather-stormy"],
    99: ["Thunderstorm with hail", "fa-bolt", "weather-stormy"],
  };
  constructor(app) {
    super(app);
    this.content = $("#weather-content");
  }
  static info(code) {
    return WeatherView.CODES[code] || ["Unknown", "fa-cloud", "weather-default"];
  }
  async load() {
    const d = this.dest;
    const badgeBox = $("#weather-view .view-header-selection");
    if (!d.isSet || !d.coords) {
      this.setBadge(badgeBox, "");
      return this.noDestination(this.content);
    }
    $("#weather-view .view-header-content p").textContent = `Check 7-day weather forecasts for ${d.city}`;
    this.setBadge(badgeBox, this.badge(true));
    this.loadingBox(this.content, "Loading forecast...");
    try {
      const w = await this.api.weather(d.coords.lat, d.coords.lon);
      this.render(w);
    } catch {
      this.errorBox(this.content, "We couldn't load the forecast right now.");
    }
  }
  render(w) {
    const c = w.current;
    const [label, icon, cls] = WeatherView.info(c.weather_code);
    const today = new Date(c.time);
    // Hourly: from the current hour, next 12 hours
    const startIdx = Math.max(0, w.hourly.time.findIndex((t) => t >= c.time.slice(0, 13) + ":00"));
    const hours = w.hourly.time.slice(startIdx, startIdx + 12).map((t, i) => {
      const idx = startIdx + i;
      const h = new Date(t).getHours();
      const lbl = i === 0 ? "Now" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
      return `<div class="hourly-item ${i === 0 ? "now" : ""}">
        <span class="hourly-time">${lbl}</span>
        <div class="hourly-icon"><i class="fa-solid ${WeatherView.info(w.hourly.weather_code[idx])[1]}"></i></div>
        <span class="hourly-temp">${Math.round(w.hourly.temperature_2m[idx])}°</span></div>`;
    });
    const days = w.daily.time.map((t, i) => {
      const dt = parseDate(t);
      const prob = w.daily.precipitation_probability_max[i];
      return `<div class="forecast-day ${i === 0 ? "today" : ""}">
        <div class="forecast-day-name"><span class="day-label">${i === 0 ? "Today" : DAYS[dt.getDay()].slice(0, 3)}</span><span class="day-date">${dt.getDate()} ${MONTHS[dt.getMonth()]}</span></div>
        <div class="forecast-icon"><i class="fa-solid ${WeatherView.info(w.daily.weather_code[i])[1]}"></i></div>
        <div class="forecast-temps"><span class="temp-max">${Math.round(w.daily.temperature_2m_max[i])}°</span><span class="temp-min">${Math.round(w.daily.temperature_2m_min[i])}°</span></div>
        <div class="forecast-precip">${prob > 0 ? `<i class="fa-solid fa-droplet"></i><span>${prob}%</span>` : ""}</div>
      </div>`;
    });
    const detail = (cls2, icon, name, value) =>
      `<div class="weather-detail-card"><div class="detail-icon ${cls2}"><i class="fa-solid ${icon}"></i></div>
        <div class="detail-info"><span class="detail-label">${name}</span><span class="detail-value">${value}</span></div></div>`;
    this.content.innerHTML = `
      <div class="weather-hero-card ${cls}">
        <div class="weather-location"><i class="fa-solid fa-location-dot"></i><span>${esc(this.dest.city)}</span>
          <span class="weather-time">${DAYS[today.getDay()]}, ${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}</span></div>
        <div class="weather-hero-main">
          <div class="weather-hero-left">
            <div class="weather-hero-icon"><i class="fa-solid ${icon}"></i></div>
            <div class="weather-hero-temp"><span class="temp-value">${Math.round(c.temperature_2m)}</span><span class="temp-unit">°C</span></div>
          </div>
          <div class="weather-hero-right">
            <div class="weather-condition">${label}</div>
            <div class="weather-feels">Feels like ${Math.round(c.apparent_temperature)}°C</div>
            <div class="weather-high-low">
              <span class="high"><i class="fa-solid fa-arrow-up"></i> ${Math.round(w.daily.temperature_2m_max[0])}°</span>
              <span class="low"><i class="fa-solid fa-arrow-down"></i> ${Math.round(w.daily.temperature_2m_min[0])}°</span>
            </div>
          </div>
        </div>
      </div>
      <div class="weather-details-grid">
        ${detail("humidity", "fa-droplet", "Humidity", `${c.relative_humidity_2m}%`)}
        ${detail("wind", "fa-wind", "Wind", `${Math.round(c.wind_speed_10m)} km/h`)}
        ${detail("uv", "fa-sun", "UV Index", Math.round(w.daily.uv_index_max[0]))}
        ${detail("precip", "fa-cloud-rain", "Precipitation", `${w.daily.precipitation_probability_max[0] ?? 0}%`)}
      </div>
      <div class="weather-section">
        <h3 class="weather-section-title"><i class="fa-solid fa-clock"></i> Hourly Forecast</h3>
        <div class="hourly-scroll">${hours.join("")}</div>
      </div>
      <div class="weather-section">
        <h3 class="weather-section-title"><i class="fa-solid fa-calendar-week"></i> 7-Day Forecast</h3>
        <div class="forecast-list">${days.join("")}</div>
      </div>`;
  }
}

/* ============================== Sun Times ============================== */
class SunTimesView extends BaseView {
  constructor(app) {
    super(app);
    this.content = $("#sun-times-content");
  }
  async load() {
    const d = this.dest;
    const badgeBox = $("#sun-times-view .view-header-selection");
    if (!d.isSet || !d.coords) {
      this.setBadge(badgeBox, "");
      return this.noDestination(this.content);
    }
    this.setBadge(badgeBox, this.badge(true));
    this.loadingBox(this.content, "Loading sun times...");
    try {
      const now = new Date();
      const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const r = await this.api.sun(d.coords.lat, d.coords.lon, iso);
      this.render(r, now);
    } catch {
      this.errorBox(this.content, "We couldn't load sun times right now.");
    }
  }
  #t(iso) {
    return this.app.timeIn(this.dest, { hour: "2-digit", minute: "2-digit" }, new Date(iso));
  }
  render(r, now) {
    const secs = Number(r.day_length);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const pct = ((secs / 86400) * 100).toFixed(1);
    const dark = 86400 - secs;
    const dh = Math.floor(dark / 3600);
    const dm = Math.floor((dark % 3600) / 60);
    const card = (cls, icon, label, time, sub) =>
      `<div class="sun-time-card ${cls}"><div class="icon"><i class="fa-solid ${icon}"></i></div>
        <div class="label">${label}</div><div class="time">${time}</div><div class="sub-label">${sub}</div></div>`;
    this.content.innerHTML = `
      <div class="sun-main-card">
        <div class="sun-main-header">
          <div class="sun-location"><h2><i class="fa-solid fa-location-dot"></i> ${esc(this.dest.city)}</h2><p>Sun times for your selected location</p></div>
          <div class="sun-date-display"><div class="date">${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}</div><div class="day">${DAYS[now.getDay()]}</div></div>
        </div>
        <div class="sun-times-grid">
          ${card("dawn", "fa-moon", "Dawn", this.#t(r.civil_twilight_begin), "Civil Twilight")}
          ${card("sunrise", "fa-sun", "Sunrise", this.#t(r.sunrise), "Golden Hour Start")}
          ${card("noon", "fa-sun", "Solar Noon", this.#t(r.solar_noon), "Sun at Highest")}
          ${card("sunset", "fa-sun", "Sunset", this.#t(r.sunset), "Golden Hour End")}
          ${card("dusk", "fa-moon", "Dusk", this.#t(r.civil_twilight_end), "Civil Twilight")}
          ${card("daylight", "fa-hourglass-half", "Day Length", `${h}h ${m}m`, "Total Daylight")}
        </div>
      </div>
      <div class="day-length-card">
        <h3><i class="fa-solid fa-chart-pie"></i> Daylight Distribution</h3>
        <div class="day-progress"><div class="day-progress-bar"><div class="day-progress-fill" style="width:${pct}%"></div></div></div>
        <div class="day-length-stats">
          <div class="day-stat"><div class="value">${h}h ${m}m</div><div class="label">Daylight</div></div>
          <div class="day-stat"><div class="value">${pct}%</div><div class="label">of 24 Hours</div></div>
          <div class="day-stat"><div class="value">${dh}h ${dm}m</div><div class="label">Darkness</div></div>
        </div>
      </div>`;
  }
}

/* ============================== Currency ============================== */
class CurrencyView extends BaseView {
  static POPULAR = { EUR: "eu", GBP: "gb", EGP: "eg", AED: "ae", SAR: "sa", JPY: "jp", CAD: "ca", INR: "in" };
  constructor(app) {
    super(app);
    this.rates = null;
    this.updated = null;
    this.suggestedCode = null;
    this.names = new Intl.DisplayNames(["en"], { type: "currency" });
    this.amount = $("#currency-amount");
    this.from = $("#currency-from");
    this.to = $("#currency-to");
    $("#convert-btn").addEventListener("click", () => this.convert());
    $("#swap-currencies-btn").addEventListener("click", () => this.swap());
    this.amount.addEventListener("keydown", (e) => e.key === "Enter" && this.convert());
    this.from.addEventListener("change", () => {
      this.convert();
      this.renderPopular();
    });
    this.to.addEventListener("change", () => this.convert());
  }
  name(code) {
    try {
      return this.names.of(code) || code;
    } catch {
      return code;
    }
  }
  async load() {
    if (this.rates) return;
    try {
      this.rates = await this.api.rates("USD");
      this.updated = new Date();
      const codes = Object.keys(this.rates).sort();
      const options = codes.map((c) => `<option value="${c}">${c} - ${esc(this.name(c))}</option>`).join("");
      this.from.innerHTML = options;
      this.to.innerHTML = options;
      this.from.value = "USD";
      this.to.value = this.rates[this.suggestedCode] ? this.suggestedCode : "EGP";
      this.convert();
      this.renderPopular();
    } catch {
      this.ui.toast("Could not load live exchange rates", "error");
    }
  }
  /** When a destination is picked, convert to its currency by default. */
  setSuggested(code) {
    this.suggestedCode = code;
    if (this.rates && this.rates[code]) {
      this.to.value = code;
      this.convert();
    }
  }
  rate(from, to) {
    return this.rates[to] / this.rates[from];
  }
  convert() {
    if (!this.rates) return;
    const amount = parseFloat(this.amount.value);
    if (isNaN(amount) || amount < 0) return this.ui.toast("Enter a valid amount", "error");
    const f = this.from.value;
    const t = this.to.value;
    const r = this.rate(f, t);
    const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $("#currency-result").innerHTML = `
      <div class="conversion-display">
        <div class="conversion-from"><span class="amount">${fmt(amount)}</span><span class="currency-code">${f}</span></div>
        <div class="conversion-equals"><i class="fa-solid fa-equals"></i></div>
        <div class="conversion-to"><span class="amount">${fmt(amount * r)}</span><span class="currency-code">${t}</span></div>
      </div>
      <div class="exchange-rate-info"><p>1 ${f} = ${r.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${t}</p>
        <small>Last updated: ${this.updated.toLocaleString()}</small></div>`;
  }
  swap() {
    [this.from.value, this.to.value] = [this.to.value, this.from.value];
    this.convert();
    this.renderPopular();
  }
  renderPopular() {
    const base = this.from.value || "USD";
    $("#popular-currencies").innerHTML = Object.entries(CurrencyView.POPULAR)
      .filter(([code]) => code !== base && this.rates[code])
      .map(([code, flag]) => {
        const r = this.rate(base, code);
        return `<div class="popular-currency-card">
          <img src="https://flagcdn.com/w40/${flag}.png" alt="${code}" class="flag">
          <div class="info"><div class="code">${code}</div><div class="name">${esc(this.name(code))}</div></div>
          <div class="rate">${r >= 100 ? r.toFixed(2) : r.toFixed(4)}</div></div>`;
      })
      .join("");
  }
}

/* ============================== My Plans ============================== */
class PlansView extends BaseView {
  constructor(app) {
    super(app);
    this.content = $("#plans-content");
    this.filter = "all";
    $$(".plan-filter").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.filter = btn.dataset.filter;
        $$(".plan-filter").forEach((b) => b.classList.toggle("active", b === btn));
        this.render();
      })
    );
    $("#clear-all-plans-btn").addEventListener("click", async () => {
      if (!app.plans.count("all")) return this.ui.toast("You have no saved plans", "info");
      if (await this.ui.confirm("Clear all plans?", "This will remove every saved plan.")) {
        app.plans.clear();
        this.ui.toast("All plans cleared", "success");
      }
    });
    this.content.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        app.plans.remove(rm.dataset.remove);
        this.ui.toast("Plan removed", "success");
      }
      if (e.target.closest("#start-exploring-btn")) app.router.go("dashboard");
    });
  }
  render() {
    const p = this.app.plans;
    $("#filter-all-count").textContent = p.count("all");
    $("#filter-holiday-count").textContent = p.count("holiday");
    $("#filter-event-count").textContent = p.count("event");
    $("#filter-lw-count").textContent = p.count("longweekend");
    const list = p.plans
      .filter((x) => this.filter === "all" || x.type === this.filter)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) {
      this.content.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-heart-crack"></i></div>
        <h3>No Saved Plans Yet</h3><p>Start exploring and save holidays, events, or long weekends you like!</p>
        <button class="btn-primary" id="start-exploring-btn"><i class="fa-solid fa-compass"></i> Start Exploring</button></div>`;
      return;
    }
    const labels = { holiday: "Holiday", event: "Event", longweekend: "Long Weekend" };
    this.content.innerHTML = list
      .map((x) => {
        const start = parseDate(x.date);
        const range = x.endDate ? `${fmtShort(start)} - ${fmtShort(parseDate(x.endDate))}, ${start.getFullYear()}` : `${fmtShort(start)}, ${start.getFullYear()}`;
        return `<div class="plan-card">
          <span class="plan-card-type ${x.type}">${labels[x.type]}</span>
          <div class="plan-card-content">
            <h4>${esc(x.title)}</h4>
            <div class="plan-card-details">
              <div><i class="fa-regular fa-calendar"></i>${range}</div>
              <div><i class="fa-solid fa-location-dot"></i>${esc(x.city || "")}${x.city ? ", " : ""}${esc(x.country || "")}</div>
              ${x.subtitle ? `<div><i class="fa-solid fa-circle-info"></i>${esc(x.subtitle)}</div>` : ""}
            </div>
            <div class="plan-card-actions">
              <button class="btn-plan-remove" data-remove="${esc(x.id)}"><i class="fa-solid fa-trash"></i> Remove</button>
            </div>
          </div>
        </div>`;
      })
      .join("");
  }
}

/* ================================ App ================================ */
class App {
  constructor() {
    this.api = new Api();
    this.ui = new Ui();
    this.dest = new Destination();
    this.infoCache = new Map();
    this.plans = new PlansManager(() => this.onPlansChanged());
    this.router = new Router((view) => this.onView(view));

    this.views = {
      dashboard: new DashboardView(this),
      holidays: new HolidaysView(this),
      events: new EventsView(this),
      weather: new WeatherView(this),
      "long-weekends": new LongWeekendsView(this),
      currency: new CurrencyView(this),
      "sun-times": new SunTimesView(this),
      "my-plans": new PlansView(this),
    };
    this.loaded = new Set(); // views already loaded for the current selection
    this.#bindGlobal();
  }

  cacheInfo(code, info) {
    this.infoCache.set(code, info);
  }

  /* ---------- Global wiring ---------- */
  #bindGlobal() {
    // Save/unsave buttons (holidays, events, long weekends) via delegation
    $("#main-content").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-save]");
      if (btn) this.#toggleSave(btn.dataset.save);
    });
    $("#mobile-menu-btn").addEventListener("click", () => {
      $("#sidebar").classList.toggle("open");
      $("#sidebar-overlay").classList.toggle("hidden");
    });
    $("#sidebar-overlay").addEventListener("click", () => {
      $("#sidebar").classList.remove("open");
      $("#sidebar-overlay").classList.add("hidden");
    });
    const tick = () => {
      $("#current-datetime").textContent = new Date().toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    };
    tick();
    setInterval(tick, 30000);
  }

  #findItem(id) {
    for (const key of ["holidays", "events", "long-weekends"]) {
      const hit = this.views[key].items.find((i) => i.id === id);
      if (hit) return hit;
    }
    return null;
  }

  #toggleSave(id) {
    const item = this.#findItem(id);
    if (!item) return;
    const saved = this.plans.toggle(item);
    this.ui.toast(saved ? "Saved to My Plans" : "Removed from My Plans", saved ? "success" : "info");
  }

  onPlansChanged() {
    const n = this.plans.count("all");
    const badge = $("#plans-count");
    badge.textContent = n;
    badge.classList.toggle("hidden", n === 0);
    $("#stat-saved").textContent = n;
    // Sync every save button currently in the DOM
    $$("[data-save]").forEach((btn) => {
      const saved = this.plans.has(btn.dataset.save);
      btn.classList.toggle("saved", saved);
      const label = btn.classList.contains("btn-event") ? ` ${saved ? "Saved" : "Save"}` : "";
      btn.innerHTML = heartIcon(saved) + label;
    });
    if (this.views?.["my-plans"]) this.views["my-plans"].render();
  }

  /* ---------- Time helper (uses city time zone when known) ---------- */
  timeIn(dest, opts, date = new Date()) {
    const tz = dest.coords?.tz;
    try {
      if (tz) return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(date);
    } catch {
      /* fall through */
    }
    // Fallback: parse "UTC+02:00" from REST Countries
    const m = /UTC([+-])(\d{2}):?(\d{2})?/.exec(dest.info?.timezones?.[0] || "");
    if (m) {
      const offset = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
      const shifted = new Date(date.getTime() + offset * 60000);
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(shifted);
    }
    return new Intl.DateTimeFormat("en-US", opts).format(date);
  }

  /* ---------- Destination flow ---------- */
  async explore() {
    const dash = this.views.dashboard;
    const code = dash.countrySelect.value;
    const city = dash.citySelect.value;
    if (!code || !city) return this.ui.toast("Please select a country and a city", "error");
    const d = this.dest;
    d.code = code;
    d.city = city;
    d.year = Number(dash.yearSelect.value);
    d.countryName = dash.countrySelect.selectedOptions[0].dataset.name || code;
    d.save();
    this.ui.showLoading(`Exploring ${city}...`);
    try {
      const [info, geo] = await Promise.allSettled([
        this.infoCache.get(code) ? Promise.resolve(this.infoCache.get(code)) : this.api.countryInfo(code),
        this.api.geocode(city, code),
      ]);
      d.info = info.status === "fulfilled" ? info.value : null;
      if (d.info) this.infoCache.set(code, d.info);
      const g = geo.status === "fulfilled" ? geo.value : null;
      if (g) d.coords = { lat: g.latitude, lon: g.longitude, tz: g.timezone };
      else if (d.info?.capitalInfo?.latlng) {
        const [lat, lon] = d.info.capitalInfo.latlng;
        d.coords = { lat, lon, tz: null };
      } else if (d.info?.latlng) {
        const [lat, lon] = d.info.latlng;
        d.coords = { lat, lon, tz: null };
      } else d.coords = null;

      const currency = Object.keys(d.info?.currencies || {})[0];
      if (currency) this.views.currency.setSuggested(currency);

      dash.render();
      this.loaded.clear();
      // Always load holidays + events so the dashboard stats are correct
      await Promise.allSettled([this.views.holidays.load(), this.views.events.load()]);
      this.loaded.add("holidays").add("events");
      this.#loadView(this.router.current);
      this.ui.toast(`Destination set: ${city}, ${d.countryName}`, "success");
    } catch {
      this.ui.toast("Something went wrong while loading the destination", "error");
    } finally {
      this.ui.hideLoading();
    }
  }

  clearDestination() {
    const d = this.dest;
    Object.assign(d, { code: "", countryName: "", city: "", info: null, coords: null });
    try {
      localStorage.removeItem(CONFIG.STORAGE_DEST);
    } catch {
      /* ignore */
    }
    this.loaded.clear();
    this.views.dashboard.render();
    $("#stat-holidays").textContent = 0;
    $("#stat-events").textContent = 0;
    for (const key of ["holidays", "events", "weather", "long-weekends", "sun-times"]) this.views[key].load();
  }

  /* ---------- View switching ---------- */
  onView(view) {
    if (!this.views) return;
    if (view === "my-plans") this.views["my-plans"].render();
    this.#loadView(view);
  }

  #loadView(view) {
    const lazy = ["holidays", "events", "weather", "long-weekends", "sun-times"];
    if (view === "currency") return this.views.currency.load();
    if (!lazy.includes(view)) return;
    if (this.loaded.has(view)) return;
    this.loaded.add(view);
    this.views[view].load();
  }

  /* ---------- Startup ---------- */
  async init() {
    this.onPlansChanged();
    this.ui.showLoading("Starting Wanderlust...");
    const dash = this.views.dashboard;
    await dash.populateCountries();

    const saved = Destination.restore() || { code: "EG", city: "Cairo", year: new Date().getFullYear() };
    if (dash.countrySelect.querySelector(`option[value="${saved.code}"]`)) {
      dash.countrySelect.value = saved.code;
      await dash.populateCities(saved.code, saved.city);
      if (dash.yearSelect.querySelector(`option[value="${saved.year}"]`)) dash.yearSelect.value = saved.year;
      await this.explore();
    } else {
      dash.render();
    }
    this.ui.hideLoading();
  }
}

/* ============================== Bootstrap ============================== */
const app = new App();
app.router.show(app.router.fromLocation(), false);
app.init();
