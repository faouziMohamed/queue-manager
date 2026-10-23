import {promises as fs} from 'node:fs'
import path from 'node:path'

export async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function hasWorkspaceMarker(rootPath) {
  for (const marker of ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json', 'rush.json']) {
    if (await pathExists(path.join(rootPath, marker))) return true
  }
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'))
    return Boolean(manifest.workspaces)
  } catch {
    return false
  }
}

export async function detectWorkspace(rootPath) {
  const repos = []
  const entries = await fs.readdir(rootPath, {withFileTypes: true})
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const directory = path.join(rootPath, entry.name)
    if (await pathExists(path.join(directory, '.git'))) {
      repos.push(entry.name)
      continue
    }
    let children = []
    try {
      children = await fs.readdir(directory, {withFileTypes: true})
    } catch {
      continue
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.') || child.name === 'node_modules') continue
      if (await pathExists(path.join(directory, child.name, '.git'))) {
        repos.push(`${entry.name}/${child.name}`)
      }
    }
  }

  const monorepo = await hasWorkspaceMarker(rootPath)
  const layout = monorepo ? 'monorepo' : repos.length > 0 ? 'workspace' : 'single-repo'
  return {
    name: path.basename(rootPath),
    layout,
    mode: layout === 'single-repo' ? 'repo' : 'workspace',
    view: 'list',
    design: 'jira',
    wipLimit: 1,
    repos: repos.sort(),
    agent: {provider: 'auto', model: ''},
  }
}

export function normalizeWorkspaceConfig(input, fallbackName) {
  const name = String(input.name || fallbackName || 'Queue').trim().slice(0, 80) || 'Queue'
  const allowed = ['workspace', 'monorepo', 'single-repo']
  const layout = allowed.includes(input.layout) ? input.layout : 'single-repo'
  const views = ['list', 'board']
  const view = views.includes(input.view) ? input.view : 'list'
  const designs = ['jira', 'classic']
  const design = designs.includes(input.design) ? input.design : 'jira'
  const repos = layout === 'single-repo' ? [] : [...new Set(
    (Array.isArray(input.repos) ? input.repos : [])
      .map(value => String(value).trim())
      .filter(Boolean),
  )].slice(0, 100)
  const wipLimit = Math.min(Math.max(Number.parseInt(input.wipLimit, 10) || 1, 1), 20)
  const providers = ['auto', 'claude-cli', 'claude-api', 'codex-cli', 'codex-api', 'deepseek-cli', 'deepseek']
  const agentInput = input.agent && typeof input.agent === 'object' ? input.agent : {}
  const agent = {
    provider: providers.includes(agentInput.provider) ? agentInput.provider : 'auto',
    model: String(agentInput.model || '').trim().slice(0, 80),
  }
  return {
    version: 1,
    name,
    layout,
    mode: layout === 'single-repo' ? 'repo' : 'workspace',
    view,
    design,
    wipLimit,
    repos,
    agent,
  }
}

export async function readWorkspaceConfig(rootPath, detected) {
  try {
    const text = await fs.readFile(path.join(rootPath, '.queue', 'config.json'), 'utf8')
    return normalizeWorkspaceConfig(JSON.parse(text), detected.name)
  } catch {
    return detected
  }
}

export async function writeWorkspaceConfig(rootPath, config) {
  const directory = path.join(rootPath, '.queue')
  await fs.mkdir(directory, {recursive: true})
  await fs.writeFile(
    path.join(directory, 'config.json'),
    `${JSON.stringify({
      version: 1,
      name: config.name,
      layout: config.layout,
      view: config.view,
      design: config.design,
      wipLimit: config.wipLimit,
      repos: config.repos,
      agent: config.agent,
    }, null, 2)}\n`,
    'utf8',
  )
}

export function withWorkspaceIdentity(task, workspace) {
  const match = task.title.match(/^\[([^\]]+)\]\s*(.+)$/)
  let repo = task.sourceRepository
  let title = task.title
  if (match && !repo && workspace.repos.includes(match[1])) repo = match[1]
  if (match && repo && match[1] === repo) title = match[2]
  return {
    ...task,
    title,
    repo: workspace.mode === 'workspace' ? repo : '',
  }
}
