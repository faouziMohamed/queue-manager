# Vendored browser libraries

Pinned copies served by the dev server from `/vendor/`, so the UI works offline
with no build step. Replace a file only together with its version below.

| File | Package | License |
| --- | --- | --- |
| `echarts.min.js` | echarts 5.5.1 (`dist/echarts.min.js`) | Apache-2.0 |
| `cytoscape.min.js` | cytoscape 3.30.2 (`dist/cytoscape.min.js`) | MIT |
| `dagre.min.js` | dagre 0.8.5 (`dist/dagre.min.js`) | MIT |
| `cytoscape-dagre.js` | cytoscape-dagre 2.5.0 | MIT |

Refresh: `npm pack <package>@<version>`, extract, copy the file listed above.
