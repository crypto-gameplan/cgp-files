// Short text for the right column.

/** `2026-10-12 14:05` in local time, '' for an unknown time. */
export function stamp(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Binary units, one decimal below 100: `512 B`, `1.5 K`, `120 M`. `?` when the size is unknown. */
export function formatSize(bytes: number): string {
  if (bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  const units = ['K', 'M', 'G', 'T']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** Cuts a name to `width` characters with an ellipsis. */
export function clip(text: string, width: number): string {
  const chars = [...text]
  return chars.length > width ? `${chars.slice(0, Math.max(1, width - 1)).join('')}…` : text
}

export function width(text: string): number {
  return [...text].length
}
