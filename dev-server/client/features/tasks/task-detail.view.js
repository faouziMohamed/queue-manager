import {PAGES} from '../../../shared/routes.constant.mjs';
import {escapeHtml} from '../../core/html.util.js';
import {renderMarkdown} from '../../core/markdown.util.js';
import {detailActions, detailChips} from './task-chips.view.js';
import {
  detailTemplate,
  dodPanel,
  facts,
  relationRows,
  statePanel,
} from './task-detail-parts.view.js';

/** @typedef {import('../../../shared/types.mjs').Task} Task */
/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

/**
 * Mounts a task detail (drawer or full page) with view/edit of the body.
 * @param {HTMLElement} root
 * @param {{variant: 'drawer' | 'page', onAction: (task: Task, action: string) => void, onSave: (task: Task, body: string) => Promise<void>, onOpenFull?: (task: Task) => void, onOpenTask: (id: string) => void, onCopy: (task: Task) => void}} options
 * @returns {{show: (task: Task, context: AppState) => void, refresh: (context: AppState) => void, showState: (kind: string, message?: string) => void, isDirty: () => boolean, cancelEdit: () => void, readonly task: Task | null}}
 */
export function mountTaskDetail(
  root,
  {variant, onAction, onSave, onOpenFull, onOpenTask, onCopy},
) {
  root.innerHTML = detailTemplate(variant);
  const element = name => root.querySelector(`[data-detail="${name}"]`);
  const view = {task: null, context: null, editing: false, saving: false};

  function show(task, context) {
    const switching = view.task?.id !== task.id;
    view.task = task;
    view.context = context;
    element('state').hidden = true;
    element('content').hidden = false;
    element('eyebrow').textContent =
      `${task.status} · P${task.priority} · updated ${task.updated}`;
    element('title').textContent = task.title;
    element('actions').innerHTML = detailActions(task);
    element('edit-tab').disabled = task.status === 'done';
    if (switching || !view.editing) {
      element('textarea').value = task.body;
      renderBody(task.body);
      setMode('view');
      element('save-status').textContent = '';
    }
    refresh(context);
  }

  function refresh(context) {
    if (!view.task) return;
    view.context = context;
    element('chips').innerHTML = detailChips(context, view.task, {
      relations: variant === 'drawer',
    });
    if (variant === 'page') {
      element('facts').innerHTML = facts(view.task, context);
      element('blockers').innerHTML = relationRows(
        view.task.blockedBy,
        context,
        'Not blocked by any task.',
      );
      const dependents = context.tasks
        .filter(task => task.blockedBy.includes(view.task.id))
        .map(task => task.id);
      element('dependents').innerHTML = relationRows(
        dependents,
        context,
        'No task waits on this one.',
      );
      const dod = view.task.dod;
      element('dod-card').hidden = !dod || !dod.present;
      element('dod').innerHTML = dodPanel(dod);
      const pitfalls = [
        ...new Set(
          (view.task.body.match(/\bPIT-\d{3,}\b/gi) || []).map(id =>
            id.toUpperCase(),
          ),
        ),
      ];
      element('pitfalls-card').hidden = pitfalls.length === 0;
      element('pitfalls').innerHTML = pitfalls
        .map(
          id =>
            `<a class="chip pitfall" href="${PAGES.section('pitfalls')}#${id.toLowerCase()}">${escapeHtml(id)}</a>`,
        )
        .join('');
    }
  }

  function showState(kind, message) {
    view.task = null;
    element('content').hidden = true;
    const target = element('state');
    target.hidden = false;
    target.innerHTML = statePanel(kind, message);
  }

  function renderBody(body) {
    element('rendered').innerHTML = renderMarkdown(body);
    if (variant !== 'page') return;
    const headings = [...element('rendered').querySelectorAll('h1, h2, h3')];
    headings.forEach((heading, index) => {
      heading.id = `section-${index + 1}`;
    });
    element('outline-card').hidden = headings.length < 3;
    element('outline').innerHTML = headings
      .map(
        heading =>
          `<button type="button" class="outline-item level-${heading.tagName.slice(1)}" data-outline="${heading.id}">${escapeHtml(heading.textContent)}</button>`,
      )
      .join('');
  }

  function setMode(mode) {
    view.editing = mode === 'edit';
    element('rendered').hidden = view.editing;
    element('edit').hidden = !view.editing;
    element('save').hidden = !view.editing;
    element('cancel').hidden = !view.editing;
    element('edit-hint').hidden = !view.editing;
    element('view-tab').setAttribute('aria-selected', String(!view.editing));
    element('edit-tab').setAttribute('aria-selected', String(view.editing));
    if (view.editing) element('textarea').focus();
  }

  function isDirty() {
    return Boolean(
      view.editing && view.task && element('textarea').value !== view.task.body,
    );
  }

  function cancelEdit() {
    if (!view.task) return;
    element('textarea').value = view.task.body;
    element('save-status').textContent = '';
    setMode('view');
  }

  async function save() {
    if (!view.task || view.saving) return;
    const body = element('textarea').value;
    view.saving = true;
    element('save').disabled = true;
    element('save-status').textContent = 'Saving…';
    try {
      await onSave(view.task, body);
      view.task.body = body;
      renderBody(body);
      refresh(view.context);
      setMode('view');
      element('save-status').textContent = 'Saved';
    } catch {
      element('save-status').textContent = '';
    } finally {
      view.saving = false;
      element('save').disabled = false;
    }
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-detail-action]');
    if (action && view.task) {
      onAction(view.task, action.dataset.detailAction);
      return;
    }
    if (event.target.closest('[data-detail="view-tab"]')) {
      if (!isDirty()) setMode('view');
      return;
    }
    if (event.target.closest('[data-detail="edit-tab"]')) {
      setMode('edit');
      return;
    }
    if (event.target.closest('[data-detail="save"]')) {
      save();
      return;
    }
    if (event.target.closest('[data-detail="cancel"]')) {
      cancelEdit();
      return;
    }
    if (event.target.closest('[data-detail="copy"]') && view.task) {
      onCopy(view.task);
      return;
    }
    if (event.target.closest('[data-detail="open-full"]') && view.task) {
      onOpenFull(view.task);
      return;
    }
    const outline = event.target.closest('[data-outline]');
    if (outline) {
      root
        .querySelector(`#${outline.dataset.outline}`)
        ?.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    const link = event.target.closest('a[data-task-link]');
    if (
      link &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      onOpenTask(link.dataset.taskLink);
    }
  });

  element('textarea').addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && (event.key === 's' || event.key === 'Enter')) {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!isDirty()) cancelEdit();
      else
        element('save-status').textContent =
          'Unsaved changes — save or press Cancel.';
    }
  });

  return {
    show,
    refresh,
    showState,
    isDirty,
    cancelEdit,
    get task() {
      return view.task;
    },
  };
}
