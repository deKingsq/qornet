import cytoscape from 'cytoscape'
import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape'
import { ArrowUpRight, Crosshair, Fingerprint, Maximize2, Minus, Network, Plus, Router, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cluster, Graph, GraphNode, Snapshot } from '../shared/domain.ts'
import { Empty, Evidence, PanelTitle, RiskBadge, RiskSummary } from './components.tsx'
import { num } from './lib.ts'

const styles: StylesheetJson = [
  { selector: 'node', style: { label: 'data(label)', color: '#b3c0cb', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 14,
    'text-margin-y': 8, 'text-valign': 'bottom', 'text-outline-width': 2, 'text-outline-color': '#101a21', 'background-color': '#263740', 'border-width': 1.5, 'border-color': '#8299a7', width: 18, height: 18 } },
  { selector: 'node[cluster]', style: { width: 24, height: 24, 'background-color': '#704332', 'border-color': '#f6aa80', color: '#f5ccaf' } },
  { selector: 'node[kind = "device"]', style: { shape: 'round-rectangle', 'background-color': '#225b48', 'border-color': '#63d6a1', color: '#b3e6d1', width: 29, height: 25 } },
  { selector: 'node[kind = "ip"]', style: { shape: 'diamond', 'background-color': '#2d4865', 'border-color': '#79a8d9', color: '#acc9e7', width: 28, height: 28 } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#e0f7ea', 'overlay-opacity': 0.13, 'overlay-color': '#a7f9cf', 'overlay-padding': 6 } },
  { selector: 'edge', style: { width: 1.05, 'curve-style': 'bezier', 'line-color': '#3a5263', opacity: 0.66 } },
  { selector: 'edge[kind = "device"]', style: { 'line-style': 'dashed', 'line-color': '#4a9c7a' } },
  { selector: 'edge[kind = "ip"]', style: { 'line-style': 'dotted', 'line-color': '#647f9d' } },
  { selector: 'edge[kind = "transfer"]', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': '#3a5263', 'arrow-scale': 0.8 } },
  { selector: 'edge[?emphasis]', style: { 'line-color': '#c27d60', 'target-arrow-color': '#c27d60', width: 1.7 } },
  { selector: 'edge.faded, node.faded', style: { opacity: 0.17 } },
  { selector: 'edge.connected', style: { opacity: 1, width: 2.2 } },
  { selector: 'edge:selected', style: { width: 3, opacity: 1 } },
]

const juryStyles: StylesheetJson = [
  ...styles,
  { selector: 'node', style: { color: '#d7eee5', 'text-outline-color': '#101e25', 'background-color': '#263b41', 'border-color': '#8da79b' } },
  { selector: 'node[cluster]', style: { 'background-color': '#539779', 'border-color': '#a6edc9' } },
  { selector: 'node[kind = "device"]', style: { 'background-color': '#3c6a57', 'border-color': '#539779' } },
  { selector: 'node[kind = "ip"]', style: { 'background-color': '#3d5854', 'border-color': '#8da79b' } },
  { selector: 'node:selected', style: { 'border-color': '#a6edc9', 'overlay-color': '#539779' } },
  { selector: 'edge', style: { 'line-color': '#719389' } },
  { selector: 'edge[kind = "device"]', style: { 'line-color': '#539779' } },
  { selector: 'edge[kind = "ip"]', style: { 'line-color': '#719389' } },
  { selector: 'edge[kind = "transfer"]', style: { 'target-arrow-color': '#719389' } },
  { selector: 'edge[?emphasis]', style: { 'line-color': '#a6edc9', 'target-arrow-color': '#a6edc9' } },
]

function focusGraph(graph: Graph, cluster: Cluster | undefined, compact: boolean): Graph {
  const sharedIp = graph.nodes.find((node) => node.kind === 'ip')
  const anchors = new Set(cluster ? [...cluster.members, ...cluster.devices] : sharedIp ? [sharedIp.id] : graph.nodes.slice(0, 12).map(({ id }) => id))
  const visible = new Set(anchors)
  for (const edge of graph.edges) {
    if (!cluster && edge.kind === 'ip' && edge.target === sharedIp?.id) visible.add(edge.source)
    if (!compact && cluster && edge.kind === 'transfer' && edge.emphasis && (anchors.has(edge.source) || anchors.has(edge.target))) {
      visible.add(edge.source)
      visible.add(edge.target)
    }
  }
  return {
    nodes: graph.nodes.filter(({ id }) => visible.has(id)),
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
  }
}

function elements(graph: Graph): ElementDefinition[] {
  const transfers = new Map<string, Graph['edges'][number]>()
  const relations = graph.edges.filter((edge) => {
    if (edge.kind !== 'transfer') return true
    const key = `${edge.source}/${edge.target}`
    const existing = transfers.get(key)
    if (!existing || edge.emphasis) transfers.set(key, edge)
    return false
  })
  return [...graph.nodes.map((node) => ({ data: node })), ...[...relations, ...transfers.values()].map((edge) => ({ data: edge }))]
}

function focusPositions(graph: Graph, cluster: Cluster | undefined, stretch: number) {
  const positions: Record<string, { x: number; y: number }> = {}
  const receipts = new Map<string, number>()
  for (const edge of graph.edges) if (edge.kind === 'transfer') {
    receipts.set(edge.target, (receipts.get(edge.target) ?? 0) + 1)
  }
  const devices = graph.nodes.filter(({ kind }) => kind === 'device')
  const hubs = (cluster?.members ?? []).toSorted((a, b) => (receipts.get(b) ?? 0) - (receipts.get(a) ?? 0)).slice(0, 3)
  const ips = graph.nodes.filter(({ kind }) => kind === 'ip')
  devices.forEach(({ id }, index) => { positions[id] = { x: (index - (devices.length - 1) / 2) * 120, y: -55 } })
  hubs.forEach((id, index) => { positions[id] = { x: (index - 1) * 105, y: 42 } })
  ips.forEach(({ id }, index) => { positions[id] = { x: index * 100, y: 0 } })
  const ring = graph.nodes.filter(({ id }) => !positions[id]).toSorted((a, b) => Number(Boolean(b.cluster)) - Number(Boolean(a.cluster)) || a.id.localeCompare(b.id))
  ring.forEach(({ id }, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / ring.length
    positions[id] = { x: 259 * Math.cos(angle), y: 157 * Math.sin(angle) }
  })
  return Object.fromEntries(Object.entries(positions).map(([id, { x, y }]) => [id, { x: x * stretch, y }]))
}

export function NetworkPage({ snapshot, compact = false, guided = false }: { snapshot: Snapshot; compact?: boolean; guided?: boolean }) {
  const [clusterId, setClusterId] = useState(snapshot.clusters[0]?.id ?? '')
  const [mode, setMode] = useState<'focus' | 'all'>('focus')
  const [layer, setLayer] = useState<'all' | 'device' | 'transfer'>('all')
  const [selection, setSelection] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)
  const cluster = snapshot.clusters.find(({ id }) => id === clusterId)
  const graph = useMemo(() => mode === 'all' ? snapshot.graph : focusGraph(snapshot.graph, cluster, compact), [snapshot.graph, cluster, mode, compact])
  const displayed = useMemo(() => layer === 'all' ? graph : { ...graph, edges: graph.edges.filter((item) => item.kind === layer) }, [graph, layer])
  const node = graph.nodes.find(({ id }) => id === selection)
  const edge = graph.edges.find(({ id }) => id === selection)
  const account = snapshot.accounts.find(({ id }) => id === node?.id)
  const transaction = snapshot.transactions.find(({ id }) => id === edge?.id)
  const sharedIp = graph.nodes.find(({ kind }) => kind === 'ip')
  const sharedAccounts = graph.edges.filter(({ kind, target }) => kind === 'ip' && target === sharedIp?.id).length

  useEffect(() => {
    if (!container.current) return
    const instance = cytoscape({
      container: container.current,
      elements: elements(displayed),
      style: guided ? juryStyles : styles,
      layout: mode === 'focus'
        ? { name: 'preset', positions: focusPositions(graph, cluster, Math.max(1, Math.min(1.43, container.current.clientWidth / 595))), fit: true, padding: compact ? 30 : 39 }
        : { name: 'cose', animate: false, randomize: false, fit: true, padding: 52, nodeRepulsion: () => 8500, idealEdgeLength: () => 100 },
      minZoom: 0.18, maxZoom: 2.6, selectionType: 'single', boxSelectionEnabled: false,
    })
    cy.current = instance
    instance.on('tap', 'node, edge', (event) => setSelection(event.target.id()))
    instance.on('tap', (event) => { if (event.target === instance) setSelection('') })
    const observer = new ResizeObserver(() => {
      instance.resize()
      if (guided) instance.fit(undefined, 28)
    })
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.destroy(); cy.current = null }
  }, [displayed, graph, cluster, mode, compact, guided])

  useEffect(() => {
    const instance = cy.current
    if (!instance) return
    instance.elements().removeClass('faded connected')
    instance.elements(':selected').unselect()
    const active = instance.getElementById(selection)
    if (!active.length) return
    active.select()
    instance.elements().difference(active.closedNeighborhood()).addClass('faded')
    active.connectedEdges().addClass('connected')
  }, [selection, displayed])

  function select(id: string) {
    setSelection(id)
  }

  function zoom(factor: number) {
    const instance = cy.current
    if (instance) instance.zoom({ level: instance.zoom() * factor, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } })
  }

  const selectMode = (next: typeof mode) => { setMode(next); setSelection('') }
  const activeRisk = account?.risk ?? transaction?.risk
  const activeLabel = account?.id ?? transaction?.id
  const related = node && !account ? [...new Set(graph.edges.filter((item) => item.target === node.id).map((item) => item.source))] : []

  return <>
    <div className={`graph-grid network-grid ${compact ? 'network-compact' : ''}`}>
      <section className="panel graph-panel">
        <PanelTitle title={compact ? 'Карта связей' : 'Граф связей'} detail={cluster ? `${cluster.id} · ${num(cluster.members.length)} счетов · ${num(cluster.devices.length)} устройства` : 'Счета и общая точка доступа'} aside={!compact && <div className="segmented" aria-label="Представление графа">
          <button aria-pressed={mode === 'focus'} onClick={() => selectMode('focus')}>Фокус</button>
          <button aria-pressed={mode === 'all'} onClick={() => selectMode('all')}>Вся сеть</button>
        </div>} />
        <div className="graph-stage">
          {cluster && <div className="graph-layers segmented" aria-label="Слой графа">
            {([['all', 'Все связи'], ['device', 'Устройства'], ['transfer', 'Переводы']] as const).map(([id, label]) =>
              <button key={id} aria-pressed={layer === id} onClick={() => { setSelection(''); setLayer(id) }}>{label}</button>)}
          </div>}
          <div className="graph-canvas" ref={container} aria-label="Интерактивный граф счетов, устройств и переводов" />
          <div className="graph-controls">
            <button className="icon-btn" onClick={() => zoom(1.24)} aria-label="Приблизить"><Plus size={17} /></button>
            <button className="icon-btn" onClick={() => zoom(0.8)} aria-label="Отдалить"><Minus size={17} /></button>
            <button className="icon-btn" onClick={() => cy.current?.fit(undefined, 45)} aria-label="Вписать граф"><Maximize2 size={15} /></button>
          </div>
        </div>
        <div className="graph-legend">
          <span><i className="legend-point neutral" />Счёт</span><span><i className="legend-point alert" />Счёт в кластере</span>
          <span><Fingerprint size={15} />Устройство</span><span><Router size={15} />Общий IP</span>
        </div>
      </section>
      <section className="panel graph-inspector">
        <PanelTitle title={cluster ? 'Почему сработал сигнал' : 'Общий IP и риск'} aside={<Crosshair size={18} className="muted" />} />
        {snapshot.clusters.length > 1 && <label>Кластер<select value={clusterId} onChange={(event) => { setClusterId(event.target.value); setSelection('') }}>
          {snapshot.clusters.map(({ id }) => <option key={id}>{id}</option>)}
        </select></label>}
        {activeRisk ? <><h3 className="mono inspector-id">{activeLabel}</h3><RiskSummary risk={activeRisk} /></> :
          node ? <><h3 className="mono inspector-id">{node.label}</h3><p className="muted">Связанные счета</p><div className="chips">{related.map((id) => <button className="chip" onClick={() => select(id)} key={id}>{id}</button>)}</div></> :
          cluster ? <><div className="cluster-identity"><span className="mono">{cluster.id}</span><RiskBadge level={cluster.risk.level} /></div>
            <div className="cluster-score"><strong>{cluster.risk.score}</strong><span>/ 100<br/>балл риска</span></div>
            <Evidence risk={compact ? { ...cluster.risk, reasons: cluster.risk.reasons.filter(({ points }) => points > 0) } : cluster.risk} compact={compact} />
          </> : sharedIp ? <div className="safe-evidence">
            <ShieldCheck size={25} /><h3>Общий IP даёт 0 баллов</h3>
            <p>Счета на одном IP: <strong>{sharedAccounts}</strong>. В этом сценарии подтверждённых кластеров нет.</p>
            <span className="mono">{sharedIp.label}</span>
          </div> : <Empty>В этом сценарии подтверждённых кластеров нет.</Empty>}
        {(!compact || guided) && <label className="inspect-select">Выбрать узел<select value={node?.id ?? ''} onChange={(event) => select(event.target.value)}>
          <option value="">Вся карта</option>{graph.nodes.map((item: GraphNode) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>}
        {compact && !guided && <a className="button secondary wide graph-open" href="#/network">Разобрать связи<ArrowUpRight size={16} /></a>}
      </section>
    </div>
    {!compact && cluster && <section className="panel link-panel">
      <PanelTitle title="Доказательства по парам" detail="Отпечаток устройства подтверждён финансовой связью" aside={<Network size={19} className="muted" />} />
      <div className="table-scroll"><table><thead><tr><th>Пара счетов</th><th>Независимые признаки</th><th>События</th></tr></thead>
        <tbody>{cluster.links.slice(0, 12).map((link) => <tr key={`${link.a}/${link.b}`}>
          <td className="mono">{link.a} · {link.b}</td><td>{link.signals.map(({ ru }) => ru).join(' · ')}</td>
          <td className="mono muted">{new Set(link.signals.flatMap(({ refs }) => refs)).size}</td>
        </tr>)}</tbody></table></div>
    </section>}
  </>
}

