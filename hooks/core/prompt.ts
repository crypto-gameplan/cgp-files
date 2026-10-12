// What a prompt hands the tree, and what the tree hands the prompt.

import { inside, resolve } from './paths'

/** The context line that tells Claude which file is selected. */
export function selectionContext(path: string): string {
  return `The user has this file selected in the cgp-files tree; "this" or "it" in the prompt likely refers to it: ${path}`
}

/** The `@path` mentions of a prompt that point into the tree. */
export function mentions(text: string, root: string, home: string): string[] {
  return [...text.matchAll(/@([^\s"'`]+)/g)]
    .map(m => (m[1] ?? '').replace(/[.,;:!?)]+$/, ''))
    .filter(Boolean)
    .map(p => resolve(root, p, home))
    .filter(p => inside(root, p))
}

/** The `[task id, status]` of every background task the text reports as ended. */
export function endedTasks(text: string): [string, string][] {
  return [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const body = m[1] ?? ''
    const id = /<task-id>([^<]*)<\/task-id>/.exec(body)?.[1]?.trim()
    const status = /<status>([^<]*)<\/status>/.exec(body)?.[1]?.trim()
    return id && status ? [[id, status] as [string, string]] : []
  })
}
