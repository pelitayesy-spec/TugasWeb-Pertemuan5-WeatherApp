'use strict';

/* ==========================================================
   Soft Weather Journal
   Data cuaca: OpenWeatherMap API
   ========================================================== */

// ⚠️ Ganti dengan API key milikmu dari https://openweathermap.org/api
const API_KEY = '535ef23ce7bf597a37ca1e68c7401b2f';
const BASE_URL = 'https://api.openweathermap.org/data/2.5';
const DEFAULT_CITY = 'Medan';

// Kunci localStorage
const HISTORY_KEY = 'softWeather.history';
const UNIT_KEY = 'softWeather.unit';
const LAST_KEY = 'softWeather.lastCity';
const MAX_HISTORY = 5;

// Data yang sedang ditampilkan. Suhu selalu disimpan dalam Celsius,
// lalu dikonversi saat ditampilkan, jadi toggle °C/°F tidak perlu fetch ulang.
const state = {
  unit: 'c',
  current: null,
  days: [],
};

// ---------- Ambil elemen HTML ----------
const $ = (selector) => document.querySelector(selector);

const els = {
  form: $('#search-form'),
  input: $('#city-input'),
  searchBtn: $('#search-btn'),
  status: $('#status'),
  statusTitle: $('#status-title'),
  statusText: $('#status-text'),
  result: $('#result'),
  dateline: $('#dateline'),
  city: $('#city'),
  country: $('#country'),
  temp: $('#temp'),
  icon: $('#icon'),
  condition: $('#condition'),
  feels: $('#feels'),
  humidity: $('#humidity'),
  meter: $('#meter'),
  wind: $('#wind'),
  pressure: $('#pressure'),
  daylight: $('#daylight'),
  forecastSection: $('#forecast-section'),
  forecastList: $('#forecast-list'),
  history: $('#history'),
  historyList: $('#history-list'),
  historyClear: $('#history-clear'),
  unitButtons: document.querySelectorAll('.unit-btn'),
};

// ---------- localStorage (dibungkus try/catch supaya aman) ----------
const readStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Kalau storage diblokir browser, aplikasi tetap jalan tanpa riwayat.
  }
};

// ---------- Helper format ----------
const toDisplayTemp = (celsius) =>
  Math.round(state.unit === 'c' ? celsius : (celsius * 9) / 5 + 32);

const formatTemp = (celsius) => `${toDisplayTemp(celsius)}°`;

// API memberi kecepatan angin dalam m/s
const formatWind = (metersPerSecond) =>
  state.unit === 'c'
    ? `${Math.round(metersPerSecond * 3.6)} km/h`
    : `${Math.round(metersPerSecond * 2.23694)} mph`;

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const getCountryName = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
  } catch (error) {
    return code;
  }
};

// Waktu lokal kota: timestamp UTC + selisih zona waktu (detik) dari API.
// Hasilnya dibaca dengan getUTC... supaya tidak tercampur zona waktu perangkat.
const toLocalDate = (unixSeconds, timezone) =>
  new Date((unixSeconds + timezone) * 1000);

