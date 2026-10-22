const loading = new Map()

export function loadECharts() {
  return loadScripts(['/vendor/echarts.min.js']).then(() => window.echarts)
}

export async function loadCytoscape() {
  await loadScripts(['/vendor/cytoscape.min.js', '/vendor/dagre.min.js', '/vendor/cytoscape-dagre.js'])
  const cytoscape = window.cytoscape
  if (!cytoscape('layout', 'dagre') && window.cytoscapeDagre) cytoscape.use(window.cytoscapeDagre)
  return cytoscape
}

async function loadScripts(sources) {
  for (const source of sources) await loadScript(source)
}

function loadScript(source) {
  if (!loading.has(source)) {
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = source
      script.async = false
      script.onload = resolve
      script.onerror = () => {
        loading.delete(source)
        script.remove()
        reject(new Error(`Could not load ${source}`))
      }
      document.head.append(script)
    })
    loading.set(source, promise)
  }
  return loading.get(source)
}
