(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const state = {
    codes: [],
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
    activeUsers: byId('active-users'),
    appShell: byId('app-shell'),
    blockedUsers: byId('blocked-users'),
    cancelCodeDialog: byId('cancel-code-dialog'),
    closeCodeDialog: byId('close-code-dialog'),
    closeResultDialog: byId('close-result-dialog'),
    codeDialog: byId('code-dialog'),
    codeError: byId('code-error'),
    codeForm: byId('code-form'),
    codeResults: byId('code-results'),
    copyCodes: byId('copy-codes'),
    doneResults: byId('done-results'),
    emptyState: byId('empty-state'),
    generateCodes: byId('generate-codes'),
    loadMore: byId('load-more'),
    lockDashboard: byId('lock-dashboard'),
    loginError: byId('login-error'),
    loginForm: byId('login-form'),
    loginShell: byId('login-shell'),
    openCodeButton: byId('open-code-button'),
    openCodeNav: byId('open-code-nav'),
    rangeLabel: byId('range-label'),
    resultDialog: byId('result-dialog'),
    resultSummary: byId('result-summary'),
    statusFilter: byId('status-filter'),
    toast: byId('toast'),
    totalUsers: byId('total-users'),
    userCountLabel: byId('user-count-label'),
    userSearch: byId('user-search'),
    usersBody: byId('users-body'),
  };

  let searchTimer = null;
  let toastTimer = null;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) lock();
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
    state.codes = [];
    elements.resultDialog.close();
  }

  function renderCodes(items) {
    state.codes = items;
    elements.resultSummary.textContent = `${items.length} code${items.length === 1 ? '' : 's'} created. This is the only time the plaintext values will be shown.`;
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
    } catch (error) {
      elements.codeError.textContent = error.message;
    } finally {
      elements.generateCodes.disabled = false;
      elements.generateCodes.textContent = 'Generate codes';
    }
  }

  async function copyCodes() {
    const value = state.codes.map((item) => item.code).join('\n');
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

  function lock() {
    state.token = '';
    state.users = [];
    elements.appShell.hidden = true;
    elements.loginShell.hidden = false;
    elements.loginForm.reset();
    elements.loginForm.elements.token.focus();
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

  elements.loginForm.addEventListener('submit', login);
  elements.lockDashboard.addEventListener('click', lock);
  elements.loadMore.addEventListener('click', () => loadUsers({ append: true }));
  elements.openCodeButton.addEventListener('click', openCodeDialog);
  elements.openCodeNav.addEventListener('click', openCodeDialog);
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
  elements.userSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = elements.userSearch.value.trim();
      loadUsers().catch((error) => showToast(error.message));
    }, 260);
  });
})();