const formatClock = (unixSeconds, timezone) => {
  const date = toLocalDate(unixSeconds, timezone);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const formatDateline = (timezone) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const local = toLocalDate(nowSeconds, timezone);
  const date = local.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${date}, ${formatClock(nowSeconds, timezone)} local time`;
};

// Menentukan "suasana" latar belakang dari kondisi cuaca
const getMood = (main) => {
  const moods = {
    Clear: 'clear',
    Clouds: 'clouds',
    Drizzle: 'rain',
    Rain: 'rain',
    Thunderstorm: 'storm',
    Snow: 'snow',
  };
  return moods[main] || 'mist'; // Mist, Fog, Haze, Smoke, dll.
};

// ---------- Fetch ke OpenWeatherMap ----------
const fetchWeather = async (endpoint, city) => {
  const url = `${BASE_URL}/${endpoint}?q=${encodeURIComponent(city)}&units=metric&appid=${API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    // Simpan status HTTP (404, 401, 429, ...) agar bisa dibedakan di error handling
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
};

// Forecast API berisi data tiap 3 jam. Di sini dikelompokkan per hari.
const buildDailyForecast = (list, timezone) => {
  // reduce: kelompokkan data berdasarkan tanggal lokal kota
  const grouped = list.reduce((groups, item) => {
    const local = toLocalDate(item.dt, timezone);
    const dateKey = local.toISOString().slice(0, 10);

    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push({ ...item, hour: local.getUTCHours() });
    return groups;
  }, {});

  // map: ubah tiap kelompok jadi ringkasan satu hari
  return Object.entries(grouped)
    .slice(0, 5)
    .map(([dateKey, items]) => {
      // ambil data yang paling dekat jam 12 siang untuk ikon
      const midday = items.reduce((best, item) =>
        Math.abs(item.hour - 12) < Math.abs(best.hour - 12) ? item : best
      );

      return {
        dateKey,
        min: Math.min(...items.map((item) => item.main.temp_min)),
        max: Math.max(...items.map((item) => item.main.temp_max)),
        icon: midday.weather[0].icon.replace('n', 'd'),
        description: midday.weather[0].description,
      };
    });
};

// ---------- Status: loading dan error ----------
const showStatus = (type, title, text = '') => {
  els.status.className = `status status--${type}`;
  els.statusTitle.textContent = title;
  els.statusText.textContent = text; // textContent = aman dari HTML injection
  els.status.hidden = false;
};

const hideStatus = () => {
  els.status.hidden = true;
};

const setLoading = (isLoading, city = '') => {
  els.searchBtn.disabled = isLoading;
  els.searchBtn.classList.toggle('is-loading', isLoading);
  els.result.classList.toggle('is-loading', isLoading);

  if (isLoading) {
    showStatus('loading', `Looking at the sky over ${city}…`);
  }
};

const getErrorMessage = (error, city) => {
  if (error.status === 'nokey') {
    return ['API key is missing', 'Open script.js and paste your OpenWeatherMap API key into API_KEY.'];
  }
  if (error.status === 404) {
    return [
      'City not found',
      `We couldn't find “${city}”. Check the spelling, or add a country code, like “Medan, ID”.`,
    ];
  }
  if (error.status === 401) {
    return [
      'The API key was rejected',
      'Check the key in script.js. A new key can take up to two hours to become active.',
    ];
  }
  if (error.status === 429) {
    return ['Too many requests', 'Please wait a minute, then search again.'];
  }
  if (error instanceof TypeError) {
    return ['No connection', 'The weather service could not be reached. Check your internet and try again.'];
  }
  return ['Something went wrong', 'The weather could not be loaded. Please try again.'];
};

// ---------- Render ----------
const renderCurrent = () => {
  const { name, sys, main, weather, wind, timezone } = state.current;
  const [condition] = weather;

  els.city.textContent = name;
  els.country.textContent = getCountryName(sys.country);
  els.temp.textContent = formatTemp(main.temp);
  els.icon.src = `https://openweathermap.org/img/wn/${condition.icon}@4x.png`;
  els.icon.alt = capitalize(condition.description);
  els.condition.textContent = capitalize(condition.description);
  els.feels.textContent = `Feels like ${formatTemp(main.feels_like)}`;

  els.humidity.textContent = `${main.humidity}%`;
  els.meter.style.setProperty('--value', `${main.humidity}%`);
  els.wind.textContent = formatWind(wind.speed);
  els.pressure.textContent = `${main.pressure} hPa`;
  els.daylight.textContent = `${formatClock(sys.sunrise, timezone)} – ${formatClock(sys.sunset, timezone)}`;

  els.dateline.textContent = formatDateline(timezone);
  document.title = `${name}, ${formatTemp(main.temp)} · Weather today`;
  document.body.dataset.mood = getMood(condition.main);
};

const renderForecast = () => {
  const html = state.days
    .map((day, index) => {
      const label = index === 0
        ? 'Today'
        : new Date(`${day.dateKey}T00:00:00Z`).toLocaleDateString('en-US', {
            weekday: 'short',
            timeZone: 'UTC',
          });

      return `
        <li class="day">
          <span class="day-name">${label}</span>
          <img src="https://openweathermap.org/img/wn/${day.icon}@2x.png"
               alt="${capitalize(day.description)}" width="52" height="52" loading="lazy">
          <span class="day-high">${formatTemp(day.max)}</span>
          <span class="day-low">${formatTemp(day.min)}</span>
        </li>`;
    })
    .join('');

  els.forecastList.innerHTML = html;
};

const renderHistory = () => {
  const history = readStorage(HISTORY_KEY, []);
  els.history.hidden = history.length === 0;

  const chips = history.map((city) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.city = city;
    button.textContent = city;
    return button;
  });

  els.historyList.replaceChildren(...chips);
};

const saveToHistory = (city) => {
  const history = readStorage(HISTORY_KEY, []);
  // filter: hapus nama yang sama (tanpa peduli huruf besar/kecil) agar tidak dobel
  const updated = [city, ...history.filter((item) => item.toLowerCase() !== city.toLowerCase())]
    .slice(0, MAX_HISTORY);

  writeStorage(HISTORY_KEY, updated);
  writeStorage(LAST_KEY, city);
  renderHistory();
};

// ---------- Fungsi utama: cari kota ----------
const searchCity = async (rawCity) => {
  const city = rawCity.trim();

  if (!city) {
    showStatus('error', 'Type a city first', 'Enter a city name, for example “Bandung”.');
    els.input.focus();
    return;
  }

  setLoading(true, city);

  try {
    if (API_KEY.startsWith('ISI_')) {
      const noKey = new Error('API key not set');
      noKey.status = 'nokey';
      throw noKey;
    }

    // Ambil cuaca sekarang dan forecast secara bersamaan
    const [current, forecast] = await Promise.all([
      fetchWeather('weather', city),
      fetchWeather('forecast', city),
    ]);

    state.current = current;
    state.days = buildDailyForecast(forecast.list, current.timezone);

    hideStatus();
    els.result.hidden = false;
    els.forecastSection.hidden = false;
    renderCurrent();
    renderForecast();

    // Jalankan ulang animasi masuk
    els.result.classList.remove('enter');
    void els.result.offsetWidth;
    els.result.classList.add('enter');

    saveToHistory(current.name);
    els.input.value = '';
  } catch (error) {
    const [title, text] = getErrorMessage(error, city);
    showStatus('error', title, text);
  } finally {
    setLoading(false);
  }
};

// ---------- Ganti satuan °C / °F ----------
const setUnit = (unit) => {
  state.unit = unit;
  writeStorage(UNIT_KEY, unit);

  els.unitButtons.forEach((button) => {
    const isActive = button.dataset.unit === unit;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (state.current) {
    renderCurrent();
    renderForecast();
  }
};

// ---------- Event listener ----------
els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  searchCity(els.input.value);
});

els.unitButtons.forEach((button) => {
  button.addEventListener('click', () => setUnit(button.dataset.unit));
});

els.historyList.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) searchCity(chip.dataset.city);
});

els.historyClear.addEventListener('click', () => {
  writeStorage(HISTORY_KEY, []);
  renderHistory();
});

// ---------- Mulai aplikasi ----------
const init = () => {
  els.dateline.textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  setUnit(readStorage(UNIT_KEY, 'c'));
  renderHistory();
  searchCity(readStorage(LAST_KEY, DEFAULT_CITY));
};

init();