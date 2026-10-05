'use client'

/**
 * GKSetu — Console form fields (CONSOLE-S1): the compact labelled inputs
 * every console dialog/form is composed from — consistent layout, inline
 * field errors (the API's `{ field: [messages] }` details), and a compact
 * textarea/code-area variant for body/HTML fields.
 */
import { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  error?: string | null
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-[13px] font-medium text-zinc-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-zinc-400">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  type = 'text',
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  type?: string
  className?: string
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={cn('h-8 text-[13px]', invalid && 'border-red-300 focus-visible:ring-red-200', className)}
    />
  )
}

export function TextArea({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  rows = 4,
  mono,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  rows?: number
  mono?: boolean
}) {
  return (
    <Textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'text-[13px] leading-relaxed',
        mono && 'font-mono text-xs',
        invalid && 'border-red-300 focus-visible:ring-red-200'
      )}
    />
  )
}

export function SelectInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
  groups,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
  invalid?: boolean
  /** SITE-S12: optional optgroup structure — when present, options are
   * rendered inside named <optgroup> elements (the jurisdiction picker
   * uses this to separate Central / State / District). */
  groups?: Array<{ label: string; options: Array<{ value: string; label: string }> }>
  /** SITE-S12: when true, the whole select is disabled (loading or busy). */
  disabled?: boolean
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm transition-colors',
        'focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-red-300' : 'hover:border-zinc-300'
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {groups
        ? groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))
        : options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
    </select>
  )
}

export function SwitchField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
      <div>
        <p className="text-[13px] font-medium text-zinc-700">{label}</p>
        {hint && <p className="text-xs text-zinc-400">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
