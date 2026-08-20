(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const state = {
    accessCodes: [],
    accessCodesLoaded: false,
    codeLoading: false,
    codeSearch: '',
    codeStatus: '',
    codeUsers: [],
    codeUsersLoading: false,
    codeUsersTotal: 0,
    codeSummary: {
      availableCodes: 0,
      fullCodes: 0,
      pausedCodes: 0,
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
    usage: [],
    usageLane: '',
    usageLoaded: false,
    usageLoading: false,
    usageRange: '7d',
    usageSearch: '',
    usageSeries: { granularity: 'day', items: [] },
    usageSummary: {
      activeUsers: 0,
      totalRequests: 0,
      totalSpendMicroUsd: 0,
      totalTokens: 0,
    },
    usageTotal: 0,
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
    closeCodeUsers: byId('close-code-users'),
    closeCodeUsersDialog: byId('close-code-users-dialog'),
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
    codeUsersDialog: byId('code-users-dialog'),
    codeUsersEmpty: byId('code-users-empty'),
    codeUsersList: byId('code-users-list'),
    codeUsersSummary: byId('code-users-summary'),
    copyCodes: byId('copy-codes'),
    doneResults: byId('done-results'),
    emptyState: byId('empty-state'),
    fullCodes: byId('full-codes'),
    generateCodes: byId('generate-codes'),
    loadMore: byId('load-more'),
    loadMoreCodeUsers: byId('load-more-code-users'),
    lockDashboard: byId('lock-dashboard'),
    loginError: byId('login-error'),
    loginForm: byId('login-form'),
    loginShell: byId('login-shell'),
    openCodeButton: byId('open-code-button'),
    openCodeButtonCodes: byId('open-code-button-codes'),
    pausedCodes: byId('paused-codes'),
    rangeLabel: byId('range-label'),
    refreshUsage: byId('refresh-usage'),
    resultDialog: byId('result-dialog'),
    resultSummary: byId('result-summary'),
    statusFilter: byId('status-filter'),
    toast: byId('toast'),
    totalCodes: byId('total-codes'),
    totalUsers: byId('total-users'),
    usageActiveUsers: byId('usage-active-users'),
    usageBody: byId('usage-body'),
    usageChart: byId('usage-chart'),
    usageChartSummary: byId('usage-chart-summary'),
    usageChartTotal: byId('usage-chart-total'),
    usageCountLabel: byId('usage-count-label'),
    usageEmptyState: byId('usage-empty-state'),
    usageLaneFilter: byId('usage-lane-filter'),
    usageLoadMore: byId('usage-load-more'),
    usageNav: byId('usage-nav'),
    usagePage: byId('usage-page'),
    usageRangeFilter: byId('usage-range-filter'),
    usageRangeLabel: byId('usage-range-label'),
    usageSearch: byId('usage-search'),
    usageTotalRequests: byId('usage-total-requests'),
    usageTotalSpend: byId('usage-total-spend'),
    usageTotalTokens: byId('usage-total-tokens'),
    userCountLabel: byId('user-count-label'),
    userSearch: byId('user-search'),
    usersBody: byId('users-body'),
    usersNav: byId('users-nav'),
    usersPage: byId('users-page'),
  };

  let codeSearchTimer = null;
  let searchTimer = null;
  let toastTimer = null;
  let usageReloadQueued = false;
  let usageSearchTimer = null;

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

  function dateTimeLabel(value) {
    if (!value) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      year: new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : 'numeric',
    }).format(new Date(value));
  }

  function moneyLabel(microUsd) {
    const amount = Number(microUsd || 0) / 1_000_000;
    if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
    return new Intl.NumberFormat(undefined, {
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: 'currency',
    }).format(amount);
  }

  function compactNumber(value) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: Number(value) >= 10_000 ? 'compact' : 'standard',
    }).format(Number(value || 0));
  }

  function chartMoneyLabel(microUsd) {
    const amount = Number(microUsd || 0) / 1_000_000;
    if (amount === 0) return '$0';
    if (amount < 0.01) return `$${amount.toFixed(4)}`;
    if (amount < 0.1) return `$${amount.toFixed(3)}`;
    if (amount < 1) return `$${amount.toFixed(2)}`;
    return `$${amount.toFixed(1)}`;
  }

  function chartDateLabel(value, granularity) {
    const options = granularity === 'hour'
      ? { day: 'numeric', hour: 'numeric', month: 'short' }
      : granularity === 'month'
        ? { month: 'short', year: '2-digit' }
        : { day: 'numeric', month: 'short' };
    return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
  }

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

  function svgElement(tag, attributes = {}, text) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, String(value));
    }
    if (text !== undefined) node.textContent = text;
    return node;
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

  const usageLaneLabels = {
    realtime_transcription: 'Live voice',
    responses: 'Agent task',
    speech: 'Spoken reply',
    transcription: 'Voice transcription',
  };

  function shortIdentifier(value) {
    return String(value || '').slice(0, 8);
  }

  function durationLabel(milliseconds) {
    const seconds = Number(milliseconds || 0) / 1_000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
  }

  function usageMetric(item) {
    if (item.lane === 'responses') {
      const cached = item.cachedInputTokens
        ? `${compactNumber(item.cachedInputTokens)} cached`
        : `${durationLabel(item.durationMs)} duration`;
      return {
        detail: cached,
        primary: `${compactNumber(item.inputTokens)} in · ${compactNumber(item.outputTokens)} out`,
      };
    }
    if (item.lane === 'speech') {
      return {
        detail: `${durationLabel(item.durationMs)} duration`,
        primary: `${compactNumber(item.characterCount)} characters`,
      };
    }
    return {
      detail: `${durationLabel(item.durationMs)} processing`,
      primary: `${durationLabel(item.audioDurationMs)} audio`,
    };
  }

  function usageRow(item) {
    const row = document.createElement('tr');
    const identityCell = document.createElement('td');
    const identity = element('div', 'user-cell');
    identity.append(
      element('span', 'avatar', initials(item.user.name || '', item.user.email)),
    );
    const identityText = document.createElement('span');
    identityText.append(
      element('span', 'user-name', item.user.name || 'Unnamed user'),
      element('span', 'user-email', item.user.email),
    );
    identity.append(identityText);
    identityCell.append(identity);

    const activityCell = document.createElement('td');
    const activity = element('div', 'activity-cell');
    activity.append(
      element(
        'span',
        `activity-icon activity-icon--${item.lane}`,
        item.lane === 'responses' ? '↗' : item.lane === 'speech' ? '◖' : '⌁',
      ),
    );
    const activityText = document.createElement('span');
    const laneLabel = usageLaneLabels[item.lane] || 'Model activity';
    activityText.append(
      element('span', 'activity-name', item.activityTitle || laneLabel),
      element(
        'span',
        'activity-meta',
        `${item.activityTitle ? `${laneLabel} · ` : ''}Task ${shortIdentifier(item.taskId)}`,
      ),
    );
    activity.append(activityText);
    activityCell.append(activity);

    const modelCell = document.createElement('td');
    modelCell.append(element('code', 'model-name', item.model));
    const metric = usageMetric(item);
    const metricCell = document.createElement('td');
    const metricWrap = element('span', 'usage-metric');
    metricWrap.append(
      element('span', 'usage-metric__primary', metric.primary),
      element('span', 'usage-metric__detail', metric.detail),
    );
    metricCell.append(metricWrap);
    const costCell = document.createElement('td');
    const cost = element('span', 'cost-value');
    cost.append(
      element('span', 'cost-value__amount', moneyLabel(item.amountMicroUsd)),
      element('span', 'cost-value__source', item.usageSource),
    );
    costCell.append(cost);
    const createdCell = element('td', 'usage-time', dateTimeLabel(item.createdAt));
    row.append(
      identityCell,
      activityCell,
      modelCell,
      metricCell,
      costCell,
      createdCell,
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
    const usersCell = document.createElement('td');
    if (item.redeemedUsers === 0) {
      usersCell.append(element('span', 'code-users-none', 'No users'));
    } else {
      const viewUsers = element(
        'button',
        'row-action row-action--users',
        `View ${item.redeemedUsers.toLocaleString()} user${item.redeemedUsers === 1 ? '' : 's'}`,
      );
      viewUsers.type = 'button';
      viewUsers.addEventListener('click', () => openCodeUsersDialog(item));
      usersCell.append(viewUsers);
    }
    const createdCell = element('td', '', dateLabel(item.createdAt));
    const statusCell = document.createElement('td');
    statusCell.append(
      element(
        'span',
        `status-badge status-badge--${item.status}`,
        item.status,
      ),
    );
    const actionsCell = document.createElement('td');
    const actions = element('div', 'code-actions');
    const isPaused = item.status === 'paused';
    const pause = element(
      'button',
      'row-action',
      isPaused ? 'Resume' : 'Pause',
    );
    pause.type = 'button';
    pause.addEventListener('click', () => pauseAccessCode(item, pause));
    const remove = element(
      'button',
      'row-action row-action--danger',
      'Delete',
    );
    remove.type = 'button';
    remove.disabled = item.redeemedUsers > 0;
    if (remove.disabled) {
      remove.title = 'Codes with redemptions cannot be deleted.';
    }
    remove.addEventListener('click', () => deleteAccessCode(item, remove));
    actions.append(pause, remove);
    actionsCell.append(actions);
    row.append(
      codeCell,
      labelCell,
      planCell,
      usageCell,
      usersCell,
      createdCell,
      statusCell,
      actionsCell,
    );
    return row;
  }

  async function pauseAccessCode(item, button) {
    const paused = item.status !== 'paused';
    button.disabled = true;
    button.textContent = paused ? 'Pausing…' : 'Resuming…';
    try {
      await request(`/v1/admin/access-codes/${encodeURIComponent(item.id)}`, {
        body: JSON.stringify({ paused }),
        method: 'PATCH',
      });
      await loadAccessCodes();
      showToast(
        `${item.label || 'Access code'} was ${paused ? 'paused' : 'resumed'}.`,
      );
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = paused ? 'Pause' : 'Resume';
    }
  }

  async function deleteAccessCode(item, button) {
    if (item.redeemedUsers > 0) {
      showToast('Codes with redemptions cannot be deleted. Pause this code instead.');
      return;
    }
    const label = item.label || 'this access code';
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await request(`/v1/admin/access-codes/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      await loadAccessCodes();
      showToast(`${label} was deleted.`);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = 'Delete';
    }
  }

  function codeUserRow(user) {
    const row = element('article', 'code-user-row');
    const identity = element('div', 'user-cell');
    identity.append(
      element('span', 'avatar', initials(user.name || '', user.email)),
    );
    const identityText = document.createElement('span');
    identityText.append(
      element('span', 'user-name', user.name || 'Unnamed user'),
      element('span', 'user-email', user.email),
    );
    identity.append(identityText);
    const details = element('div', 'code-user-details');
    details.append(
      element('span', 'code-user-redeemed', `Redeemed ${dateLabel(user.redeemedAt)}`),
      element(
        'span',
        `status-badge status-badge--${user.status}`,
        user.status,
      ),
    );
    row.append(identity, details);
    return row;
  }

  function renderCodeUsers(code) {
    elements.codeUsersSummary.textContent = `${code.label || 'Unlabelled code'} · ${code.plan} plan · ${state.codeUsersTotal.toLocaleString()} of ${code.maxUsers.toLocaleString()} seats used`;
    elements.codeUsersList.replaceChildren(...state.codeUsers.map(codeUserRow));
    elements.codeUsersEmpty.hidden =
      state.codeUsers.length > 0 || state.codeUsersLoading;
    elements.loadMoreCodeUsers.hidden =
      state.codeUsers.length >= state.codeUsersTotal;
    elements.loadMoreCodeUsers.disabled = state.codeUsersLoading;
  }

  async function loadCodeUsers(code, { append = false } = {}) {
    if (state.codeUsersLoading) return;
    state.codeUsersLoading = true;
    elements.loadMoreCodeUsers.disabled = true;
    const offset = append ? state.codeUsers.length : 0;
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    try {
      const result = await request(
        `/v1/admin/access-codes/${encodeURIComponent(code.id)}/users?${parameters}`,
      );
      state.codeUsers = append
        ? [...state.codeUsers, ...result.items]
        : result.items;
      state.codeUsersTotal = result.page.total;
      renderCodeUsers(result.code);
    } finally {
      state.codeUsersLoading = false;
      elements.loadMoreCodeUsers.disabled = false;
    }
  }

  function openCodeUsersDialog(code) {
    state.codeUsers = [];
    state.codeUsersTotal = code.redeemedUsers;
    elements.codeUsersList.replaceChildren();
    elements.codeUsersEmpty.hidden = true;
    elements.codeUsersSummary.textContent = 'Loading users…';
    elements.codeUsersDialog.dataset.codeId = code.id;
    elements.codeUsersDialog.showModal();
    loadCodeUsers(code).catch((error) => {
      elements.codeUsersSummary.textContent = error.message;
      elements.codeUsersEmpty.hidden = false;
    });
  }

  function closeCodeUsersDialog() {
    state.codeUsers = [];
    state.codeUsersTotal = 0;
    elements.codeUsersDialog.close();
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
    elements.pausedCodes.textContent = String(state.codeSummary.pausedCodes);
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

  function renderUsageChart() {
    const { granularity, items } = state.usageSeries;
    const totalRequests = state.usageSummary.totalRequests;
    const rangeLabel =
      elements.usageRangeFilter.selectedOptions[0]?.textContent || 'Selected period';
    const laneLabel =
      elements.usageLaneFilter.selectedOptions[0]?.textContent || 'All activity';
    elements.usageChartSummary.textContent = `${rangeLabel} · ${laneLabel} · ${compactNumber(totalRequests)} model call${totalRequests === 1 ? '' : 's'}`;
    elements.usageChartTotal.textContent = moneyLabel(
      state.usageSummary.totalSpendMicroUsd,
    );
    elements.usageChart.replaceChildren();
    elements.usageChart.setAttribute(
      'aria-label',
      `Usage graph for ${rangeLabel}. ${moneyLabel(state.usageSummary.totalSpendMicroUsd)} spent across ${totalRequests} model calls.`,
    );

    if (!items.length || totalRequests === 0) {
      elements.usageChart.append(
        element('div', 'usage-chart-empty', 'No usage to graph for these filters.'),
      );
      return;
    }

    const width = 960;
    const height = 260;
    const padding = { bottom: 36, left: 58, right: 18, top: 18 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const maxSpend = Math.max(...items.map((item) => item.spendMicroUsd), 1);
    const yMaximum = Math.ceil(maxSpend * 1.12);
    const points = items.map((item, index) => ({
      item,
      x: items.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (items.length - 1)) * plotWidth,
      y: bottom - (item.spendMicroUsd / yMaximum) * plotHeight,
    }));
    const svg = svgElement('svg', {
      'aria-label': `Spend over time, grouped by ${granularity}.`,
      role: 'img',
      viewBox: `0 0 ${width} ${height}`,
    });
    const definitions = svgElement('defs');
    const gradient = svgElement('linearGradient', {
      id: 'usage-chart-gradient',
      x1: '0',
      x2: '0',
      y1: '0',
      y2: '1',
    });
    gradient.append(
      svgElement('stop', { offset: '0%', 'stop-color': '#8fc58f', 'stop-opacity': '0.42' }),
      svgElement('stop', { offset: '100%', 'stop-color': '#8fc58f', 'stop-opacity': '0.04' }),
    );
    definitions.append(gradient);
    svg.append(definitions);

    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + (index / 4) * plotHeight;
      const value = yMaximum * (1 - index / 4);
      svg.append(
        svgElement('line', {
          class: 'chart-grid-line',
          x1: padding.left,
          x2: width - padding.right,
          y1: y,
          y2: y,
        }),
        svgElement(
          'text',
          {
            class: 'chart-axis-label',
            'text-anchor': 'end',
            x: padding.left - 10,
            y: y + 4,
          },
          chartMoneyLabel(value),
        ),
      );
    }

    if (points.length > 1) {
      const areaPath = [
        `M ${points[0].x} ${bottom}`,
        ...points.map((point) => `L ${point.x} ${point.y}`),
        `L ${points.at(-1).x} ${bottom}`,
        'Z',
      ].join(' ');
      svg.append(svgElement('path', { class: 'chart-area', d: areaPath }));
    }
    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
    svg.append(svgElement('path', { class: 'chart-line', d: linePath }));

    for (const point of points) {
      const circle = svgElement('circle', {
        class: 'chart-point',
        cx: point.x,
        cy: point.y,
        r: 5,
      });
      circle.append(
        svgElement(
          'title',
          {},
          `${chartDateLabel(point.item.startedAt, granularity)}: ${moneyLabel(point.item.spendMicroUsd)}, ${point.item.requests} call${point.item.requests === 1 ? '' : 's'}, ${compactNumber(point.item.tokens)} tokens`,
        ),
      );
      svg.append(circle);
    }

    const labelCount = Math.min(6, items.length);
    const labelIndexes = new Set(
      Array.from({ length: labelCount }, (_, index) =>
        Math.round((index / Math.max(1, labelCount - 1)) * (items.length - 1))),
    );
    for (const index of labelIndexes) {
      const point = points[index];
      svg.append(
        svgElement(
          'text',
          {
            class: 'chart-axis-label',
            'text-anchor': index === 0
              ? 'start'
              : index === items.length - 1
                ? 'end'
                : 'middle',
            x: point.x,
            y: height - 10,
          },
          chartDateLabel(point.item.startedAt, granularity),
        ),
      );
    }
    const accessibleSummary = element('div', 'sr-only');
    accessibleSummary.textContent = items
      .map((item) =>
        `${chartDateLabel(item.startedAt, granularity)}: ${moneyLabel(item.spendMicroUsd)}, ${item.requests} calls.`)
      .join(' ');
    elements.usageChart.append(svg, accessibleSummary);
  }

  function renderUsage() {
    elements.usageTotalSpend.textContent = moneyLabel(
      state.usageSummary.totalSpendMicroUsd,
    );
    elements.usageActiveUsers.textContent = compactNumber(
      state.usageSummary.activeUsers,
    );
    elements.usageTotalRequests.textContent = compactNumber(
      state.usageSummary.totalRequests,
    );
    elements.usageTotalTokens.textContent = compactNumber(
      state.usageSummary.totalTokens,
    );
    elements.usageCountLabel.textContent = `${state.usageTotal.toLocaleString()} matching activit${state.usageTotal === 1 ? 'y' : 'ies'}`;
    elements.usageBody.replaceChildren(...state.usage.map(usageRow));
    elements.usageEmptyState.hidden = state.usage.length > 0;
    elements.usageLoadMore.hidden = state.usage.length >= state.usageTotal;
    elements.usageLoadMore.disabled = state.usageLoading;
    elements.usageRangeLabel.textContent = state.usage.length
      ? `Showing 1–${state.usage.length} of ${state.usageTotal}`
      : 'No activity to show';
    renderUsageChart();
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

  async function loadUsage({ append = false } = {}) {
    if (state.usageLoading) {
      if (!append) usageReloadQueued = true;
      return;
    }
    state.usageLoading = true;
    elements.usageCountLabel.textContent = 'Loading activity…';
    elements.usageLoadMore.disabled = true;
    elements.refreshUsage.disabled = true;
    elements.usageChart.classList.add('usage-chart--loading');
    const offset = append ? state.usage.length : 0;
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      range: state.usageRange,
    });
    if (state.usageSearch) parameters.set('search', state.usageSearch);
    if (state.usageLane) parameters.set('lane', state.usageLane);
    try {
      const result = await request(`/v1/admin/usage?${parameters}`);
      state.usage = append
        ? [...state.usage, ...result.items]
        : result.items;
      state.usageLoaded = true;
      state.usageSeries = result.series;
      state.usageTotal = result.page.total;
      state.usageSummary = result.summary;
      renderUsage();
    } finally {
      state.usageLoading = false;
      elements.usageLoadMore.disabled = false;
      elements.refreshUsage.disabled = false;
      elements.usageChart.classList.remove('usage-chart--loading');
      if (usageReloadQueued) {
        usageReloadQueued = false;
        loadUsage().catch((error) => showToast(error.message));
      }
    }
  }

  function showPage(page) {
    state.currentPage = page;
    const showingUsers = page === 'users';
    const showingUsage = page === 'usage';
    const showingCodes = page === 'codes';
    elements.usersPage.hidden = !showingUsers;
    elements.usagePage.hidden = !showingUsage;
    elements.accessCodesPage.hidden = !showingCodes;
    elements.usersNav.classList.toggle('nav-item--active', showingUsers);
    elements.usageNav.classList.toggle('nav-item--active', showingUsage);
    elements.accessCodesNav.classList.toggle(
      'nav-item--active',
      showingCodes,
    );
    for (const [nav, active] of [
      [elements.usersNav, showingUsers],
      [elements.usageNav, showingUsage],
      [elements.accessCodesNav, showingCodes],
    ]) {
      if (active) nav.setAttribute('aria-current', 'page');
      else nav.removeAttribute('aria-current');
    }
    if (showingUsage && !state.usageLoaded) {
      loadUsage().catch((error) => showToast(error.message));
    }
    if (showingCodes && !state.accessCodesLoaded) {
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
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      dialog.close();
    }
    state.token = '';
    state.users = [];
    state.accessCodes = [];
    state.accessCodesLoaded = false;
    state.usage = [];
    state.usageLoaded = false;
    state.usageSeries = { granularity: 'day', items: [] };
    state.usageTotal = 0;
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
      elements.loginForm.reset();
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
  elements.usageNav.addEventListener('click', () => showPage('usage'));
  elements.accessCodesNav.addEventListener('click', () => showPage('codes'));
  elements.refreshUsage.addEventListener('click', () => {
    loadUsage().catch((error) => showToast(error.message));
  });
  elements.usageLoadMore.addEventListener('click', () =>
    loadUsage({ append: true }).catch((error) => showToast(error.message)),
  );
  elements.closeCodeDialog.addEventListener('click', closeCodeDialog);
  elements.cancelCodeDialog.addEventListener('click', closeCodeDialog);
  elements.codeForm.addEventListener('submit', submitCodes);
  elements.copyCodes.addEventListener('click', copyCodes);
  elements.closeResultDialog.addEventListener('click', closeResultDialog);
  elements.doneResults.addEventListener('click', closeResultDialog);
  elements.closeCodeUsersDialog.addEventListener('click', closeCodeUsersDialog);
  elements.closeCodeUsers.addEventListener('click', closeCodeUsersDialog);
  elements.loadMoreCodeUsers.addEventListener('click', () => {
    const code = state.accessCodes.find(
      (item) => item.id === elements.codeUsersDialog.dataset.codeId,
    );
    if (code) {
      loadCodeUsers(code, { append: true }).catch((error) =>
        showToast(error.message),
      );
    }
  });
  elements.statusFilter.addEventListener('change', () => {
    state.status = elements.statusFilter.value;
    loadUsers().catch((error) => showToast(error.message));
  });
  elements.codeStatusFilter.addEventListener('change', () => {
    state.codeStatus = elements.codeStatusFilter.value;
    loadAccessCodes().catch((error) => showToast(error.message));
  });
  elements.usageLaneFilter.addEventListener('change', () => {
    state.usageLane = elements.usageLaneFilter.value;
    loadUsage().catch((error) => showToast(error.message));
  });
  elements.usageRangeFilter.addEventListener('change', () => {
    state.usageRange = elements.usageRangeFilter.value;
    loadUsage().catch((error) => showToast(error.message));
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
  elements.usageSearch.addEventListener('input', () => {
    window.clearTimeout(usageSearchTimer);
    usageSearchTimer = window.setTimeout(() => {
      state.usageSearch = elements.usageSearch.value.trim();
      loadUsage().catch((error) => showToast(error.message));
    }, 260);
  });
  void restoreSession();
})();
