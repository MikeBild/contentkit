const visibleCount = (rendered) => {
  const nodes = rendered.semantic?.nodes || []
  const primary = nodes.find((node) => node.id === rendered.narrative?.primary_node) || nodes[0] || {}
  return (
    primary.questions?.length ||
    primary.variants?.length ||
    primary.plans?.length ||
    primary.figures?.length ||
    primary.rows?.length ||
    primary.regions?.length ||
    nodes.length
  )
}

function omitted(rendered, shown, frame, theme, ui) {
  const count = Math.max(0, visibleCount(rendered) - shown)
  if (!count) return ''
  return ui.text(`+${count} more available in full HTML and text`, frame.x + frame.width, frame.y + frame.height - 8, {
    size: 12,
    weight: 680,
    fill: theme.muted_foreground,
    width: Math.min(frame.width, 460),
    lines: 1,
    anchor: 'end',
  }).svg
}

function faq(rendered, pattern, items, frame, theme, ui) {
  const columns = pattern.id === 'faq-list' || frame.width < 500 ? 1 : 2
  const gap = frame.width < 500 ? 10 : 16
  const rows = Math.max(1, Math.ceil(items.length / columns))
  const reserve = visibleCount(rendered) > items.length ? 36 : 0
  const width = (frame.width - gap * (columns - 1)) / columns
  const height = (frame.height - reserve - gap * (rows - 1)) / rows
  const categories = new Map()
  return `<g>${items
    .map((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = frame.x + column * (width + gap)
      const y = frame.y + row * (height + gap)
      const category = item.category || 'General'
      if (!categories.has(category)) categories.set(category, categories.size)
      const color = theme[`chart_${(categories.get(category) % 5) + 1}`]
      const categoryLabel =
        pattern.id === 'faq-categorized'
          ? ui.text(category.toUpperCase(), x + 52, y + 25, {
              size: 10,
              weight: 760,
              fill: color,
              width: width - 100,
              lines: 1,
              tracking: 1,
            }).svg
          : ''
      const questionY = y + (pattern.id === 'faq-categorized' ? 60 : 58)
      const question = ui.text(item.title, x + 20, questionY, {
        size: Math.min(20, Math.max(15, height * 0.13)),
        weight: 730,
        fill: theme.foreground,
        width: width - 54,
        lines: 2,
      })
      const answerY = Math.min(y + height - 22, questionY + question.height + 22)
      return `<g>${ui.rect(x, y + 1, width, height - 1, {
        fill: theme.surface,
        stroke: theme.border,
        radius: 12,
        filter: 'url(#ck-card-shadow)',
      })}${ui.rect(x + 1, y + 2, 4, height - 3, { fill: color, radius: 2 })}${ui.circle(x + width - 28, y + 29, 13, { fill: theme.muted, stroke: theme.border })}<path d="M ${x + width - 33} ${y + 29} H ${x + width - 23}" stroke="${theme.foreground}" stroke-width="1.5"/><path d="M ${x + width - 28} ${y + 24} V ${y + 34}" stroke="${theme.foreground}" stroke-width="1.5"/>${categoryLabel}${ui.text(String(index + 1).padStart(2, '0'), x + 20, y + 24, { size: 9, weight: 760, fill: theme.muted_foreground, width: 28, lines: 1, tracking: 0.7 }).svg}${question.svg}${
        ui.text(item.body, x + 20, answerY, {
          size: 13,
          weight: 450,
          fill: theme.muted_foreground,
          width: width - 40,
          lines: Math.max(1, Math.min(4, Math.floor((y + height - answerY - 10) / 22))),
          lineHeight: 1.28,
        }).svg
      }</g>`
    })
    .join('')}${omitted(rendered, items.length, frame, theme, ui)}</g>`
}

