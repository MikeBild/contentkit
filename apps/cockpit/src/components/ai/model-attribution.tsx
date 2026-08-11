import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'

/**
 * Where model output says it is model output — CUI-AI-1 and CUI-AI-2.
 *
 * Two rules, one component, because they fail together.
 *
 * CUI-AI-1: a model's claim is not a measurement, and never renders in a token
 * that means "healthy" or "confirmed". The assistant's answers are the one
 * thing in this console nobody measured — every other number on screen came
 * from a count of rows or a duration — so the model identity wears the outline
 * variant: visibly present, visibly not a reading.
 *
 * CUI-AI-2: model identity and generation time are shown WHEREVER model output
 * is. Not on a detail page, not behind a disclosure — beside the words
 * themselves, because that is where somebody decides whether to act on them.
 *
 * Neither was held here at all. The assistant page streams a model's prose and
 * attributed it to nobody — it could not, because the model is configuration
 * and the stream carries only text. `OPTIONS /v1/assistant/messages`, the probe
 * the console already makes to learn whether the assistant is enabled, now
 * answers with the model name too.
 *
 * The sibling console carries the same component over different surfaces: a
 * root-cause narrative and a judge's verdicts. Two implementations, one rule —
 * a model saying something is not the same kind of fact as a measurement, and
 * an operator should not have to learn that twice.
 */
export function ModelAttribution({
  model,
  generatedAt,
  className,
}: {
  model: string | null
  generatedAt?: string | null
  className?: string
}) {
  const { dateTime } = useI18n()
  // No model means no attribution, not an empty badge. A surface that shows an
  // attribution chip for output no model produced has invented a provenance.
  if (!model) return null

  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-testid="model-attribution">
      <Badge variant="outline" className="font-mono text-[10px]">
        {model}
      </Badge>
      {generatedAt ? (
        <span className="text-xs text-muted-foreground">{dateTime(generatedAt)}</span>
      ) : null}
    </span>
  )
}

/**
 * A confidence number with its scale said out loud — CUI-AI-2.
 *
 * "0.82" is not a fact until somebody says 0.82 of what. The two numbers this
 * console shows are different things and were rendered identically:
 *
 *   - a share of something counted is a MEASUREMENT, and its denominator is
 *     part of the claim: "90% of 5" and "90% of 5000" are not the same fact.
 *   - a model reporting on its own certainty is not a measurement at all, and
 *     must not borrow the first one's authority.
 *
 * So `of` is required when there is a denominator, and `selfReported` marks the
 * case where there is none and never will be. A bare colour-coded bar is
 * forbidden outright: it implies a scale it does not carry.
 */
export function Confidence({
  value,
  of,
  selfReported = false,
}: {
  value: number | null | undefined
  of?: number
  selfReported?: boolean
}) {
  const { t, number } = useI18n()
  // A confidence nobody reported is `—`, never 0. Zero confidence is a
  // measurement; absence is not, and the two must not read alike.
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const percent = Math.round(value * 100)
  return (
    <span className="text-xs text-muted-foreground" data-testid="confidence">
      {of === undefined ? (
        <>
          {number(percent)}%{selfReported ? ` — ${t('ai.selfEstimate')}` : ''}
        </>
      ) : (
        <>
          {t('ai.samples', { percent: number(percent), count: number(of) })}
        </>
      )}
    </span>
  )
}
