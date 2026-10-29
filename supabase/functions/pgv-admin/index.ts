// PGV Admin — user management for the PGV apps (Cycle, GEM Planner) that
// share one Supabase project and one login.
//
// The page (index.html) calls this with the signed-in user's token. Every
// request is checked against public.is_admin() as that user; only then is the
// service-role client (which can change any account) used.
//
// Actions: list, invite, link, set_access, update
// Invite and reset links are returned to the admin to share (WhatsApp, email),
// so nothing depends on Supabase's built-in email sending.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const APPS = ['cycle', 'gem']
const SITE = 'https://lallix.github.io/pgv-admin/'   // where invite/reset links land
const BANNED = '876000h'                               // ~100 years

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class UserError extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    })
    const { data: { user: caller } } = await asCaller.auth.getUser()
    const { data: isAdmin } = await asCaller.rpc('is_admin')
    if (!caller || isAdmin !== true) return json({ error: 'Admins only' }, 403)

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const body = await req.json()

    switch (body.action) {
      case 'list':       return json(await list(admin))
      case 'invite':     return json(await invite(admin, caller.id, body))
      case 'link':       return json(await resetLink(admin, body.user_id))
      case 'set_access': return json(await setAccess(admin, caller.id, body))
      case 'update':     return json(await update(admin, caller.id, body))
      default:           throw new UserError('Unknown action')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    return json({ error: msg }, e instanceof UserError ? 400 : 500)
  }
})

async function list(admin) {
  const [{ data: authData, error: e1 }, { data: profiles, error: e2 }, { data: access, error: e3 }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('profiles').select('id, full_name, email, is_admin, is_disabled, created_at'),
    admin.from('app_access').select('user_id, app'),
  ])
  if (e1 || e2 || e3) throw e1 || e2 || e3
  const byId = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
  const users = authData.users.map(u => {
    const p = byId[u.id] ?? {}
    return {
      id: u.id,
      email: u.email,
      full_name: p.full_name ?? u.user_metadata?.full_name ?? '',
      is_admin: !!p.is_admin,
      is_disabled: !!p.is_disabled,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      apps: (access ?? []).filter(a => a.user_id === u.id).map(a => a.app),
    }
  }).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  return { users, apps: APPS }
}

async function invite(admin, callerId, { email, full_name, apps = [] }) {
  email = String(email ?? '').trim().toLowerCase()
  full_name = String(full_name ?? '').trim()
  if (!email || !full_name) throw new UserError('Name and email are required')
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite', email, options: { data: { full_name }, redirectTo: SITE },
  })
  if (error) throw new UserError(/registered|exists/i.test(error.message) ? 'An account with this email already exists' : error.message)
  const id = data.user.id
  // handle_new_user normally makes the profile; make sure it exists with the name
  await admin.from('profiles').upsert({ id, email, full_name }, { onConflict: 'id' })
  const rows = apps.filter(a => APPS.includes(a)).map(app => ({ user_id: id, app, granted_by: callerId }))
  if (rows.length) {
    const { error: ae } = await admin.from('app_access').upsert(rows, { onConflict: 'user_id,app' })
    if (ae) throw ae
  }
  return { link: data.properties.action_link, user_id: id }
}

async function resetLink(admin, userId) {
  const { data: { user }, error } = await admin.auth.admin.getUserById(userId)
  if (error || !user) throw new UserError('User not found')
  const { data, error: le } = await admin.auth.admin.generateLink({
    type: 'recovery', email: user.email, options: { redirectTo: SITE },
  })
  if (le) throw le
  return { link: data.properties.action_link }
}

async function setAccess(admin, callerId, { user_id, app, on }) {
  if (!APPS.includes(app)) throw new UserError('Unknown app')
  const q = on
    ? admin.from('app_access').upsert({ user_id, app, granted_by: callerId }, { onConflict: 'user_id,app' })
    : admin.from('app_access').delete().eq('user_id', user_id).eq('app', app)
  const { error } = await q
  if (error) throw error
  return { ok: true }
}

async function update(admin, callerId, { user_id, full_name, email, is_admin, is_disabled }) {
  if (user_id === callerId && (is_admin === false || is_disabled === true)) {
    throw new UserError("You can't remove your own admin rights or disable yourself")
  }
  const profile: Record<string, unknown> = {}
  const authChanges: Record<string, unknown> = {}

  if (typeof full_name === 'string') {
    if (!full_name.trim()) throw new UserError('Name is required')
    profile.full_name = full_name.trim()
    authChanges.user_metadata = { full_name: full_name.trim() }
  }
  if (typeof email === 'string') {
    const e = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new UserError('That email address is not valid')
    profile.email = e
    authChanges.email = e
    authChanges.email_confirm = true
  }
  if (typeof is_admin === 'boolean') {
    profile.is_admin = is_admin
    authChanges.app_metadata = { is_admin }   // GEM's admin page reads it from here
  }
  if (typeof is_disabled === 'boolean') {
    profile.is_disabled = is_disabled
    authChanges.ban_duration = is_disabled ? BANNED : 'none'
  }

  if (Object.keys(authChanges).length) {
    const { error } = await admin.auth.admin.updateUserById(user_id, authChanges)
    if (error) throw new UserError(/already/i.test(error.message) ? 'Another account already uses that email' : error.message)
  }
  if (Object.keys(profile).length) {
    const { error } = await admin.from('profiles').update(profile).eq('id', user_id)
    if (error) throw error
  }
  return { ok: true }
}