function codeExample(rendered, pattern, items, frame, theme, ui) {
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.active),
  )
  const active = items[activeIndex] || items[0] || { title: 'Code', code: '', language: 'text' }
  const rail = pattern.id === 'file-code' && frame.width >= 500 ? Math.min(240, frame.width * 0.26) : 0
  const tabHeight = 54
  const surfaceX = frame.x + rail
  const surfaceW = frame.width - rail
  const header = ui.rect(frame.x, frame.y, frame.width, tabHeight, {
    fill: theme.muted,
    stroke: theme.border,
    radius: 14,
  })
  const tabs = items
    .map((item, index) => {
      const tabW = Math.min(180, frame.width / Math.max(1, items.length))
      const x = frame.x + index * tabW
      return `<g>${index === activeIndex ? ui.rect(x + 6, frame.y + 8, tabW - 12, 38, { fill: theme.surface, stroke: theme.border, radius: 9 }) : ''}${
        ui.text(item.title, x + tabW / 2, frame.y + 33, {
          size: 12,
          weight: index === activeIndex ? 740 : 560,
          fill: index === activeIndex ? theme.foreground : theme.muted_foreground,
          width: tabW - 20,
          lines: 1,
          anchor: 'middle',
        }).svg
      }</g>`
    })
    .join('')
  const bodyY = frame.y + tabHeight + 12
  const bodyH = frame.height - tabHeight - 12
  const fileRail =
    rail > 0
      ? `<g>${ui.rect(frame.x, bodyY, rail - 12, bodyH, {
          fill: theme.surface,
          stroke: theme.border,
          radius: 12,
        })}${items
          .map(
            (item, index) =>
              ui.text(item.file || item.title, frame.x + 18, bodyY + 34 + index * 42, {
                size: 12,
                weight: index === activeIndex ? 720 : 500,
                fill: index === activeIndex ? theme.foreground : theme.muted_foreground,
                width: rail - 44,
                lines: 1,
              }).svg,
          )
          .join('')}</g>`
      : ''
  const codeLines = String(active.code || '')
    .split(/\r?\n/)
    .slice(0, Math.max(4, Math.min(14, Math.floor((bodyH - 70) / 27))))
  const codeSurface = `<g>${ui.rect(surfaceX, bodyY, surfaceW, bodyH, {
    fill: theme.foreground,
    stroke: theme.border,
    radius: 14,
  })}${
    ui.text((active.file || active.language || 'text').toUpperCase(), surfaceX + 22, bodyY + 31, {
      size: 10,
      weight: 760,
      fill: theme.border,
      width: surfaceW - 44,
      lines: 1,
      tracking: 1,
    }).svg
  }${codeLines
    .map(
      (line, index) =>
        `<g><text x="${surfaceX + 22}" y="${bodyY + 70 + index * 27}" font-size="12" font-weight="600" fill="${theme.chart_1}">${String(index + 1).padStart(2, '0')}</text>${
          ui.text(line || ' ', surfaceX + 62, bodyY + 70 + index * 27, {
            size: 12,
            weight: 500,
            fill: theme.primary_foreground,
            width: surfaceW - 86,
            lines: 1,
          }).svg
        }</g>`,
    )
    .join('')}</g>`
  if (pattern.id === 'code-walkthrough' && items.length > 1) {
    const gap = 12
    const h = (frame.height - gap * (items.length - 1)) / items.length
    return `<g>${items
      .map((item, index) => {
        const y = frame.y + index * (h + gap)
        const lines = String(item.code || '')
          .split(/\r?\n/)
          .slice(0, Math.max(1, Math.floor((h - 55) / 25)))
        return `<g>${ui.rect(frame.x, y, frame.width, h, {
          fill: theme.foreground,
          stroke: index === activeIndex ? theme.chart_1 : theme.border,
          strokeWidth: index === activeIndex ? 2 : 1,
          radius: 12,
        })}${
          ui.text(`${item.title} · ${item.language}`, frame.x + 20, y + 31, {
            size: 12,
            weight: 730,
            fill: theme.border,
            width: frame.width - 40,
            lines: 1,
          }).svg
        }${lines
          .map(
            (line, lineIndex) =>
              ui.text(line || ' ', frame.x + 20, y + 65 + lineIndex * 25, {
                size: 12,
                weight: 500,
                fill: theme.primary_foreground,
                width: frame.width - 40,
                lines: 1,
              }).svg,
          )
          .join('')}</g>`
      })
      .join('')}${omitted(rendered, items.length, frame, theme, ui)}</g>`
  }
  return `<g>${header}${tabs}${fileRail}${codeSurface}${omitted(rendered, items.length, frame, theme, ui)}</g>`
}

