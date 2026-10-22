import {api, toTask} from './api.js'
import {$, showToast, state} from './app-state.js'
import {applyWorkspaceHeader, render, sectionLabel} from './render.js'
import {internalPath, parseRoute, peekPath, sectionForTask, sectionPath, taskPath} from './router.js'
import {mountTaskDetail} from './task-detail.js'

const UNSAVED_MESSAGE = 'You have unsaved edits. Save the body or press Cancel first.'

export function initNavigation({loadTasks, onAction, onSave, onCopy, onPageTask}) {
  const taskDialog = $('#task-dialog')

  const drawerDetail = mountTaskDetail($('#task-drawer-detail'), {
    variant: 'drawer',
    onAction,
    onSave,
    onCopy,
    onOpenFull: task => openFullPage(task.id),
    onOpenTask: id => openPeek(id),
  })

  const pageDetail = mountTaskDetail($('#task-page-detail'), {
    variant: 'page',
    onAction,
    onSave,
    onCopy,
    onOpenFull: () => {},
    onOpenTask: id => openFullPage(id),
  })

  function activeTask() {
    if (state.view === 'task') return pageDetail.task
    return taskDialog.open ? drawerDetail.task : null
  }

  function hasUnsavedEdits() {
    return drawerDetail.isDirty() || pageDetail.isDirty()
  }

  function refuseUnsaved() {
    if (!hasUnsavedEdits()) return false
    showToast(UNSAVED_MESSAGE, 'error')
    return true
  }

  function navigate(path, {replace = false} = {}) {
    if (`${location.pathname}${location.search}` === path && !location.hash) {
      applyRoute()
      return
    }
    if (refuseUnsaved()) return
    history[replace ? 'replaceState' : 'pushState'](null, '', path)
    applyRoute()
  }

  function applyRoute() {
    const route = parseRoute(location.pathname, location.search, location.hash)
    if (route.legacy) history.replaceState(null, '', peekPath(state.section, route.peek))
    if (route.kind === 'task') {
      if (taskDialog.open) taskDialog.close()
      state.view = 'task'
      state.pageTaskId = route.id
      render(state)
      loadTaskPage(route.id)
      return
    }
    state.view = 'list'
    state.pageTaskId = ''
    onPageTask(null)
    applyWorkspaceHeader(state)
    if (route.section) {
      state.section = route.section
      state.sectionExplicit = true
    }
    render(state)
    if (route.peek) showPeek(route.peek)
    else if (taskDialog.open) taskDialog.close()
  }

  function setSection(section) {
    state.returnSection = ''
    navigate(sectionPath(section))
  }

  function openPeek(id) {
    if (state.view === 'task') {
      openFullPage(id)
      return
    }
    navigate(peekPath(state.section, id), {replace: taskDialog.open})
  }

  function openFullPage(id) {
    if (state.view !== 'task') state.returnSection = state.section
    navigate(taskPath(id))
  }

  function goBack() {
    navigate($('#task-back').getAttribute('href'))
  }

  async function showPeek(id) {
    try {
      const task = toTask(await api(`/api/tasks/${id}`))
      drawerDetail.show(task, state)
      if (!taskDialog.open) taskDialog.showModal()
    } catch (error) {
      showToast(error.status === 404 ? `Task ${id} was not found.` : error.message, 'error')
      history.replaceState(null, '', sectionPath(state.section))
    }
  }

  async function loadTaskPage(id) {
    $('#task-crumb-id').textContent = id
    updateBackLink()
    if (pageDetail.task?.id !== id) {
      pageDetail.showState('loading')
      onPageTask(null)
    }
    try {
      const task = toTask(await api(`/api/tasks/${id}`))
      if (state.pageTaskId !== id) return
      if (!state.returnSection) state.section = sectionForTask(task)
      pageDetail.show(task, state)
      onPageTask(task)
      document.title = `${task.id} · ${task.title}`
      updateBackLink()
      render(state)
    } catch (error) {
      if (state.pageTaskId !== id) return
      onPageTask(null)
      if (error.status === 404) pageDetail.showState('not-found', `${id} is not in this queue.`)
      else if (error.status === 403) pageDetail.showState('forbidden')
      else pageDetail.showState('error', error.message)
    }
  }

  function updateBackLink() {
    const section = state.returnSection || state.section
    $('#task-back').href = sectionPath(section)
    $('#task-back-label').textContent = sectionLabel(section)
  }

  function refreshOpenDetails() {
    if (state.view === 'task' && pageDetail.task) pageDetail.refresh(state)
    if (taskDialog.open && drawerDetail.task) drawerDetail.refresh(state)
  }

  async function reloadActiveTask(id) {
    await loadTasks()
    if (state.view === 'task' && state.pageTaskId === id) await loadTaskPage(id)
    else if (taskDialog.open && drawerDetail.task?.id === id) await showPeek(id)
  }

  taskDialog.addEventListener('cancel', event => {
    if (!drawerDetail.isDirty()) return
    event.preventDefault()
    showToast(UNSAVED_MESSAGE, 'error')
  })

  taskDialog.addEventListener('close', () => {
    if (state.view !== 'task' && parseRoute(location.pathname, location.search).peek) {
      history.replaceState(null, '', sectionPath(state.section))
    }
  })

  $('#task-page-detail').addEventListener('click', event => {
    if (event.target.closest('[data-detail-retry]') && state.pageTaskId) loadTaskPage(state.pageTaskId)
  })

  document.addEventListener('click', event => {
    const peekLink = event.target.closest('a[data-task-link]')
    if (peekLink && !peekLink.closest('#task-drawer-detail, #task-page-detail') && internalPath(peekLink, event)) {
      event.preventDefault()
      openPeek(peekLink.dataset.taskLink)
      return
    }
    const path = internalPath(event.target.closest('a[href]'), event)
    if (!path) return
    event.preventDefault()
    navigate(path)
  })

  window.addEventListener('popstate', () => {
    if (hasUnsavedEdits()) {
      const current = state.view === 'task' ? taskPath(state.pageTaskId) : peekPath(state.section, drawerDetail.task.id)
      history.pushState(null, '', current)
      refuseUnsaved()
      return
    }
    applyRoute()
  })

  window.addEventListener('beforeunload', event => {
    if (hasUnsavedEdits()) event.preventDefault()
  })

  return {
    activeTask,
    applyRoute,
    hasUnsavedEdits,
    goBack,
    openFullPage,
    openPeek,
    refreshOpenDetails,
    reloadActiveTask,
    setSection,
  }
}
