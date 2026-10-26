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
  await nhost.auth.waitUntilReady();
}

export async function signInAttendanceAdminWithDiscord() {
  await waitForNhost();
  const redirectTo = `${window.location.origin}/admin/`;
  const result = await nhost.auth.signIn({
    provider: 'discord',
    options: { redirectTo }
  });
  if (result.error) throw new Error(result.error.message || 'Login Discord gagal.');
  if (!result.providerUrl) throw new Error('Nhost tidak mengembalikan URL login Discord.');
  const currentPage = window.location.pathname.split('/').pop();
  if (currentPage && currentPage !== 'index.html') {
    sessionStorage.setItem('nhostAdminReturnPage', currentPage);
  }
  window.location.assign(result.providerUrl);
}

export async function restoreAttendanceAdmin() {
  await waitForNhost();
  const session = nhost.auth.getSession();
  const accessToken = nhost.auth.getAccessToken();
  const allowedRoles = accessToken
    ? nhost.auth.getHasuraClaims()?.['x-hasura-allowed-roles'] || []
    : [];
  const isAdmin = Boolean(accessToken && allowedRoles.includes('attendance_admin'));
  renderAttendanceAdminGreeting(session, isAdmin);
  if (!isAdmin) return false;
  nhost.setRole('attendance_admin');
  return true;
}

function renderAttendanceAdminGreeting(session, isAdmin) {
  const header = document.querySelector('header');
  const actions = header?.querySelector('nav') || header?.lastElementChild;
  let greeting = header?.querySelector('[data-attendance-admin-greeting]');

  if (!greeting && actions) {
    greeting = document.createElement('span');
    greeting.dataset.attendanceAdminGreeting = '';
    greeting.className = 'inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-200';
    greeting.setAttribute('aria-live', 'polite');
    actions.prepend(greeting);
  }

  const user = session?.user;
  const username = isAdmin
    ? [
        user?.displayName,
        user?.metadata?.preferred_username,
        user?.metadata?.username,
        user?.metadata?.global_name
      ].find(value => typeof value === 'string' && value.trim())?.trim() || 'Admin'
    : 'Anonim';

  const greetingText = isAdmin ? `Halo Admin: ${username}` : 'Halo : Anonim';
  document.querySelectorAll('[data-attendance-admin-greeting]').forEach(element => {
    element.textContent = greetingText;
    element.classList.remove('hidden');
  });
}

export function finishAttendanceAdminLoading() {
  document.documentElement.classList.remove('auth-checking');
  document.documentElement.classList.remove('auth-required');
  document.getElementById('authLoadingOverlay')?.remove();
}

export async function getAttendanceSession() {
  await waitForNhost();
  return nhost.auth.getSession();
}

export async function ensureAttendanceAdmin() {
  try {
    if (await restoreAttendanceAdmin()) {
      document.documentElement.classList.add('admin-authenticated');
      finishAttendanceAdminLoading();
      return true;
    }
  } catch (error) {
    const overlay = document.getElementById('authLoadingOverlay');
    const message = overlay?.querySelector('p');
    if (!overlay || !message) throw error;

    message.textContent = `Sesi admin tidak dapat diperiksa: ${error.message}`;
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'auth-loading-retry';
    retryButton.textContent = 'Coba lagi';
    retryButton.addEventListener('click', () => window.location.reload());
    overlay.querySelector('.auth-loading-card')?.append(retryButton);
    return false;
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