function pricing(rendered, pattern, items, frame, theme, ui) {
  const compact = frame.width < 500
  if (pattern.id === 'pricing-comparison' && !compact) {
    const features = [...new Set(items.flatMap((item) => (item.points || []).map((point) => point.label)))].slice(0, 7)
    const labelW = frame.width * 0.28
    const headH = 110
    const rowH = (frame.height - headH) / Math.max(1, features.length)
    const colW = (frame.width - labelW) / Math.max(1, items.length)
    return `<g>${ui.rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 14 })}${items
      .map((item, index) => {
        const x = frame.x + labelW + index * colW
        return `<g>${item.recommended ? ui.rect(x + 5, frame.y + 5, colW - 10, headH - 10, { fill: theme.accent_soft, stroke: theme.chart_1, strokeWidth: 1.5, radius: 10 }) : ''}${ui.text(item.title, x + colW / 2, frame.y + 35, { size: 15, weight: 720, fill: theme.foreground, width: colW - 24, lines: 1, anchor: 'middle' }).svg}${ui.text(`${item.currency} ${item.value}`, x + colW / 2, frame.y + 76, { size: 22, weight: 790, fill: theme.foreground, width: colW - 24, lines: 1, anchor: 'middle' }).svg}</g>`
      })
      .join('')}${features
      .map((feature, row) => {
        const y = frame.y + headH + row * rowH
        return `<g>${ui.line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 })}${ui.text(feature, frame.x + 18, y + rowH / 2 + 6, { size: 12, weight: 600, fill: theme.foreground, width: labelW - 32, lines: 2 }).svg}${items
          .map((item, index) => {
            const included = (item.points || []).some((point) => point.label === feature)
            const x = frame.x + labelW + colW * index + colW / 2
            return `<text x="${x}" y="${y + rowH / 2 + 7}" text-anchor="middle" font-size="15" font-weight="800" fill="${included ? theme.chart_2 : theme.muted_foreground}">${included ? '✓' : '—'}</text>`
          })
          .join('')}</g>`
      })
      .join('')}</g>`
  }
  const columns = compact || pattern.id === 'pricing-spotlight' ? 1 : Math.min(items.length, 4)
  const gap = 14
  const rows = Math.ceil(items.length / columns)
  const w = (frame.width - gap * (columns - 1)) / columns
  const h = (frame.height - gap * (rows - 1)) / rows
  return `<g>${items
    .map((item, index) => {
      const x = frame.x + (index % columns) * (w + gap)
      const y = frame.y + Math.floor(index / columns) * (h + gap)
      const active = item.recommended || (pattern.id === 'pricing-spotlight' && index === 0)
      const short = h < 280
      const points = (item.points || []).slice(
        0,
        short
          ? Math.max(0, Math.min(2, Math.floor((h - 116) / 28)))
          : Math.max(2, Math.min(6, Math.floor((h - 150) / 35))),
      )
      if (short) {
        return `<g>${ui.rect(x, y, w, h, {
          fill: theme.surface,
          stroke: active ? theme.chart_1 : theme.border,
          strokeWidth: active ? 1.5 : 1,
          radius: 12,
          filter: 'url(#ck-card-shadow)',
        })}${active ? ui.rect(x + 1, y + 1, 4, h - 2, { fill: theme.chart_1, radius: 2 }) : ''}${ui.text(item.title, x + 20, y + 31, { size: 17, weight: 730, fill: theme.foreground, width: w - 40, lines: 1 }).svg}${ui.text(`${item.currency} ${item.value}`, x + 20, y + 70, { size: Math.min(28, w / 6), weight: 790, fill: theme.foreground, width: w - 40, lines: 1 }).svg}${ui.text(`per ${item.cadence}`, x + 20, y + 99, { size: 10, weight: 560, fill: theme.muted_foreground, width: w - 40, lines: 1 }).svg}${points
          .map(
            (point, pointIndex) =>
              `<g>${ui.circle(x + 25, y + 126 + pointIndex * 27, 7, { fill: theme.success_soft, stroke: theme.chart_2 })}<path d="M ${x + 21} ${y + 126 + pointIndex * 27} l3 3 5 -6" fill="none" stroke="${theme.chart_2}" stroke-width="1.5"/>${ui.text(point.label, x + 40, y + 131 + pointIndex * 27, { size: 11, weight: 500, fill: theme.foreground, width: w - 58, lines: 1 }).svg}</g>`,
          )
          .join('')}</g>`
      }
      return `<g>${ui.rect(x, y, w, h, {
        fill: theme.surface,
        stroke: active ? theme.chart_1 : theme.border,
        strokeWidth: active ? 1.5 : 1,
        radius: 12,
        filter: 'url(#ck-card-shadow)',
      })}${active ? `${ui.rect(x + 14, y + 14, Math.min(170, w - 28), 27, { fill: theme.accent_soft, stroke: theme.chart_1, radius: 13 })}${ui.text('RECOMMENDED', x + 28, y + 32, { size: 9, weight: 780, fill: theme.chart_1, width: Math.min(142, w - 56), lines: 1, tracking: 1 }).svg}` : ''}${ui.text(item.title, x + 20, y + (active ? 72 : 39), { size: 18, weight: 730, fill: theme.foreground, width: w - 40, lines: 1 }).svg}${ui.text(`${item.currency} ${item.value}`, x + 20, y + (active ? 118 : 86), { size: Math.min(34, w / 5), weight: 790, fill: theme.foreground, width: w - 40, lines: 1 }).svg}${ui.text(`per ${item.cadence}`, x + 20, y + (active ? 145 : 113), { size: 11, weight: 560, fill: theme.muted_foreground, width: w - 40, lines: 1 }).svg}${ui.line(x + 20, y + (active ? 164 : 132), x + w - 20, y + (active ? 164 : 132), { stroke: theme.border, width: 1 })}${points
        .map(
          (point, pointIndex) =>
            `<g>${ui.circle(x + 27, y + (active ? 194 : 162) + pointIndex * 35, 8, { fill: theme.success_soft, stroke: theme.chart_2 })}<path d="M ${x + 23} ${y + (active ? 194 : 162) + pointIndex * 35} l3 3 5 -6" fill="none" stroke="${theme.chart_2}" stroke-width="1.5"/>${ui.text(point.label, x + 44, y + (active ? 199 : 167) + pointIndex * 35, { size: 12, weight: 500, fill: theme.foreground, width: w - 62, lines: 1 }).svg}</g>`,
        )
        .join(
          '',
        )}${h > 360 ? `${ui.rect(x + 20, y + h - 54, w - 40, 36, { fill: active ? theme.foreground : theme.muted, stroke: active ? theme.foreground : theme.border, radius: 8 })}${ui.text(active ? 'Choose plan' : 'Learn more', x + w / 2, y + h - 31, { size: 11, weight: 700, fill: active ? theme.primary_foreground : theme.foreground, width: w - 64, lines: 1, anchor: 'middle' }).svg}` : ''}</g>`
    })
    .join('')}</g>`
}

function gallery(rendered, pattern, items, frame, theme, ui) {
  const compact = frame.width < 500
  const editorial = pattern.id === 'editorial-gallery' && !compact && items.length >= 3
  const gap = 14
  const boxes = []
  if (editorial) {
    const leadW = frame.width * 0.62
    boxes.push({ x: frame.x, y: frame.y, width: leadW, height: frame.height })
    const sideW = frame.width - leadW - gap
    const sideH = (frame.height - gap * (items.length - 2)) / (items.length - 1)
    items.slice(1).forEach((_, index) =>
      boxes.push({
        x: frame.x + leadW + gap,
        y: frame.y + index * (sideH + gap),
        width: sideW,
        height: sideH,
      }),
    )
  } else {
    const columns = compact || pattern.id === 'captioned-gallery' ? 1 : Math.min(3, Math.ceil(Math.sqrt(items.length)))
    const rows = Math.ceil(items.length / columns)
    const w = (frame.width - gap * (columns - 1)) / columns
    const h = (frame.height - gap * (rows - 1)) / rows
    items.forEach((_, index) =>
      boxes.push({
        x: frame.x + (index % columns) * (w + gap),
        y: frame.y + Math.floor(index / columns) * (h + gap),
        width: w,
        height: h,
      }),
    )
  }
  return `<g>${items
    .map((item, index) => {
      const box = boxes[index]
      const captionH = Math.min(72, Math.max(48, box.height * 0.25))
      const imageH = box.height - captionH
      const accent = theme[`chart_${(index % 5) + 1}`]
      return `<g>${ui.rect(box.x, box.y, box.width, box.height, { fill: theme.surface, stroke: theme.border, radius: 14 })}${ui.rect(box.x + 1, box.y + 1, box.width - 2, imageH, { fill: theme.muted, radius: 13 })}<path d="M ${box.x + box.width * 0.16} ${box.y + imageH * 0.78} L ${box.x + box.width * 0.42} ${box.y + imageH * 0.42} L ${box.x + box.width * 0.6} ${box.y + imageH * 0.63} L ${box.x + box.width * 0.82} ${box.y + imageH * 0.3}" fill="none" stroke="${accent}" stroke-width="4"/>${ui.circle(box.x + box.width * 0.72, box.y + imageH * 0.27, Math.min(18, box.width * 0.06), { fill: accent })}${ui.text(item.title, box.x + 16, box.y + imageH + 27, { size: 12, weight: 680, fill: theme.foreground, width: box.width - 32, lines: 2 }).svg}</g>`
    })
    .join('')}${omitted(rendered, items.length, frame, theme, ui)}</g>`
}

