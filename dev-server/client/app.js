import {applyWorkspaceHeader, render} from './app.view.js';
import {initNavigation} from './core/navigation.js';
import {$, isTyping, showToast, state} from './core/state.js';
import {initTheme} from './core/theme.js';
import {fetchAgent} from './features/assistant/agent.service.js';
import {initAssistant} from './features/assistant/assistant.js';
import {initTaskChat} from './features/assistant/task-chat.js';
import {installGraph} from './features/graph/graph.view.js';
import {initSettings} from './features/settings/settings.js';
import {initBoard} from './features/tasks/board.view.js';
import {initTaskActions} from './features/tasks/task-actions.js';
import {fetchQueue} from './features/tasks/tasks.service.js';

async function loadTasks() {
  state.loading = true;
  state.error = '';
  state.forbidden = false;
  render(state);
  try {
    const payload = await fetchQueue();
    state.tasks = payload.tasks;
    state.queueVersion += 1;
    state.gates = payload.gates;
    state.initialized = payload.initialized;
    state.workspace = payload.workspace || state.workspace;
    applyWorkspaceHeader(state);
  } catch (error) {
    if (error.status === 403) state.forbidden = true;
    else state.error = error.message;
  } finally {
    state.loading = false;
    if (!state.initialised && state.initialized) {
      state.initialised = true;
      const hasInProgress = state.tasks.some(
        task => task.status === 'in-progress',
      );
      const hasReady = state.tasks.some(task => task.status === 'ready');
      if (
        !state.sectionExplicit &&
        state.section === 'in-progress' &&
        !hasInProgress &&
        hasReady
      )
        state.section = 'ready';
    }
    if (
      !state.sectionExplicit &&
      state.view !== 'task' &&
      state.workspace.view === 'board' &&
      location.pathname === '/'
    ) {
      state.section = 'board';
      history.replaceState(null, '', '/board');
    }
    render(state);
    navigation.refreshOpenDetails();
  }
}

const settings = initSettings({loadTasks});

const actions = initTaskActions({
  loadTasks,
  reloadActiveTask: id => navigation.reloadActiveTask(id),
  openPeek: id => navigation.openPeek(id),
  openSettings: mode => settings.open(mode),
});

function handleBoardMove(task, target) {
  if (!task) return;
  if (target === 'awaiting') {
    showToast(
      'Awaiting production comes from a production gate; use Block to link the gate.',
      'info',
    );
    return;
  }
  if (task.status === 'done') {
    showToast('Done records are immutable.', 'error');
    return;
  }
  if (target === 'in-progress') {
    if (task.status === 'in-progress') return;
    if (task.status === 'on-hold') {
      showToast('Resume the task before starting it.', 'error');
      return;
    }
    if (task.status === 'ready' && !task.awaitingProduction) {
      actions.handleDetailAction(task, 'start');
      return;
    }
    showToast(
      task.status === 'blocked' || task.awaitingProduction
        ? 'Unblock the task before starting it.'
        : 'Only a ready task can be started.',
      'error',
    );
    return;
  }
  if (target === 'ready') {
    if (task.status === 'ready') return;
    if (task.status === 'blocked') {
      actions.handleDetailAction(task, 'unblock');
      return;
    }
    if (task.status === 'on-hold') {
      actions.handleDetailAction(task, 'resume');
      return;
    }
    showToast(
      task.status === 'in-progress'
        ? 'An in-progress task can only be done or blocked.'
        : 'Only a blocked task can move back to ready.',
      'error',
    );
    return;
  }
  if (target === 'blocked') {
    if (task.status === 'blocked') return;
    if (task.status === 'on-hold') {
      showToast('Resume the task before blocking it.', 'error');
      return;
    }
    actions.handleDetailAction(task, 'block');
    return;
  }
  if (target === 'on-hold') {
    if (task.status === 'on-hold') return;
    actions.handleDetailAction(task, 'hold');
    return;
  }
  if (target === 'done') actions.handleDetailAction(task, 'done');
}

