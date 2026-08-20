(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const state = {
    accessCodes: [],
    accessCodesLoaded: false,
    codeLoading: false,
    codeSearch: '',
    codeStatus: '',
    codeSummary: {
      availableCodes: 0,
      fullCodes: 0,
      retrievableCodes: 0,
      totalCodes: 0,
      totalRedemptions: 0,
    },
    codeTotal: 0,
    currentPage: 'users',
    generatedCodes: [],
    loading: false,
    offset: 0,
    search: '',
    status: '',
    summary: { activeUsers: 0, blockedUsers: 0, totalUsers: 0 },
    token: '',
    total: 0,
    users: [],
  };

  const byId = (id) => document.getElementById(id);
  const elements = {
    accessCodesNav: byId('access-codes-nav'),
    accessCodesPage: byId('access-codes-page'),
    activeUsers: byId('active-users'),
    appShell: byId('app-shell'),
    availableCodes: byId('available-codes'),
    blockedUsers: byId('blocked-users'),
    cancelCodeDialog: byId('cancel-code-dialog'),
    closeCodeDialog: byId('close-code-dialog'),
    closeResultDialog: byId('close-result-dialog'),
    codeDialog: byId('code-dialog'),
    codeError: byId('code-error'),
    codeForm: byId('code-form'),
    codeCountLabel: byId('code-count-label'),
    codeRangeLabel: byId('code-range-label'),
    codeResults: byId('code-results'),
    codeSearch: byId('code-search'),
    codesBody: byId('codes-body'),
    codesEmptyState: byId('codes-empty-state'),
    codesLoadMore: byId('codes-load-more'),
    codeStatusFilter: byId('code-status-filter'),
    copyCodes: byId('copy-codes'),
    doneResults: byId('done-results'),
    emptyState: byId('empty-state'),
    fullCodes: byId('full-codes'),
    generateCodes: byId('generate-codes'),
    loadMore: byId('load-more'),
    lockDashboard: byId('lock-dashboard'),
    loginError: byId('login-error'),
    loginForm: byId('login-form'),
    loginShell: byId('login-shell'),
    openCodeButton: byId('open-code-button'),
    openCodeButtonCodes: byId('open-code-button-codes'),
    rangeLabel: byId('range-label'),
    resultDialog: byId('result-dialog'),
    resultSummary: byId('result-summary'),
    retrievableCodes: byId('retrievable-codes'),
    statusFilter: byId('status-filter'),
    toast: byId('toast'),
    totalCodes: byId('total-codes'),
    totalUsers: byId('total-users'),
    userCountLabel: byId('user-count-label'),
    userSearch: byId('user-search'),
    usersBody: byId('users-body'),
    usersNav: byId('users-nav'),
    usersPage: byId('users-page'),
  };

  let codeSearchTimer = null;
  let searchTimer = null;
  let toastTimer = null;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(state.token
          ? { Authorization: `Bearer ${state.token}` }
          : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) showLogin();
      throw new Error(body?.error || 'The admin request could not be completed.');
    }
    return body;
  }

  function initials(name, email) {
    const source = name.trim() || email.split('@')[0];
    return source
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  }

  function dateLabel(value) {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : 'numeric',
    }).format(new Date(value));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function userRow(user) {
    const row = document.createElement('tr');
    const identityCell = document.createElement('td');
    const identity = element('div', 'user-cell');
    identity.append(element('span', 'avatar', initials(user.name, user.email)));
    const identityText = document.createElement('span');
    identityText.append(
      element('span', 'user-name', user.name || 'Unnamed user'),
      element('span', 'user-email', user.email),
    );
    identity.append(identityText);
    identityCell.append(identity);

    const planCell = document.createElement('td');
    planCell.append(
      element('span', `plan-badge plan-badge--${user.plan}`, user.plan),
    );
    const codeCell = element('td', '', user.codeLabel || '—');
    const lastSeenCell = element('td', '', dateLabel(user.lastSeenAt));
    const statusCell = document.createElement('td');
    statusCell.append(
      element(
        'span',
        `status-badge status-badge--${user.status}`,
        user.status,
      ),
    );
    const actionCell = document.createElement('td');
    const isBlocked = user.status === 'blocked';
    const action = element(
      'button',
      `row-action${isBlocked ? '' : ' row-action--block'}`,
      isBlocked ? 'Unblock' : 'Block',
    );
    action.type = 'button';
    action.addEventListener('click', () => changeAccess(user, action));
    actionCell.append(action);
    row.append(
      identityCell,
      planCell,
      codeCell,
      lastSeenCell,
      statusCell,
      actionCell,
    );
    return row;
  }

  function accessCodeRow(item) {
    const row = document.createElement('tr');
    const codeCell = document.createElement('td');
    if (item.retrievable && item.code) {
      const codeWrap = element('div', 'access-code-cell');
      codeWrap.append(element('code', '', item.code));
      const copy = element('button', 'row-action', 'Copy');
      copy.type = 'button';
      copy.setAttribute('aria-label', `Copy access code ${item.label || ''}`.trim());
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.code);
          showToast('Access code copied to the clipboard.');
        } catch {
          showToast('Clipboard access was denied. Select and copy the code manually.');
        }
      });
      codeWrap.append(copy);
      codeCell.append(codeWrap);
    } else {
      const unavailable = element(
        'span',
        'code-unavailable',
        'Unavailable (legacy)',
      );
      unavailable.title = 'This code was stored as a one-way digest before encrypted retrieval was enabled.';
      codeCell.append(unavailable);
    }
    const labelCell = element('td', '', item.label || '—');
    const planCell = document.createElement('td');
    planCell.append(
      element('span', `plan-badge plan-badge--${item.plan}`, item.plan),
    );
    const usageCell = element(
      'td',
      'usage-cell',
      `${item.redeemedUsers.toLocaleString()} / ${item.maxUsers.toLocaleString()}`,
    );
    const createdCell = element('td', '', dateLabel(item.createdAt));
    const statusCell = document.createElement('td');
    statusCell.append(
      element(
        'span',
        `status-badge status-badge--${item.status}`,
        item.status,
      ),
    );
    row.append(codeCell, labelCell, planCell, usageCell, createdCell, statusCell);
    return row;
  }

  function render() {
    elements.totalUsers.textContent = String(state.summary.totalUsers);
    elements.activeUsers.textContent = String(state.summary.activeUsers);
    elements.blockedUsers.textContent = String(state.summary.blockedUsers);
    elements.userCountLabel.textContent = `${state.total.toLocaleString()} matching account${state.total === 1 ? '' : 's'}`;
    elements.usersBody.replaceChildren(...state.users.map(userRow));
    elements.emptyState.hidden = state.users.length > 0 || state.loading;
    elements.loadMore.hidden = state.users.length >= state.total;
    elements.loadMore.disabled = state.loading;
    const start = state.users.length ? 1 : 0;
    elements.rangeLabel.textContent = state.users.length
      ? `Showing ${start}–${state.users.length} of ${state.total}`
      : 'No accounts to show';
  }

  function renderAccessCodes() {
    elements.totalCodes.textContent = String(state.codeSummary.totalCodes);
    elements.availableCodes.textContent = String(state.codeSummary.availableCodes);
    elements.fullCodes.textContent = String(state.codeSummary.fullCodes);
    elements.retrievableCodes.textContent = String(
      state.codeSummary.retrievableCodes,
    );
    elements.codeCountLabel.textContent = `${state.codeTotal.toLocaleString()} matching code${state.codeTotal === 1 ? '' : 's'} · ${state.codeSummary.totalRedemptions.toLocaleString()} redemption${state.codeSummary.totalRedemptions === 1 ? '' : 's'}`;
    elements.codesBody.replaceChildren(
      ...state.accessCodes.map(accessCodeRow),
    );
    elements.codesEmptyState.hidden =
      state.accessCodes.length > 0 || state.codeLoading;
    elements.codesLoadMore.hidden =
      state.accessCodes.length >= state.codeTotal;
    elements.codesLoadMore.disabled = state.codeLoading;
    elements.codeRangeLabel.textContent = state.accessCodes.length
      ? `Showing 1–${state.accessCodes.length} of ${state.codeTotal}`
      : 'No access codes to show';
  }

  async function loadUsers({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    elements.userCountLabel.textContent = 'Loading accounts…';
    elements.loadMore.disabled = true;
    const offset = append ? state.users.length : 0;
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (state.search) parameters.set('search', state.search);
    if (state.status) parameters.set('status', state.status);
    try {
      const result = await request(`/v1/admin/users?${parameters}`);
      state.users = append ? [...state.users, ...result.items] : result.items;
      state.offset = state.users.length;
      state.total = result.page.total;
      state.summary = result.summary;
      render();
    } finally {
      state.loading = false;
      elements.loadMore.disabled = false;
    }
  }

  async function loadAccessCodes({ append = false } = {}) {
    if (state.codeLoading) return;
    state.codeLoading = true;
    elements.codeCountLabel.textContent = 'Loading codes…';
    elements.codesLoadMore.disabled = true;
    const offset = append ? state.accessCodes.length : 0;
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (state.codeSearch) parameters.set('search', state.codeSearch);
    if (state.codeStatus) parameters.set('status', state.codeStatus);
    try {
      const result = await request(`/v1/admin/access-codes?${parameters}`);
      state.accessCodes = append
        ? [...state.accessCodes, ...result.items]
        : result.items;
      state.accessCodesLoaded = true;
      state.codeTotal = result.page.total;
      state.codeSummary = result.summary;
      renderAccessCodes();
    } finally {
      state.codeLoading = false;
      elements.codesLoadMore.disabled = false;
    }
  }

  function showPage(page) {
    state.currentPage = page;
    const showingUsers = page === 'users';
    elements.usersPage.hidden = !showingUsers;
    elements.accessCodesPage.hidden = showingUsers;
    elements.usersNav.classList.toggle('nav-item--active', showingUsers);
    elements.accessCodesNav.classList.toggle(
      'nav-item--active',
      !showingUsers,
    );
    if (!showingUsers && !state.accessCodesLoaded) {
      loadAccessCodes().catch((error) => showToast(error.message));
    }
  }

  async function changeAccess(user, button) {
    const blocked = user.status !== 'blocked';
    if (
      blocked &&
      !window.confirm(
        `Block ${user.email}? Their active sessions will be revoked immediately.`,
      )
    ) {
      return;
    }
    button.disabled = true;
    button.textContent = blocked ? 'Blocking…' : 'Unblocking…';
    try {
      await request(
        `/v1/admin/users/${encodeURIComponent(user.id)}/access`,
        { body: JSON.stringify({ blocked }), method: 'PATCH' },
      );
      await loadUsers();
      showToast(`${user.email} is now ${blocked ? 'blocked' : 'active'}.`);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = blocked ? 'Block' : 'Unblock';
    }
  }

  function openCodeDialog() {
    elements.codeError.textContent = '';
    elements.codeDialog.showModal();
    elements.codeForm.elements.count.focus();
  }

  function closeCodeDialog() {
    elements.codeDialog.close();
  }

  function closeResultDialog() {
    state.generatedCodes = [];
    elements.resultDialog.close();
  }

  function renderCodes(items) {
    state.generatedCodes = items;
    elements.resultSummary.textContent = `${items.length} code${items.length === 1 ? '' : 's'} created and encrypted at rest. You can view them again from Access codes.`;
    elements.codeResults.replaceChildren(
      ...items.map((item) => {
        const row = element('div', 'code-result');
        row.append(
          element('code', '', item.code),
          element('span', '', `${item.plan} · ${item.maxUsers} user${item.maxUsers === 1 ? '' : 's'}`),
        );
        return row;
      }),
    );
  }

  async function submitCodes(event) {
    event.preventDefault();
    elements.codeError.textContent = '';
    elements.generateCodes.disabled = true;
    elements.generateCodes.textContent = 'Generating…';
    const formData = new FormData(elements.codeForm);
    const input = {
      count: Number(formData.get('count')),
      label: String(formData.get('label') || '').trim() || null,
      maxUsers: Number(formData.get('maxUsers')),
      plan: String(formData.get('plan')),
    };
    try {
      const result = await request('/v1/admin/access-codes/bulk', {
        body: JSON.stringify(input),
        method: 'POST',
      });
      closeCodeDialog();
      renderCodes(result.items);
      elements.resultDialog.showModal();
      state.accessCodesLoaded = false;
      if (state.currentPage === 'codes') {
        loadAccessCodes().catch((error) => showToast(error.message));
      }
    } catch (error) {
      elements.codeError.textContent = error.message;
    } finally {
      elements.generateCodes.disabled = false;
      elements.generateCodes.textContent = 'Generate codes';
    }
  }

  async function copyCodes() {
    const value = state.generatedCodes.map((item) => item.code).join('\n');
    try {
      await navigator.clipboard.writeText(value);
      elements.copyCodes.textContent = 'Copied';
      showToast('Codes copied to the clipboard.');
      window.setTimeout(() => {
        elements.copyCodes.textContent = 'Copy all';
      }, 1600);
    } catch {
      showToast('Clipboard access was denied. Select and copy each code manually.');
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3600);
  }

  function showLogin() {
    state.token = '';
    state.users = [];
    state.accessCodes = [];
    state.accessCodesLoaded = false;
    state.currentPage = 'users';
    showPage('users');
    elements.appShell.hidden = true;
    elements.loginShell.hidden = false;
    elements.loginForm.reset();
    elements.loginForm.elements.token.focus();
  }

  async function signOut() {
    try {
      await request('/v1/admin/session', { method: 'DELETE' });
    } catch {
      // The local lock state still wins if the session already expired.
    } finally {
      showLogin();
    }
  }

  async function login(event) {
    event.preventDefault();
    const token = String(new FormData(elements.loginForm).get('token') || '');
    state.token = token;
    elements.loginError.textContent = '';
    const submit = elements.loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Opening…';
    try {
      await request('/v1/admin/session', { method: 'POST' });
      state.token = '';
      await loadUsers();
      elements.loginShell.hidden = true;
      elements.appShell.hidden = false;
    } catch (error) {
      state.token = '';
      elements.loginError.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Continue';
    }
  }

  async function restoreSession() {
    try {
      await loadUsers();
      elements.loginShell.hidden = true;
      elements.appShell.hidden = false;
    } catch {
      showLogin();
    }
  }

  elements.loginForm.addEventListener('submit', login);
  elements.lockDashboard.addEventListener('click', () => void signOut());
  elements.loadMore.addEventListener('click', () => loadUsers({ append: true }));
  elements.codesLoadMore.addEventListener('click', () =>
    loadAccessCodes({ append: true }),
  );
  elements.openCodeButton.addEventListener('click', openCodeDialog);
  elements.openCodeButtonCodes.addEventListener('click', openCodeDialog);
  elements.usersNav.addEventListener('click', () => showPage('users'));
  elements.accessCodesNav.addEventListener('click', () => showPage('codes'));
  elements.closeCodeDialog.addEventListener('click', closeCodeDialog);
  elements.cancelCodeDialog.addEventListener('click', closeCodeDialog);
  elements.codeForm.addEventListener('submit', submitCodes);
  elements.copyCodes.addEventListener('click', copyCodes);
  elements.closeResultDialog.addEventListener('click', closeResultDialog);
  elements.doneResults.addEventListener('click', closeResultDialog);
  elements.statusFilter.addEventListener('change', () => {
    state.status = elements.statusFilter.value;
    loadUsers().catch((error) => showToast(error.message));
  });
  elements.codeStatusFilter.addEventListener('change', () => {
    state.codeStatus = elements.codeStatusFilter.value;
    loadAccessCodes().catch((error) => showToast(error.message));
  });
  elements.userSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = elements.userSearch.value.trim();
      loadUsers().catch((error) => showToast(error.message));
    }, 260);
  });
  elements.codeSearch.addEventListener('input', () => {
    window.clearTimeout(codeSearchTimer);
    codeSearchTimer = window.setTimeout(() => {
      state.codeSearch = elements.codeSearch.value.trim();
      loadAccessCodes().catch((error) => showToast(error.message));
    }, 260);
  });
  void restoreSession();
})();
