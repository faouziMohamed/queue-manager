import {escapeHtml} from '../../core/html.util.js';
import {taskPath} from '../../core/router.js';
import {$, showToast, state} from '../../core/state.js';
import {applyTaskAction, createTask, updateTaskBody} from './tasks.service.js';

/**
 * Wires task transitions, body saves and the new-task, block and done dialogs.
 * @param {{loadTasks: () => Promise<void>, reloadActiveTask: (id: string) => Promise<void>, openPeek: (id: string) => void, openSettings: () => void}} options
 */
export function initTaskActions({
  loadTasks,
  reloadActiveTask,
  openPeek,
  openSettings,
}) {
  const addDialog = $('#add-dialog');
  const blockDialog = $('#block-dialog');
  const doneDialog = $('#done-dialog');

  async function runAction(id, payload, message) {
    try {
      await applyTaskAction(id, payload);
      showToast(message, 'success');
      await reloadActiveTask(id);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function openBlockDialog(id) {
    const target = state.tasks.find(task => task.id === id);
    const candidates = state.tasks.filter(
      task => task.status !== 'done' && task.id !== id,
    );
    state.blockTarget = id;
    $('#block-options').innerHTML = candidates.length
      ? candidates
          .map(
            task => `<label class="check-item">
          <input type="checkbox" name="blocker" value="${task.id}">
          <span><strong>${escapeHtml(task.id)} · ${escapeHtml(task.title)}</strong><small>${escapeHtml(task.status)} · ${escapeHtml(task.resume)}</small></span>
        </label>`,
          )
          .join('')
      : '<p class="muted">No other open task is available as a blocker.</p>';
    if (!blockDialog.open) blockDialog.showModal();
    if (target) $('#block-dialog h2').textContent = `Block ${target.id}`;
  }

  function openDoneDialog(id) {
    state.doneTarget = id;
    $('#done-form').elements.summary.value = '';
    const task = state.tasks.find(item => item.id === id);
    const open = task?.dod?.present
      ? task.dod.items.filter(item => !item.done)
      : [];
    const warning = $('#done-dod');
    warning.hidden = open.length === 0;
    warning.innerHTML = open.length
      ? `<strong>${open.length} Definition of done item${open.length === 1 ? '' : 's'} not checked</strong>
        <ul>${open.map(item => `<li>${escapeHtml(item.text).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>
        <p>Finish them, or record why they are deferred under What is left before closing.</p>`
      : '';
    if (!doneDialog.open) doneDialog.showModal();
  }

  function handleDetailAction(task, action) {
    if (action === 'start')
      runAction(task.id, {action: 'start'}, 'Task started.');
    if (action === 'unblock')
      runAction(task.id, {action: 'unblock'}, 'Task unblocked.');
    if (action === 'hold')
      runAction(task.id, {action: 'hold'}, 'Task put on hold.');
    if (action === 'resume')
      runAction(task.id, {action: 'resume'}, 'Task resumed.');
    if (action === 'block') openBlockDialog(task.id);
    if (action === 'done') openDoneDialog(task.id);
  }

  async function saveTaskBody(task, body) {
    try {
      await updateTaskBody(task.id, body);
      showToast('Task body saved.', 'success');
      await loadTasks();
    } catch (error) {
      showToast(error.message, 'error');
      throw error;
    }
  }

  async function copyTaskLink(task) {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${taskPath(task.id)}`,
      );
      showToast('Task link copied.', 'success');
    } catch {
      showToast('Could not copy the link.', 'error');
    }
  }

  function openAddDialog() {
    if (!state.initialized) {
      openSettings('init');
      return;
    }
    addDialog.showModal();
    $('#add-form [name="title"]').focus();
  }

  $('#add-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const payload = await createTask({
        title: data.get('title'),
        priority: data.get('priority'),
        resume: data.get('resume'),
      });
      addDialog.close();
      form.reset();
      showToast('Task created.', 'success');
      await loadTasks();
      if (payload.id) openPeek(payload.id);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#block-form').addEventListener('submit', async event => {
    event.preventDefault();
    const checked = [
      ...event.currentTarget.querySelectorAll('[name="blocker"]:checked'),
    ];
    if (!checked.length) {
      showToast('Choose at least one blocker.', 'error');
      return;
    }
    blockDialog.close();
    await runAction(
      state.blockTarget,
      {action: 'block', by: checked.map(input => input.value)},
      'Task blocked.',
    );
  });

  $('#done-form').addEventListener('submit', async event => {
    event.preventDefault();
    const summary = new FormData(event.currentTarget).get('summary');
    doneDialog.close();
    await runAction(
      state.doneTarget,
      {action: 'done', summary},
      'Task marked shipped.',
    );
  });

  return {handleDetailAction, saveTaskBody, copyTaskLink, openAddDialog};
}
