interface FilterSelectProps<T extends string> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange(value: T): void
}

export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: FilterSelectProps<T>) {
  return (
    <select
      className="select toolbar-select"
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