const navigation = initNavigation({
  loadTasks,
  onAction: actions.handleDetailAction,
  onSave: actions.saveTaskBody,
  onCopy: actions.copyTaskLink,
  onPageTask: task => taskChat.setTask(task),
});

const taskChat = initTaskChat({
  showToast,
  reloadTask: id => navigation.reloadActiveTask(id),
  hasUnsavedEdits: () => navigation.hasUnsavedEdits(),
  openSettings: () => settings.open('settings'),
});

const assistant = initAssistant({
  showToast,
  reloadTasks: loadTasks,
  getActiveTaskId: () => navigation.activeTask()?.id,
  getTasks: () => state.tasks,
  openSettings: () => settings.open('settings'),
});

async function detectAssistant() {
  let enabled = false;
  try {
    const payload = await fetchAgent();
    enabled = Object.values(payload.available || {}).some(Boolean);
  } catch {}
  const previous = document.documentElement.dataset.ai;
  document.documentElement.dataset.ai = enabled ? 'on' : 'off';
  if (!enabled && document.querySelector('#agent-dialog').open)
    assistant.close();
  if (previous !== document.documentElement.dataset.ai) taskChat.refresh();
  return enabled;
}

function handleListClick(event) {
  if (event.target.closest('[data-retry]')) {
    loadTasks();
    return;
  }
  if (event.target.closest('[data-retry-charts]')) {
    render(state);
    return;
  }
  if (event.target.closest('[data-init]')) {
    settings.open('init');
    return;
  }
  const section = event.target.closest('[data-section]');
  if (section) {
    navigation.setSection(section.dataset.section);
    return;
  }
  const open = event.target.closest('[data-open]');
  if (open) {
    navigation.openPeek(open.dataset.open);
    return;
  }
  if (event.target.closest('[data-new-task]')) actions.openAddDialog();
}

function handleShortcut(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTyping(event.target)) return;
  const dialogOpen = Boolean(document.querySelector('dialog[open]'));
  if (event.key === '/') {
    event.preventDefault();
    $('#search').focus();
  }
  if (event.key === 'r') loadTasks();
  if (dialogOpen) return;
  if (event.key === 'n') {
    event.preventDefault();
    actions.openAddDialog();
  }
  if (event.key === 'b') navigation.setSection('board');
  if (event.key === 'p') navigation.setSection('pitfalls');
  if (event.key === 'i') navigation.setSection('insights');
  if (event.key === 'g') navigation.setSection('graph');
  if (event.key === 'Escape' && state.view === 'task') navigation.goBack();
}

$('#sections').addEventListener('click', handleListClick);
$('#gate-card').addEventListener('click', handleListClick);
$('#task-list').addEventListener('click', handleListClick);

const viewRoot = $('#view-root');
installGraph(viewRoot);
initBoard({
  root: viewRoot,
  onMove: handleBoardMove,
});
viewRoot.addEventListener('click', handleListClick);
viewRoot.addEventListener('queue-open-task', event =>
  navigation.openPeek(event.detail),
);
viewRoot.addEventListener('queue-set-section', event =>
  navigation.setSection(event.detail),
);
viewRoot.addEventListener('queue-rerender', () => render(state));

$('#search').addEventListener('input', event => {
  state.query = event.target.value;
  render(state);
});
$('#refresh').addEventListener('click', loadTasks);
$('#new-task').addEventListener('click', actions.openAddDialog);
$('#assistant').addEventListener('click', () => {
  if (document.documentElement.dataset.ai === 'on') assistant.open();
});
window.addEventListener('queue-agent-config-changed', detectAssistant);
window.addEventListener('queue-view-changed', event => {
  if (state.view === 'task') return;
  const view = event.detail?.view;
  if (view === 'board' && state.section !== 'board')
    navigation.setSection('board');
  else if (view === 'list' && state.section === 'board')
    navigation.setSection('ready');
});

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  const dialog = close?.closest('dialog');
  if (dialog) dialog.close();
});
document.addEventListener('keydown', handleShortcut);

initTheme({onChange: () => render(state)});
navigation.applyRoute();
loadTasks();
detectAssistant().then(enabled => {
  if (enabled && location.hash === '#assistant') assistant.open();
});
