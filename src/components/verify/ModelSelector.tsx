'use client'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_MODELS } from '@/lib/detection/types'

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export default function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const handleChange = (newValue: string | null) => {
    if (newValue) {
      onChange(newValue)
    }
  }
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
    openai: 'OpenAI',
    google: 'Google',
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedModels).map(([group, models]) => (
          <SelectGroup key={group}>
            <SelectLabel>{groupLabels[group] || group}</SelectLabel>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
