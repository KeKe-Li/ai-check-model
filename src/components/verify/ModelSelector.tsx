'use client'

import { SUPPORTED_MODELS } from '@/lib/detection/types'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export default function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  // 按供应商分组模型
  const groupedModels = SUPPORTED_MODELS.reduce((acc, model) => {
    if (!acc[model.group]) {
      acc[model.group] = []
    }
    acc[model.group].push(model)
    return acc
  }, {} as Record<string, typeof SUPPORTED_MODELS>)

  // 供应商显示名称映射
  const groupLabels: Record<string, string> = {
    claude: 'Claude',
    Claude: 'Claude',
    openai: 'OpenAI',
    OpenAI: 'OpenAI',
    google: 'Google',
    Google: 'Google',
  }

  return (
    <select
      id="model"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      <option value="" disabled>
        选择模型
      </option>
      {Object.entries(groupedModels).map(([group, models]) => (
        <optgroup key={group} label={groupLabels[group] || group}>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
