import { createNhostClient } from 'https://esm.sh/@nhost/nhost-js@3';

const GRAPHQL_URL = 'https://xqjnbwhipztjcbcnmzam.graphql.ap-southeast-1.nhost.run/v1';
const nhost = createNhostClient({
  subdomain: 'xqjnbwhipztjcbcnmzam',
  region: 'ap-southeast-1'
});

export async function waitForNhost() {
  await nhost.auth.waitUntilReady();
  return nhost;
}

export async function signInAttendanceAdmin(email, password) {
  await waitForNhost();
  const result = await nhost.auth.signIn({ email, password });
  if (result.error) throw new Error(result.error.message || 'Email atau password tidak sesuai.');
  if (!result.session) throw new Error('Login belum menghasilkan sesi. Periksa akun Nhost Anda.');
  const claims = nhost.auth.getHasuraClaims();
  const allowedRoles = claims?.['x-hasura-allowed-roles'] || [];
  if (!allowedRoles.includes('attendance_admin')) {
    await nhost.auth.signOut({ all: false });
    throw new Error('Akun ini belum diberi role attendance_admin.');
  }
  nhost.setRole('attendance_admin');
  return result.session;
}

export async function restoreAttendanceAdmin() {
  await waitForNhost();
  if (!nhost.auth.getAccessToken()) return false;
  const allowedRoles = nhost.auth.getHasuraClaims()?.['x-hasura-allowed-roles'] || [];
  if (!allowedRoles.includes('attendance_admin')) return false;
  nhost.setRole('attendance_admin');
  try {
    await requestAttendanceGraphql('query RestoreAttendanceAdmin { attendance_weekly_recaps(limit: 1) { week_start } }', {}, 'attendance_admin');
    return true;
  } catch (error) {
    nhost.unsetRole();
    return false;
  }
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
  if (['absensi-history.html', 'keuangan.html', 'pembagian-gaji.html', 'staff.html', 'kerjasama.html'].includes(page)) {
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