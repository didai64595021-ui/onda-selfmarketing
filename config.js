// Supabase Config
const SUPABASE_URL = 'https://byaipfmwicukyzruqtsj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5YWlwZm13aWN1a3l6cnVxdHNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NTc3MjgsImV4cCI6MjA4NjUzMzcyOH0.GGm46X0W0joFXdYtdg-N9n8UQYiVHpbtZVZ__jfbY40';

async function sbQuery(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return res.json();
}

async function sbRpc(fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  return res.json();
}

async function sbInsert(table, data) {
  return sbQuery(table, { method: 'POST', body: data });
}

async function sbUpdate(table, match, data) {
  const params = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join('&');
  return sbQuery(`${table}?${params}`, { method: 'PATCH', body: data });
}
