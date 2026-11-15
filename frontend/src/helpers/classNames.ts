// Join CSS class names, skipping falsy values: classNames('btn', isOn && 'btn-on', undefined) -> 'btn btn-on'
export type ClassValue = string | false | null | undefined

export function classNames(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
