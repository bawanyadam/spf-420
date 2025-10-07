# shouldiwearspf

Tiny client‑only web app that grabs your location (with permission), fetches your local UV index from Open‑Meteo, and shouts a maximalist YES/NO whether you should wear SPF right now.

Built by Adam Goehrig‑Bawany.

## Run

- Serve the project through PHP (e.g. `php -S localhost:8000`) and visit `index.php` in a modern browser.
- If prompted, allow location access. If you prefer not to, enter a city name and press "Check UV".

## How it works

- Geolocation via the browser API (or manual city name).
- UV data from Open‑Meteo (`hourly=uv_index`, `daily=uv_index_max`, `timezone=auto`). No API key.
- Recommendation: UV ≥ 3 → YES. 1–2.9 → MAYBE. < 1 → PROBABLY NOT.

## Tech

- Static HTML/CSS/JS with a tiny PHP shim for cache-busting.
- Bold color blocks with dynamic state‑based gradients.

## Notes

- If Open‑Meteo is temporarily unavailable, use the city lookup as a fallback.
- Data sources and thresholds can be tweaked in `script.js`.
