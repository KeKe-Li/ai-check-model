import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ModelSelector from '@/components/verify/ModelSelector'

describe('ModelSelector', () => {
  it('选择模型后触发 onChange，确保验证表单能拿到模型值', () => {
    const onChange = vi.fn()

    render(<ModelSelector value="" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'gpt-5.5' },
    })

    expect(onChange).toHaveBeenCalledWith('gpt-5.5')
  })
})
