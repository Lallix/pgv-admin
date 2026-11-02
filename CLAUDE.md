# PGV Admin

User account manager for the personal PGV apps (Cycle and GEM Planner), which share one Supabase project and login.

- **Work / personal:** Personal
- **Port:** 5204
- **Start:** `python -m http.server 5204 --bind 127.0.0.1` (or the `pgv-admin` entry in `.claude\launch.json`), then open http://127.0.0.1:5204/
- **GitHub:** https://github.com/Lallix/pgv-admin (public — hosted on GitHub Pages; never commit secrets)
- **Stack:** Static HTML / JavaScript PWA (no build step), Supabase edge function `pgv-admin` (Deno / TypeScript)
- **Non-code files:** `_files\` (create `docs\`, `data\`, `design\`, `archive\` as needed). Synced by OneDrive, gitignored.

## Rules
- Only work inside this folder. Never start another app's server.
- Use relative paths only. This folder is opened on two PCs with different Windows usernames (`GideonV` and `lalli`).
- The service-role key lives only in Supabase secrets, never in this repo.
