# PGV Admin

User management for the PGV apps (Cycle, GEM Planner), which share one Supabase
project and one login.

- `index.html` — the page (GitHub Pages). Admins see every account, switch app
  access, get invite and password-reset links to share, edit names and emails,
  make admins and disable accounts. Invite and reset links land here so people
  can choose a password; anyone else who signs in sees links to their apps.
- `supabase/functions/pgv-admin` — the server function the page calls. It checks
  the caller is an admin (`public.is_admin()`) before using the service-role key.
- Access rules live in the database: `app_access` and `has_app()`, see
  `Cycle/supabase/cycle_v6_app_access.sql`.

No secrets are in this repo: the page holds only the public (anon) key.
