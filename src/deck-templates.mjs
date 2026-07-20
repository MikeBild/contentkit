import { createHash } from 'node:crypto'

export const DECK_TEMPLATE_SCHEMA_VERSION = '1'

const template = ({ id, title, description, audience, slots, required = slots, defaults = {}, visual_contract }) => ({
  schema_version: DECK_TEMPLATE_SCHEMA_VERSION,
  id,
  title,
  description,
  audience,
  narrative_slots: slots,
  required_slots: required,
  defaults: {
    theme: 'editorial',
    opening_layout: 'cover',
    max_slides: Math.max(slots.length + 4, 12),
    ...defaults,
  },
  visual_contract: {
    max_primary_visuals_per_slide: 1,
    evidence_before_conclusion: true,
    sources_last: true,
    ...visual_contract,
  },
})

export const deckTemplateRegistry = Object.freeze([
  template({
    id: 'freeform',
    title: 'Freeform deck',
    description: 'Backward-compatible authored slide order without a prescribed narrative sequence.',
    audience: 'Authors migrating an existing presentation or intentionally designing a custom sequence.',
    slots: [],
    required: [],
    defaults: { theme: 'neutral', opening_layout: 'cover', max_slides: 120 },
    visual_contract: { evidence_before_conclusion: false, sources_last: false },
  }),
  template({
    id: 'editorial-story',
    title: 'Editorial story',
    description:
      'A reader-led argument that moves from a question through evidence and interpretation to a bounded conclusion.',
    audience: 'Editorial, research and thought-leadership presentations.',
    slots: ['opening', 'question', 'context', 'evidence', 'interpretation', 'conclusion', 'action', 'sources'],
    required: ['opening', 'question', 'evidence', 'interpretation', 'conclusion', 'sources'],
  }),
  template({
    id: 'decision-brief',
    title: 'Decision brief',
    description:
      'A concise decision path from operating context and options to a supported recommendation and next action.',
    audience: 'Executive, product and architecture decision makers.',
    slots: ['opening', 'decision-question', 'context', 'evidence', 'options', 'recommendation', 'action', 'sources'],
    required: ['opening', 'decision-question', 'evidence', 'options', 'recommendation', 'action', 'sources'],
  }),
  template({
    id: 'technical-explainer',
    title: 'Technical explainer',
    description:
      'A product or system story that establishes the problem, explains the model, proves the delivery path and closes with the outcome.',
    audience: 'Technical readers who need a coherent model, operational evidence and a clear conclusion.',
    slots: [
      'opening',
      'problem',
      'premise',
      'architecture',
      'semantics',
      'journey',
      'design-system',
      'verification',
      'operations',
      'outcome',
      'conclusion',
      'sources',
    ],
    required: [
      'opening',
      'problem',
      'premise',
      'architecture',
      'semantics',
      'journey',
      'design-system',
      'verification',
      'operations',
      'outcome',
      'conclusion',
      'sources',
    ],
    defaults: { max_slides: 16 },
  }),
  template({
    id: 'status-report',
    title: 'Status report',
    description: 'A time-bounded operating report that separates current state, evidence, risk and action.',
    audience: 'Operators, stakeholders and leadership teams reviewing a reporting period.',
    slots: ['opening', 'period', 'current-state', 'evidence', 'risk', 'forecast', 'action', 'sources'],
    required: ['opening', 'period', 'current-state', 'evidence', 'risk', 'action', 'sources'],
  }),
])

export const DECK_TEMPLATES = Object.freeze(deckTemplateRegistry.map((entry) => entry.id))
export const deckTemplateRegistryHash = createHash('sha256').update(JSON.stringify(deckTemplateRegistry)).digest('hex')

export function getDeckTemplate(id) {
  return deckTemplateRegistry.find((entry) => entry.id === id) || null
}

export function validateDeckTemplate(templateDefinition, slides) {
  if (!templateDefinition || templateDefinition.id === 'freeform') return []
  const diagnostics = []
  const known = new Set(templateDefinition.narrative_slots)
  const explicit = slides.filter((slide) => slide.role_source === 'authored')

  for (const slide of slides) {
    if (slide.role_source !== 'authored' && !['opening', 'sources'].includes(slide.role)) {
      diagnostics.push({
        code: 'deck.template.role-required',
        severity: 'error',
        slide_id: slide.id,
        message: `Template ${templateDefinition.id} requires an explicit deckRole for this slide.`,
      })
    }
    if (!known.has(slide.role)) {
      diagnostics.push({
        code: 'deck.template.role-unsupported',
        severity: 'error',
        slide_id: slide.id,
        role: slide.role,
        message: `Role ${slide.role} is not a narrative slot in template ${templateDefinition.id}.`,
      })
    }
  }

  const roles = slides.map((slide) => slide.role)
  for (const required of templateDefinition.required_slots) {
    if (!roles.includes(required)) {
      diagnostics.push({
        code: 'deck.template.slot-missing',
        severity: 'error',
        role: required,
        message: `Template ${templateDefinition.id} requires the ${required} narrative slot.`,
      })
    }
  }

  const ordered = explicit
    .map((slide) => ({ slide, position: templateDefinition.narrative_slots.indexOf(slide.role) }))
    .filter((entry) => entry.position >= 0)
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].position < ordered[index - 1].position) {
      diagnostics.push({
        code: 'deck.template.order-invalid',
        severity: 'error',
        slide_id: ordered[index].slide.id,
        role: ordered[index].slide.role,
        after_role: ordered[index - 1].slide.role,
        message: `Role ${ordered[index].slide.role} appears after ${ordered[index - 1].slide.role}, contrary to template ${templateDefinition.id}.`,
      })
    }
  }

  const sources = slides.findIndex((slide) => slide.role === 'sources')
  if (templateDefinition.visual_contract.sources_last && sources >= 0 && sources !== slides.length - 1) {
    diagnostics.push({
      code: 'deck.template.sources-not-last',
      severity: 'error',
      slide_id: slides[sources].id,
      message: `Template ${templateDefinition.id} requires the sources slide to be last.`,
    })
  }
  return diagnostics
}