function dataTable(rendered, pattern, items, frame, theme, ui) {
  const primary =
    rendered.semantic.nodes.find((node) => node.id === rendered.narrative?.primary_node) || rendered.semantic.nodes[0]
  const compact = frame.width < 500 || pattern.id === 'record-cards'
  if (compact) {
    const gap = 10
    const reserve = visibleCount(rendered) > items.length ? 34 : 0
    const h = (frame.height - reserve - gap * (items.length - 1)) / Math.max(1, items.length)
    return `<g>${items
      .map((item, index) => {
        const y = frame.y + index * (h + gap)
        const allFields = (item.fields || []).filter((field) => field.label !== primary.row_key)
        if (frame.width >= 700) {
          const fields = allFields.slice(0, 4)
          const titleW = frame.width * 0.24
          const fieldW = (frame.width - titleW - 36) / Math.max(1, fields.length)
          return `<g>${ui.rect(frame.x, y, frame.width, h, { fill: theme.surface, stroke: theme.border, radius: 10, filter: 'url(#ck-card-shadow)' })}${ui.text(item.title, frame.x + 18, y + h / 2 + 7, { size: 15, weight: 730, fill: theme.foreground, width: titleW - 26, lines: 2 }).svg}${fields
            .map((field, fieldIndex) => {
              const x = frame.x + titleW + fieldIndex * fieldW
              const status = /status|state/i.test(field.label)
              return `<g>${ui.text(field.label, x, y + h * 0.38, { size: 11, weight: 620, fill: theme.muted_foreground, width: fieldW - 16, lines: 1 }).svg}${status ? ui.circle(x + 5, y + h * 0.68 - 4, 4, { fill: /error|failed|down/i.test(field.value) ? theme.chart_5 : /monitor|warning|review/i.test(field.value) ? theme.chart_3 : theme.chart_2 }) : ''}${ui.text(field.value, x + (status ? 16 : 0), y + h * 0.7, { size: 12, weight: 680, fill: theme.foreground, width: fieldW - 16 - (status ? 16 : 0), lines: 1 }).svg}</g>`
            })
            .join('')}</g>`
        }
        const fields = allFields.slice(0, Math.max(1, Math.min(2, Math.floor((h - 60) / 30))))
        return `<g>${ui.rect(frame.x, y, frame.width, h, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.text(item.title, frame.x + 18, y + 31, { size: 15, weight: 730, fill: theme.foreground, width: frame.width - 36, lines: 1 }).svg}${fields
          .map((field, fieldIndex) => {
            const fieldY = y + 62 + fieldIndex * Math.max(27, (h - 72) / Math.max(1, fields.length))
            return `<g>${ui.text(field.label, frame.x + 18, fieldY, { size: 11, weight: 620, fill: theme.muted_foreground, width: frame.width * 0.38, lines: 1 }).svg}${ui.text(field.value, frame.x + frame.width - 18, fieldY, { size: 11, weight: 680, fill: theme.foreground, width: frame.width * 0.52, lines: 1, anchor: 'end' }).svg}</g>`
          })
          .join('')}</g>`
      })
      .join('')}${omitted(rendered, items.length, frame, theme, ui)}</g>`
  }
  const headers = primary.headers.slice(0, 8)
  const rows = primary.rows.slice(0, items.length)
  const headH = 58
  const rowH = (frame.height - headH - (visibleCount(rendered) > items.length ? 34 : 0)) / Math.max(1, rows.length)
  const colW = frame.width / headers.length
  return `<g>${ui.rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.surface, stroke: theme.border, radius: 14 })}${ui.rect(frame.x, frame.y, frame.width, headH, { fill: theme.muted, radius: 14 })}${headers
    .map(
      (header, index) =>
        ui.text(header, frame.x + index * colW + 14, frame.y + 35, {
          size: 11,
          weight: 740,
          fill: theme.foreground,
          width: colW - 28,
          lines: 1,
        }).svg,
    )
    .join('')}${rows
    .map((row, rowIndex) => {
      const y = frame.y + headH + rowIndex * rowH
      return `<g>${ui.line(frame.x, y, frame.x + frame.width, y, { stroke: theme.border, width: 1 })}${row
        .slice(0, headers.length)
        .map(
          (value, columnIndex) =>
            ui.text(value, frame.x + columnIndex * colW + 14, y + rowH / 2 + 6, {
              size: 11,
              weight: columnIndex === 0 ? 680 : 500,
              fill: columnIndex === 0 ? theme.foreground : theme.muted_foreground,
              width: colW - 28,
              lines: 2,
            }).svg,
        )
        .join('')}</g>`
    })
    .join('')}${omitted(rendered, items.length, frame, theme, ui)}</g>`
}

function stats(pattern, items, frame, theme, ui) {
  if (pattern.id === 'stat-timeline') {
    const vertical = frame.width < 500
    const count = Math.max(1, items.length)
    if (vertical) {
      const step = frame.height / count
      return `<g>${ui.line(frame.x + 22, frame.y + 18, frame.x + 22, frame.y + frame.height - 18, { stroke: theme.border, width: 3 })}${items
        .map((item, index) => {
          const y = frame.y + step * index + step / 2
          return `<g>${ui.circle(frame.x + 22, y, 8, { fill: theme.chart_1, stroke: theme.background, strokeWidth: 3 })}${ui.text(item.period || item.body, frame.x + 50, y - 13, { size: 11, weight: 650, fill: theme.muted_foreground, width: frame.width - 66, lines: 1 }).svg}${ui.text(item.title, frame.x + 50, y + 22, { size: 22, weight: 780, fill: theme.foreground, width: frame.width - 66, lines: 1 }).svg}</g>`
        })
        .join('')}</g>`
    }
  }
  if (pattern.id === 'featured-stat') {
    const lead = items[0] || { title: '—', body: '' }
    const supporting = items.slice(1, 5)
    const leadH = frame.height * (supporting.length ? 0.55 : 1)
    return `<g>${ui.rect(frame.x, frame.y, frame.width, leadH, { fill: theme.surface, stroke: theme.chart_1, strokeWidth: 1.5, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.rect(frame.x + 22, frame.y + 22, 84, 26, { fill: theme.accent_soft, radius: 13 })}${ui.text('HIGHLIGHT', frame.x + 34, frame.y + 40, { size: 9, weight: 760, fill: theme.chart_1, width: 62, lines: 1, tracking: 0.65 }).svg}${ui.text(lead.body || lead.label, frame.x + 28, frame.y + 82, { size: 12, weight: 670, fill: theme.muted_foreground, width: frame.width - 56, lines: 2 }).svg}${ui.text(lead.title, frame.x + 28, frame.y + leadH * 0.66, { size: Math.min(72, frame.width / 7), weight: 790, fill: theme.foreground, width: frame.width - 56, lines: 1 }).svg}${supporting.length ? ui.line(frame.x, frame.y + leadH + 16, frame.x + frame.width, frame.y + leadH + 16, { stroke: theme.border, width: 1 }) : ''}${supporting
      .map((item, index) => {
        const w = frame.width / supporting.length
        return `<g>${ui.text(item.title, frame.x + index * w, frame.y + leadH + 70, { size: 22, weight: 760, fill: theme.foreground, width: w - 20, lines: 1 }).svg}${ui.text(item.body, frame.x + index * w, frame.y + leadH + 106, { size: 11, weight: 540, fill: theme.muted_foreground, width: w - 20, lines: 2 }).svg}</g>`
      })
      .join('')}</g>`
  }
  const columns = frame.width < 500 ? 1 : Math.min(4, items.length)
  const gap = 12
  const rows = Math.ceil(items.length / columns)
  const w = (frame.width - gap * (columns - 1)) / columns
  const h = (frame.height - gap * (rows - 1)) / rows
  return items
    .map((item, index) => {
      const x = frame.x + (index % columns) * (w + gap)
      const y = frame.y + Math.floor(index / columns) * (h + gap)
      const sparkY = y + h - 30
      const sparkX = x + 20
      const sparkW = w - 40
      const spark = [0.35, 0.52, 0.44, 0.7, 0.62, 0.84]
        .map((value, pointIndex) => `${sparkX + (sparkW * pointIndex) / 5},${sparkY - value * Math.min(34, h * 0.16)}`)
        .join(' ')
      return `<g>${ui.rect(x, y + 1, w, h - 1, { fill: theme.surface, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.circle(x + 28, y + 28, 10, { fill: theme.accent_soft, stroke: theme.chart_1 })}${ui.circle(x + 28, y + 28, 3, { fill: theme.chart_1 })}${ui.text(item.body || item.label, x + 46, y + 33, { size: 10, weight: 670, fill: theme.muted_foreground, width: w - 64, lines: 2 }).svg}${ui.text(item.title, x + 20, y + h * 0.57, { size: Math.min(38, w / 4), weight: 790, fill: theme.foreground, width: w - 40, lines: 1 }).svg}${h > 150 ? `<polyline points="${spark}" fill="none" stroke="${theme.chart_1}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</g>`
    })
    .join('')
}

function dashboard(rendered, items, frame, theme, ui) {
  const section = rendered.semantic.nodes.find((node) => node.type === 'dashboard-section')
  const metrics = rendered.semantic.nodes.filter((node) => node.type === 'metric').slice(0, 4)
  const chart = rendered.semantic.nodes.find((node) => node.type === 'chart')
  const compact = frame.width < 500
  const gap = compact ? 10 : 14
  const toolbarH = compact ? 48 : 54
  const metricColumns = compact ? 1 : Math.max(1, metrics.length)
  const metricRows = Math.max(1, Math.ceil(metrics.length / metricColumns))
  const metricH = compact ? Math.min(82, (frame.height - toolbarH - gap * 3) * 0.2) : Math.min(142, frame.height * 0.25)
  const metricAreaH = metrics.length ? metricRows * metricH + (metricRows - 1) * gap : 0
  const chartY = frame.y + toolbarH + gap + metricAreaH + (metrics.length ? gap : 0)
  const chartH = frame.y + frame.height - chartY
  const period = String(section?.description || metrics[0]?.period || '').trim()
  const periodW = period
    ? Math.min(compact ? frame.width * 0.42 : frame.width * 0.48, Math.max(84, period.length * 5.8 + 24))
    : 0
  const toolbarTitleW = Math.max(80, frame.width - 54 - (periodW ? periodW + 24 : 0))
  const toolbar = `<g>${ui.rect(frame.x, frame.y, frame.width, toolbarH, { fill: theme.surface, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.circle(frame.x + 22, frame.y + toolbarH / 2, 5, { fill: theme.chart_1 })}${ui.text(section?.title || 'Overview', frame.x + 38, frame.y + toolbarH / 2 + 6, { size: 14, weight: 720, fill: theme.foreground, width: toolbarTitleW, lines: 1 }).svg}${period ? `${ui.rect(frame.x + frame.width - periodW - 12, frame.y + 11, periodW, toolbarH - 22, { fill: theme.muted, stroke: theme.border, radius: 7 })}${ui.text(period, frame.x + frame.width - periodW / 2 - 12, frame.y + toolbarH / 2 + 5, { size: 10, weight: 670, fill: theme.foreground, width: periodW - 18, lines: 1, anchor: 'middle' }).svg}` : ''}</g>`
  const metricW = (frame.width - gap * (metricColumns - 1)) / metricColumns
  const cards = metrics
    .map((metric, index) => {
      const x = frame.x + (index % metricColumns) * (metricW + gap)
      const y = frame.y + toolbarH + gap + Math.floor(index / metricColumns) * (metricH + gap)
      const trend = metric.trend || (metric.target ? `Target ${metric.target}` : metric.period || '')
      const badgeWidth = Math.min(metricW * 0.48, Math.max(68, String(trend).length * 7 + 20))
      const shortMetric = metricH < 120
      const trendX = shortMetric ? x + metricW - badgeWidth - 16 : x + 16
      const trendY = shortMetric ? y + 12 : y + metricH - 34
      return `<g>${ui.rect(x, y, metricW, metricH, { fill: theme.surface, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.text(metric.label, x + 16, y + 28, { size: 10, weight: 670, fill: theme.muted_foreground, width: shortMetric ? metricW - badgeWidth - 52 : metricW - 32, lines: 1, tracking: 0.35 }).svg}${ui.text(metric.value, x + 16, y + (compact ? 60 : 72), { size: compact ? 23 : Math.min(32, metricW / 6), weight: 780, fill: theme.foreground, width: metricW - 32, lines: 1 }).svg}${trend ? `${ui.rect(trendX, trendY, badgeWidth, 22, { fill: String(trend).startsWith('-') ? theme.warning_soft : theme.success_soft, radius: 11 })}${ui.text(trend, trendX + 11, trendY + 15, { size: 9, weight: 700, fill: String(trend).startsWith('-') ? theme.chart_3 : theme.chart_2, width: badgeWidth - 18, lines: 1 }).svg}` : ''}</g>`
    })
    .join('')
  let chartMarkup = ''
  if (chartH > 70) {
    const rows = chart?.rows || []
    const seriesNames = (chart?.headers || []).slice(1, 6)
    const values = rows
      .flatMap((row) => row.slice(1, seriesNames.length + 1))
      .map(Number)
      .filter(Number.isFinite)
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 1
    const legendH = seriesNames.length > 1 ? 48 : 0
    const plot = {
      x: frame.x + (compact ? 38 : 54),
      y: chartY + 72 + legendH,
      width: frame.width - (compact ? 54 : 78),
      height: Math.max(28, chartH - 108 - legendH),
    }
    const pointX = (index) => plot.x + (index * plot.width) / Math.max(1, rows.length - 1)
    const pointY = (value) => plot.y + plot.height - ((Number(value) - min) / (max - min || 1)) * plot.height
    const grid = Array.from({ length: 4 }, (_, index) => {
      const y = plot.y + (index * plot.height) / 3
      return ui.line(plot.x, y, plot.x + plot.width, y, { stroke: theme.border, width: 1, dash: '3 7' })
    }).join('')
    const labels = rows
      .map((row, index) =>
        index === 0 || index === rows.length - 1
          ? ui.text(row[0], plot.x + (index * plot.width) / Math.max(1, rows.length - 1), plot.y + plot.height + 25, {
              size: 9,
              weight: 620,
              fill: theme.muted_foreground,
              width: 80,
              lines: 1,
              anchor: index === 0 ? 'start' : 'end',
            }).svg
          : '',
      )
      .join('')
    const legend =
      seriesNames.length > 1
        ? seriesNames
            .map((name, index) => {
              const cellW = plot.width / seriesNames.length
              const x = plot.x + index * cellW
              const stroke = theme[`chart_${(index % 5) + 1}`]
              return `<g>${ui.line(x, plot.y - 15, x + 16, plot.y - 15, { stroke, width: 3 })}${ui.text(name, x + 22, plot.y - 10, { size: 9, weight: 650, fill: theme.muted_foreground, width: cellW - 24, lines: 1 }).svg}</g>`
            })
            .join('')
        : ''
    const series = seriesNames
      .map((_, seriesIndex) => {
        const stroke = theme[`chart_${(seriesIndex % 5) + 1}`]
        const points = rows
          .map((row, rowIndex) =>
            Number.isFinite(Number(row[seriesIndex + 1]))
              ? `${pointX(rowIndex)},${pointY(row[seriesIndex + 1])}`
              : null,
          )
          .filter(Boolean)
        return points.length
          ? `<g><polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${rows.map((row, rowIndex) => (Number.isFinite(Number(row[seriesIndex + 1])) ? ui.circle(pointX(rowIndex), pointY(row[seriesIndex + 1]), 4, { fill: theme.surface, stroke, strokeWidth: 2 }) : '')).join('')}</g>`
          : ''
      })
      .join('')
    chartMarkup = `<g>${ui.rect(frame.x, chartY, frame.width, chartH, { fill: theme.surface, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.text(chart?.title || items.at(-1)?.title || 'Development', frame.x + 18, chartY + 30, { size: 14, weight: 720, fill: theme.foreground, width: frame.width - 36, lines: 1 }).svg}${ui.text(chart?.description || '', frame.x + 18, chartY + 52, { size: 10, weight: 480, fill: theme.muted_foreground, width: frame.width - 36, lines: 1 }).svg}${legend}${grid}${series}${labels}</g>`
  }
  return `<g>${toolbar}${cards}${chartMarkup}</g>`
}

function applicationShell(pattern, items, frame, theme, ui) {
  const byName = new Map(items.map((item) => [item.region, item]))
  const navigation = byName.get('navigation')
  const main = byName.get('main') || items[0]
  const secondary = byName.get('secondary')
  const toolbar = byName.get('toolbar')
  const compact = frame.width < 500 || pattern.id === 'topbar-shell'
  if (compact) {
    const topH = 66
    const mainY = frame.y + topH + 12
    const secondaryH = secondary ? Math.min(150, frame.height * 0.25) : 0
    const mainH = frame.height - topH - 12 - (secondary ? secondaryH + 12 : 0)
    return `<g>${ui.rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.subtle, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.rect(frame.x, frame.y, frame.width, topH, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.rect(frame.x + 16, frame.y + 18, 30, 30, { fill: theme.muted, stroke: theme.border, radius: 7 })}<path d="M ${frame.x + 24} ${frame.y + 28} H ${frame.x + 38} M ${frame.x + 24} ${frame.y + 34} H ${frame.x + 38} M ${frame.x + 24} ${frame.y + 40} H ${frame.x + 38}" stroke="${theme.foreground}" stroke-width="1.5"/>${ui.text(navigation?.title || toolbar?.title || 'Workspace', frame.x + 58, frame.y + 38, { size: 14, weight: 730, fill: theme.foreground, width: frame.width - 118, lines: 1 }).svg}${ui.circle(frame.x + frame.width - 28, frame.y + 33, 13, { fill: theme.accent_soft, stroke: theme.chart_1 })}${ui.text('CK', frame.x + frame.width - 28, frame.y + 37, { size: 8, weight: 780, fill: theme.chart_1, width: 20, lines: 1, anchor: 'middle' }).svg}${ui.rect(frame.x + 12, mainY, frame.width - 24, mainH, { fill: theme.surface, stroke: theme.border, radius: 10 })}${ui.text(main?.title || 'Main', frame.x + 30, mainY + 42, { size: 22, weight: 760, fill: theme.foreground, width: frame.width - 60, lines: 2 }).svg}${ui.text(main?.body || '', frame.x + 30, mainY + 96, { size: 12, weight: 480, fill: theme.muted_foreground, width: frame.width - 60, lines: 5 }).svg}${ui.line(frame.x + 30, mainY + mainH - 56, frame.x + frame.width - 30, mainY + mainH - 56, { stroke: theme.border, width: 1 })}${ui.rect(frame.x + 30, mainY + mainH - 40, Math.min(112, frame.width - 60), 26, { fill: theme.foreground, radius: 7 })}${ui.text('Open action', frame.x + 86, mainY + mainH - 22, { size: 9, weight: 700, fill: theme.primary_foreground, width: 96, lines: 1, anchor: 'middle' }).svg}${secondary ? `<g>${ui.rect(frame.x + 12, frame.y + frame.height - secondaryH, frame.width - 24, secondaryH - 12, { fill: theme.surface, stroke: theme.border, radius: 10 })}${ui.text(secondary.title, frame.x + 30, frame.y + frame.height - secondaryH + 35, { size: 14, weight: 700, fill: theme.foreground, width: frame.width - 60, lines: 1 }).svg}${ui.text(secondary.body, frame.x + 30, frame.y + frame.height - secondaryH + 70, { size: 11, weight: 480, fill: theme.muted_foreground, width: frame.width - 60, lines: 2 }).svg}</g>` : ''}</g>`
  }
  const navW = pattern.id === 'split-pane-shell' ? frame.width * 0.2 : frame.width * 0.25
  const secondaryW = pattern.id === 'split-pane-shell' && secondary ? frame.width * 0.25 : 0
  const mainX = frame.x + navW + 14
  const mainW = frame.width - navW - secondaryW - (secondaryW ? 28 : 14)
  const navItems = String(navigation?.body || '')
    .split(/[·,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
  const contentTop = frame.y + 76
  return `<g>${ui.rect(frame.x, frame.y, frame.width, frame.height, { fill: theme.subtle, stroke: theme.border, radius: 12, filter: 'url(#ck-card-shadow)' })}${ui.rect(frame.x, frame.y, navW, frame.height, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.circle(frame.x + 25, frame.y + 29, 10, { fill: theme.foreground })}${ui.text(navigation?.title || 'ContentKit', frame.x + 44, frame.y + 34, { size: 13, weight: 740, fill: theme.foreground, width: navW - 58, lines: 1 }).svg}${ui.line(frame.x + 14, frame.y + 56, frame.x + navW - 14, frame.y + 56, { stroke: theme.border, width: 1 })}${(navItems.length
    ? navItems
    : ['Overview', 'Content', 'Settings']
  )
    .map(
      (label, index) =>
        `<g>${index === 0 ? ui.rect(frame.x + 12, frame.y + 72 + index * 44, navW - 24, 34, { fill: theme.muted, radius: 7 }) : ''}${ui.circle(frame.x + 25, frame.y + 89 + index * 44, 4, { fill: index === 0 ? theme.chart_1 : theme.border })}${ui.text(label, frame.x + 38, frame.y + 94 + index * 44, { size: 10, weight: index === 0 ? 700 : 560, fill: index === 0 ? theme.foreground : theme.muted_foreground, width: navW - 52, lines: 1 }).svg}</g>`,
    )
    .join(
      '',
    )}${ui.rect(mainX, frame.y, mainW, frame.height, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.rect(mainX, frame.y, mainW, 58, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.text(toolbar?.title || 'Workspace / Overview', mainX + 20, frame.y + 35, { size: 10, weight: 650, fill: theme.muted_foreground, width: mainW - 140, lines: 1 }).svg}${ui.rect(mainX + mainW - 110, frame.y + 14, 92, 30, { fill: theme.foreground, radius: 7 })}${ui.text('New view', mainX + mainW - 64, frame.y + 34, { size: 9, weight: 700, fill: theme.primary_foreground, width: 78, lines: 1, anchor: 'middle' }).svg}${ui.text(main?.title || 'Main', mainX + 22, contentTop + 34, { size: 24, weight: 760, fill: theme.foreground, width: mainW - 44, lines: 2 }).svg}${ui.text(main?.body || '', mainX + 22, contentTop + 82, { size: 12, weight: 480, fill: theme.muted_foreground, width: mainW - 44, lines: 4 }).svg}${ui.rect(mainX + 22, frame.y + frame.height * 0.52, mainW - 44, frame.height * 0.3, { fill: theme.subtle, stroke: theme.border, radius: 9 })}${Array.from({ length: 4 }, (_, index) => ui.rect(mainX + 40, frame.y + frame.height * 0.58 + index * 31, (mainW - 90) * (0.58 + (index % 3) * 0.13), 8, { fill: index === 0 ? theme.chart_1 : theme.border, radius: 4 })).join('')}${secondaryW ? `<g>${ui.rect(frame.x + frame.width - secondaryW, frame.y, secondaryW, frame.height, { fill: theme.surface, stroke: theme.border, radius: 12 })}${ui.text(secondary.title, frame.x + frame.width - secondaryW + 20, frame.y + 44, { size: 16, weight: 730, fill: theme.foreground, width: secondaryW - 40, lines: 2 }).svg}${ui.text(secondary.body, frame.x + frame.width - secondaryW + 20, frame.y + 104, { size: 11, weight: 480, fill: theme.muted_foreground, width: secondaryW - 40, lines: 7 }).svg}</g>` : ''}</g>`
}

export function renderInformationPattern({ rendered, pattern, items, frame, theme, ui }) {
  const primary =
    rendered.semantic.nodes.find((node) => node.id === rendered.narrative?.primary_node) || rendered.semantic.nodes[0]
  if (primary?.state && primary.state !== 'normal' && !items.length) {
    const labels = {
      empty: ['No content yet', 'There are no entries available for this view.'],
      error: ['Output unavailable', 'The authored error description remains available in semantic HTML.'],
      invalid: ['Incomplete input', 'The composition is waiting for valid authored content.'],
      loading: ['Preparing content', 'The static output identifies this intermediate state explicitly.'],
      partial: ['Partially available', 'Available content is shown; missing content is not invented.'],
      stale: ['Content may be stale', 'The authored state makes the time constraint visible.'],
    }
    const [title, body] = labels[primary.state] || labels.empty
    const width = Math.min(frame.width, 720)
    const height = Math.min(frame.height, 280)
    const x = frame.x + (frame.width - width) / 2
    const y = frame.y + (frame.height - height) / 2
    return `<g>${ui.rect(x, y, width, height, {
      fill: theme.surface,
      stroke: theme.border,
      radius: 18,
    })}${ui.circle(x + 38, y + 42, 9, { fill: theme.chart_3 })}${
      ui.text(primary.state.toUpperCase(), x + 62, y + 48, {
        size: 11,
        weight: 760,
        fill: theme.muted_foreground,
        width: width - 92,
        lines: 1,
        tracking: 1,
      }).svg
    }${
      ui.text(title, x + 30, y + 112, {
        size: 30,
        weight: 760,
        fill: theme.foreground,
        width: width - 60,
        lines: 2,
      }).svg
    }${
      ui.text(body, x + 30, y + 178, {
        size: 14,
        weight: 480,
        fill: theme.muted_foreground,
        width: width - 60,
        lines: 3,
      }).svg
    }</g>`
  }
  if (pattern.category === 'faq') return faq(rendered, pattern, items, frame, theme, ui)
  if (pattern.category === 'code') return codeExample(rendered, pattern, items, frame, theme, ui)
  if (pattern.category === 'pricing') return pricing(rendered, pattern, items, frame, theme, ui)
  if (pattern.category === 'gallery') return gallery(rendered, pattern, items, frame, theme, ui)
  if (pattern.category === 'table') return dataTable(rendered, pattern, items, frame, theme, ui)
  if (pattern.category === 'stats') return stats(pattern, items, frame, theme, ui)
  if (pattern.category === 'dashboard') return dashboard(rendered, items, frame, theme, ui)
  if (pattern.category === 'application') return applicationShell(pattern, items, frame, theme, ui)
  return null
}
