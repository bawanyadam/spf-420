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

  const stripParenthetical = (value) => {
    if (typeof value !== "string") return value;
    return value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  };

  const friendlyCountryName = (value) => {
    const stripped = stripParenthetical(value);
    if (!stripped) return stripped;
    const normalized = stripped.toLowerCase();
    if (normalized === "united states of america") return "USA";
    if (normalized === "united kingdom of great britain and northern ireland")
      return "UK";
    if (normalized === "australia") return "Australia";
    if (normalized === "canada") return "Canada";
    return stripped;
  };

  const US_STATE_BY_ABBR = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    DC: "District of Columbia",
    PR: "Puerto Rico",
    GU: "Guam",
    VI: "Virgin Islands",
    MP: "Northern Mariana Islands",
    AS: "American Samoa",
  };

  const US_STATE_ABBR_BY_NAME = Object.entries(US_STATE_BY_ABBR).reduce(
    (acc, [abbr, full]) => {
      acc[full.toLowerCase()] = abbr;
      return acc;
    },
    {},
  );

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
        title: "yes",
        sub: "UV is 3 or higher\nSPF it",
      };
    if (uvNow >= 1)
      return {
        state: "state-maybe",
        title: "tbh prob",
        sub: "UV is low but why risk it",
      };
    return {
      state: "state-no",
      title: "not\nright\nnow",
      sub: "UV is minimal at the moment",
    };
  }

  function toLocalHourISOString(date) {
    // Returns the local time truncated to the top of the hour, in ISO without seconds
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  }

  function currentHourISOStringForOffset(offsetSeconds) {
    // Builds an ISO hour string using the target location timezone offset from UTC.
    const offset = Number(offsetSeconds);
    if (!Number.isFinite(offset)) return toLocalHourISOString(new Date());
    const target = new Date(Date.now() + offset * 1000);
    target.setUTCMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T${pad(target.getUTCHours())}:00`;
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
    const offsetSeconds = data?.utc_offset_seconds;

    // Find UV for the current local hour string
    const currentHour = currentHourISOStringForOffset(offsetSeconds);
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
    const fallback = formatCoordinates(lat, lon);

    // Attempt Open-Meteo reverse geocoding first
    try {
      const u = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      u.search = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        count: "1",
        language: "en",
        format: "json",
      }).toString();
      const res = await fetch(u.toString());
      if (res.ok) {
        const data = await res.json();
        const place = data?.results?.[0];
        if (place) {
          const primary =
            place.city || place.name || place.admin2 || place.admin1 || null;
          const secondary =
            place.admin1 && place.admin1 !== primary ? place.admin1 : null;
          const countryCode = (place.country_code || "").toUpperCase();
          const includeCountry = countryCode ? countryCode !== "US" : true;
          const countryName = includeCountry
            ? friendlyCountryName(place.country || place.country_code)
            : null;
          const parts = [primary, secondary, countryName].filter(Boolean);
          const joined = parts.join(", ");
          if (primary || joined) {
            return {
              name: primary || joined,
              label: joined || primary || fallback,
            };
          }
        }
      }
    } catch (_) {
      // swallow and fall through to fallback geocoder
    }

    // Fallback to BigDataCloud reverse geocoding (no key, permissive CORS)
    try {
      const fallbackUrl = new URL(
        "https://api.bigdatacloud.net/data/reverse-geocode-client",
      );
      fallbackUrl.search = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        localityLanguage: "en",
      }).toString();
      const res = await fetch(fallbackUrl.toString());
      if (res.ok) {
        const data = await res.json();
        const primary =
          data.city ||
          data.locality ||
          data.principalSubdivision ||
          data.countryName ||
          null;
        const secondary =
          data.principalSubdivision && data.principalSubdivision !== primary
            ? data.principalSubdivision
            : null;
        const countryCode = (data.countryCode || "").toUpperCase();
        const includeCountry = countryCode ? countryCode !== "US" : true;
        const countryName =
          includeCountry && data.countryName !== primary
            ? friendlyCountryName(data.countryName)
            : null;
        const parts = [primary, secondary, countryName].filter(Boolean);
        const joined = parts.join(", ");
        if (primary || joined) {
          return {
            name: primary || joined,
            label: joined || primary || fallback,
          };
        }
      }
    } catch (_) {
      // ignore and fall back to lat/lon
    }

    return {
      name: fallback,
      label: fallback,
    };
  }

  function parseManualLocationInput(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\s+/g, " ");
    const parts = normalized.split(",").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const city = parts[0];
    if (!city) return null;
    const remainder = parts.slice(1);
    const filterSet = new Set();
    remainder.forEach((segment) => {
      if (!segment) return;
      const lowerFull = segment.toLowerCase();
      if (lowerFull) filterSet.add(lowerFull);
      segment
        .split(/\s+/)
        .map((token) => token.toLowerCase())
        .forEach((token) => {
          if (token) filterSet.add(token);
        });
    });
    let stateAbbr = null;
    if (remainder.length) {
      const stateSegment = remainder[0].replace(/\./g, "").trim();
      if (stateSegment) {
        const upper = stateSegment.toUpperCase();
        if (US_STATE_BY_ABBR[upper]) {
          stateAbbr = upper;
        } else {
          const lowerState = stateSegment.toLowerCase();
          const lookup = US_STATE_ABBR_BY_NAME[lowerState];
          if (lookup) stateAbbr = lookup;
        }
      }
    }
    if (stateAbbr) {
      filterSet.add(stateAbbr.toLowerCase());
      const full = US_STATE_BY_ABBR[stateAbbr];
      if (full) filterSet.add(full.toLowerCase());
    }
    const likelyUS =
      !!stateAbbr ||
      remainder.some((part) =>
        /\busa\b|\bunited states\b|\bu\.s\.a\b|\bamerica\b/i.test(part),
      );
    return {
      city,
      filters: Array.from(filterSet),
      stateAbbr,
      likelyUS,
    };
  }

  function scoreGeocodeCandidate(hit, filters, stateAbbr) {
    if (!hit) return -Infinity;
    const tokens = new Set();
    const addTokens = (value) => {
      if (!value) return;
      const lower = value.toLowerCase();
      if (lower) tokens.add(lower);
      lower
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => tokens.add(token));
    };
    addTokens(hit.name);
    addTokens(hit.admin1);
    addTokens(hit.admin2);
    addTokens(hit.admin3);
    addTokens(hit.country);
    addTokens(hit.country_code);
    const admin1Lower = (hit.admin1 || "").toLowerCase();
    const adminAbbr = US_STATE_ABBR_BY_NAME[admin1Lower] || null;
    if (adminAbbr) tokens.add(adminAbbr.toLowerCase());
    const countryCode = (hit.country_code || "").toUpperCase();
    if (countryCode === "US") {
      tokens.add("usa");
      tokens.add("us");
      tokens.add("america");
      tokens.add("united states");
      tokens.add("united states of america");
    }
    const tokenList = Array.from(tokens);
    let score = 0;
    filters.forEach((filter) => {
      if (!filter) return;
      if (tokens.has(filter)) {
        score += 3;
      } else if (tokenList.some((token) => token.includes(filter))) {
        score += 1;
      }
    });
    if (stateAbbr && adminAbbr) {
      if (adminAbbr.toLowerCase() === stateAbbr.toLowerCase()) {
        score += 5;
      }
    }
    return score;
  }

  async function geocodeByName(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("No matches found");
    const parsed = parseManualLocationInput(trimmed);
    const queryName = parsed?.city || trimmed;
    const params = new URLSearchParams({
      name: queryName,
      count: parsed?.filters?.length ? "5" : "1",
      language: "en",
      format: "json",
    });
    if (parsed?.likelyUS) {
      params.set("country", "United States");
    }
    const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.search = params.toString();
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`Geocode error ${res.status}`);
    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) throw new Error("No matches found");
    let hit = results[0];
    if (parsed?.filters?.length) {
      const scored = results
        .map((candidate) => ({
          candidate,
          score: scoreGeocodeCandidate(
            candidate,
            parsed.filters,
            parsed.stateAbbr,
          ),
        }))
        .sort((a, b) => b.score - a.score);
      if (scored.length && scored[0].score > 0) {
        hit = scored[0].candidate;
      }
    }
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      name: hit.name,
      label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
    };
  }

  function formatCoordinates(lat, lon) {
    if (lat == null || lon == null) return null;
    return `Lat ${lat.toFixed(3)}, Lon ${lon.toFixed(3)}`;
  }

  function updateUI(info) {
    const { uvNow, uvMax, locationLabel, coords } = info;
    els.uvNow.textContent =
      uvNow != null ? clamp(uvNow, 0, 20).toFixed(1) : "—";
    els.uvMax.textContent =
      uvMax != null ? clamp(uvMax, 0, 20).toFixed(1) : "—";
    els.location.textContent = locationLabel || "—";
    const coordLabel = coords
      ? formatCoordinates(coords.lat, coords.lon)
      : null;
    if (coordLabel) {
      els.location.setAttribute("title", coordLabel);
      const ariaLabel =
        locationLabel && locationLabel !== coordLabel
          ? `${locationLabel} (${coordLabel})`
          : coordLabel;
      els.location.setAttribute("aria-label", ariaLabel);
    } else {
      els.location.removeAttribute("title");
      els.location.removeAttribute("aria-label");
    }

    const rec = uvRecommendation(uvNow);
    setState(rec.state);
    setHeadline(rec.title, rec.sub);
  }

  function showManual(reason) {
    els.retry.hidden = false;
    els.manual.style.display = "grid";
    setHeadline(
      "We need a dot on Earth",
      reason || "Location permission denied — type a city below",
    );
  }

  async function handleLocation(lat, lon, locationOverride) {
    try {
      setHeadline("checking uv", "chill lol");
      const [{ uvNow, uvMax }, locationInfo] = await Promise.all([
        fetchUV(lat, lon),
        locationOverride
          ? Promise.resolve(locationOverride)
          : reverseGeocode(lat, lon),
      ]);
      const locationDetails =
        typeof locationInfo === "string"
          ? { name: locationInfo, label: locationInfo }
          : locationInfo || {};
      const fallbackLabel = formatCoordinates(lat, lon);
      const locationLabel =
        locationDetails.label || locationDetails.name || fallbackLabel;
      updateUI({
        uvNow,
        uvMax,
        locationLabel,
        coords: { lat, lon },
      });
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
      await handleLocation(g.lat, g.lon, { name: g.name, label: g.label });
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
