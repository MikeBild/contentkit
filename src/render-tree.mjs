import { escapeXml } from './utils.mjs'

const finite = (value) => Number.isFinite(Number(value))

function validateNode(node, path = 'root') {
  if (!node || typeof node !== 'object') throw new Error(`render tree ${path} must be an object`)
  if (!['svg', 'layer', 'adapter', 'markup'].includes(node.type)) {
    throw new Error(`render tree ${path} has unknown type ${node.type}`)
  }
  if (node.box) {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!finite(node.box[key]) || Number(node.box[key]) < (key === 'width' || key === 'height' ? 0 : -100000)) {
        throw new Error(`render tree ${path} has invalid box.${key}`)
      }
    }
  }
  for (const [index, child] of (node.children || []).entries()) validateNode(child, `${path}.children[${index}]`)
}

export function createCompositionRenderTree({
  width,
  height,
  title,
  description,
  metadata,
  definitions,
  background,
  layers,
}) {
  const tree = {
    schema_version: '1',
    type: 'svg',
    box: { x: 0, y: 0, width, height },
    accessibility: { role: 'img', title, description },
    metadata,
    definitions,
    background,
    children: layers,
  }
  validateNode(tree)
  return tree
}

export function publicRenderTree(tree) {
  const project = (node) => ({
    type: node.type === 'markup' ? 'adapter' : node.type,
    ...(node.id ? { id: node.id } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.adapter ? { adapter: node.adapter } : {}),
    ...(node.box ? { box: node.box } : {}),
    ...(node.source_node_ids ? { source_node_ids: node.source_node_ids } : {}),
    ...((node.children || []).length ? { children: node.children.map(project) } : {}),
  })
  return {
    schema_version: tree.schema_version,
    ...project(tree),
    accessibility: tree.accessibility,
  }
}

export function serializeCompositionRenderTree(tree) {
  validateNode(tree)
  const { width, height } = tree.box
  const markup = (tree.children || []).map((node) => node.markup || '').join('')
  const metadata = escapeXml(JSON.stringify(tree.metadata))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="composition-title composition-description"><title id="composition-title">${escapeXml(tree.accessibility.title)}</title><desc id="composition-description">${escapeXml(tree.accessibility.description)}</desc><metadata>${metadata}</metadata><defs>${tree.definitions}</defs><rect width="${width}" height="${height}" fill="${escapeXml(tree.background)}"/>${markup}</svg>`
}
