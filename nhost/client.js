import { createNhostClient } from 'https://esm.sh/@nhost/nhost-js@3';

const GRAPHQL_URL = 'https://xqjnbwhipztjcbcnmzam.graphql.ap-southeast-1.nhost.run/v1';
const AUTH_HEALTH_URL = 'https://xqjnbwhipztjcbcnmzam.auth.ap-southeast-1.nhost.run/v1/healthz';
const nhost = createNhostClient({
  subdomain: 'xqjnbwhipztjcbcnmzam',
  region: 'ap-southeast-1'
});
let nhostInitialization;

fetch(AUTH_HEALTH_URL, { mode: 'no-cors', cache: 'no-store' })
  .catch(error => console.warn('Nhost auth warm-up failed:', error));

export async function waitForNhost() {
  if (!nhostInitialization) nhostInitialization = initializeNhost();
  try {
    await nhostInitialization;
  } catch (error) {
    nhostInitialization = undefined;
    throw error;
  }
  return nhost;
}

async function initializeNhost() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const authError = params.get('error');
  const authErrorDescription = params.get('error_description');
  if (code || authError) {
    params.delete('code');
    params.delete('error');
    params.delete('error_description');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );

    if (authError) throw new Error(authErrorDescription || `Login Discord gagal (${authError}).`);
    const codeVerifier = localStorage.getItem('nhost_pkce_verifier');
    localStorage.removeItem('nhost_pkce_verifier');
    if (!codeVerifier) throw new Error('Verifikasi login Discord gagal. Silakan coba masuk kembali.');
    await nhost.auth.tokenExchange({ code, codeVerifier });
  }
  await nhost.auth.waitUntilReady();
}

export async function signInAttendanceAdmin(email, password) {
  await waitForNhost();
  const result = await nhost.auth.signIn({ email, password });
  if (result.error) throw new Error(result.error.message || 'Email atau password tidak sesuai.');
  if (!result.session) throw new Error('Login belum menghasilkan sesi. Periksa akun Nhost Anda.');
  await activateAttendanceAdminRole();
  return result.session;
}

export async function signInAttendanceAdminWithDiscord() {
  await waitForNhost();
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = toBase64Url(verifierBytes);
  const challengeBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  const challenge = toBase64Url(new Uint8Array(challengeBytes));
  localStorage.setItem('nhost_pkce_verifier', verifier);
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const providerUrl = nhost.auth.signInProviderURL('discord', {
    redirectTo,
    codeChallenge: challenge
  });
  window.location.assign(providerUrl);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function activateAttendanceAdminRole() {
  const claims = nhost.auth.getHasuraClaims();
  const allowedRoles = claims?.['x-hasura-allowed-roles'] || [];
  if (!allowedRoles.includes('attendance_admin')) {
    await nhost.auth.signOut({ all: false });
    throw new Error('Akun ini belum diberi role attendance_admin.');
  }
  nhost.setRole('attendance_admin');
}

export async function restoreAttendanceAdmin() {
  await waitForNhost();
  if (!nhost.auth.getAccessToken()) return false;
  const allowedRoles = nhost.auth.getHasuraClaims()?.['x-hasura-allowed-roles'] || [];
  if (!allowedRoles.includes('attendance_admin')) return false;
  nhost.setRole('attendance_admin');
  return true;
}

export async function getAttendanceSession() {
  await waitForNhost();
  return nhost.auth.getSession();
}

export async function ensureAttendanceAdmin() {
  if (await restoreAttendanceAdmin()) {
    document.documentElement.classList.add('admin-authenticated');
    return true;
  }

  const page = window.location.pathname.split('/').pop();
  const dashboardUrl = new URL('index.html', window.location.href);
  if (['absensi-history.html', 'logduty.html', 'logduty-history.html', 'keuangan.html', 'pembagian-gaji.html', 'staff.html', 'kerjasama.html'].includes(page)) {
    dashboardUrl.searchParams.set('next', page);
  }
  window.location.replace(dashboardUrl.href);
  return false;
}

export async function signOutAttendanceAdmin() {
  await waitForNhost();
  await nhost.auth.signOut({ all: false });
  nhost.unsetRole();
}

export async function requestAttendanceGraphql(query, variables = {}, role = 'public') {
  await waitForNhost();
  if (role === 'attendance_admin') {
    const result = await nhost.graphql.request(query, variables, {
      headers: { 'x-hasura-role': role }
    });
    if (result.error) throw new Error(result.error.message || 'Permintaan admin ke Nhost gagal.');
    return result.data;
  }

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-role': 'public'
    },
    body: JSON.stringify({ query, variables })
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map(error => error.message).join('\n') || `Permintaan Nhost gagal (${response.status}).`);
  }
  return result.data;
}