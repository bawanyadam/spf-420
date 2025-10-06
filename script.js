// shouldiwearspf — tiny client-only app
// Uses browser geolocation + Open-Meteo APIs (no key) to fetch UV index.

(function () {
  const els = {
    app: document.getElementById("app"),
    headline: document.getElementById("headline"),
    subhead: document.getElementById("subhead"),
    uvNow: document.getElementById("uv-now"),
    uvMax: document.getElementById("uv-max"),
    location: document.getElementById("location"),
    retry: document.getElementById("retry"),
    manual: document.getElementById("manual"),
    city: document.getElementById("city"),
    lookup: document.getElementById("lookup"),
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function setState(state) {
    els.app.classList.remove(
      "is-loading",
      "state-yes",
      "state-no",
      "state-maybe",
    );
    if (state) els.app.classList.add(state);
  }

  function setHeadline(text, sub) {
    els.headline.textContent = text;
    els.subhead.textContent = sub || "";
  }

  function uvRecommendation(uvNow) {
    if (uvNow == null || Number.isNaN(uvNow))
      return {
        state: "state-maybe",
        title: "Hmm…",
        sub: "Could not read UV right now.",
      };
    if (uvNow >= 3)
      return {
        state: "state-yes",
        title: "YES",
        sub: "UV is 3 or higher — SPF up.",
      };
    if (uvNow >= 1)
      return {
        state: "state-maybe",
        title: "MAYBE",
        sub: "UV is low, but sun care never hurts.",
      };
    return {
      state: "state-no",
      title: "PROBABLY NOT",
      sub: "UV is minimal at the moment.",
    };
  }

  function toLocalHourISOString(date) {
    // Returns the local time truncated to the top of the hour, in ISO without seconds
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  }

  async function fetchUV(lat, lon) {
    // Prefer current + hourly for robustness; timezone auto aligns times to location
    const base = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: "uv_index",
      daily: "uv_index_max",
      timezone: "auto",
      forecast_days: "1",
    });
    const url = `${base}?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open‑Meteo error ${res.status}`);
    const data = await res.json();

    const times = data?.hourly?.time || [];
    const uv = data?.hourly?.uv_index || [];
    const dailyMax = data?.daily?.uv_index_max?.[0] ?? null;

    // Find UV for the current local hour string
    const currentHour = toLocalHourISOString(new Date());
    let idx = times.indexOf(currentHour);
    if (idx === -1) {
      // fallback to nearest upcoming hour within 2 slots
      idx = Math.max(
        0,
        times.findIndex((t) => t > currentHour),
      );
      if (idx === -1) idx = uv.length - 1;
    }
    const uvNow = uv[idx] ?? null;

    return {
      uvNow: uvNow != null ? Number(uvNow) : null,
      uvMax: dailyMax != null ? Number(dailyMax) : null,
    };
  }

  async function reverseGeocode(lat, lon) {
    try {
      const u = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      u.search = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        language: "en",
        format: "json",
      }).toString();
      const res = await fetch(u.toString());
      const data = await res.json();
      const place = data?.results?.[0];
      if (!place) return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
      const parts = [place.name, place.admin1, place.country].filter(Boolean);
      return parts.join(", ");
    } catch (_) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

  async function geocodeByName(name) {
    const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.search = new URLSearchParams({
      name,
      count: "1",
      language: "en",
      format: "json",
    }).toString();
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`Geocode error ${res.status}`);
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit) throw new Error("No matches found");
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
    };
  }

  function updateUI(info) {
    const { uvNow, uvMax, location } = info;
    els.uvNow.textContent =
      uvNow != null ? clamp(uvNow, 0, 20).toFixed(1) : "—";
    els.uvMax.textContent =
      uvMax != null ? clamp(uvMax, 0, 20).toFixed(1) : "—";
    els.location.textContent = location || "—";

    const rec = uvRecommendation(uvNow);
    setState(rec.state);
    setHeadline(rec.title, rec.sub);
  }

  function showManual(reason) {
    els.retry.hidden = false;
    els.manual.style.display = "grid";
    setHeadline(
      "We need a dot on Earth.",
      reason || "Location permission denied — type a city below.",
    );
  }

  async function handleLocation(lat, lon, labelOverride) {
    try {
      setHeadline("Crunching photons…", "Checking local UV right now.");
      const [{ uvNow, uvMax }, label] = await Promise.all([
        fetchUV(lat, lon),
        labelOverride
          ? Promise.resolve(labelOverride)
          : reverseGeocode(lat, lon),
      ]);
      updateUI({ uvNow, uvMax, location: label });
    } catch (err) {
      console.error(err);
      setHeadline("Hmm…", "UV lookup failed. Try again or use city search.");
      showManual("Could not reach the UV service.");
    }
  }

  function initGeolocation() {
    if (!("geolocation" in navigator)) {
      showManual("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        handleLocation(latitude, longitude);
      },
      (err) => {
        console.warn("Geolocation error", err);
        showManual("Location permission denied — type a city below.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  // Wire events
  els.retry.addEventListener("click", () => {
    setHeadline("Trying again…", "Prompting for your location.");
    initGeolocation();
  });

  els.lookup.addEventListener("click", async () => {
    const name = (els.city.value || "").trim();
    if (!name) return;
    setHeadline("Finding it…", "Geocoding your city.");
    try {
      const g = await geocodeByName(name);
      await handleLocation(g.lat, g.lon, g.label);
    } catch (err) {
      console.error(err);
      setHeadline("No luck.", "Try a more specific city name.");
    }
  });

  // Kick off
  window.addEventListener("DOMContentLoaded", () => {
    initGeolocation();
  });
})();
