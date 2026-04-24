'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import ModelSelector from './ModelSelector'

const formSchema = z.object({
  endpoint: z
    .string()
    .url({ message: '请输入有效的 URL' })
    .refine((url) => url.startsWith('http://') || url.startsWith('https://'), {
      message: 'URL 必须以 http:// 或 https:// 开头',
    }),
  apiKey: z.string().min(1, { message: '请输入 API Key' }),
  model: z.string().min(1, { message: '请选择模型' }),
})

type FormData = z.infer<typeof formSchema>

export default function VerifyForm() {
  const router = useRouter()
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      endpoint: '',
      apiKey: '',
      model: '',
    },
  })

  const modelValue = watch('model')

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '验证失败')
      }

      const result = await response.json()

      // 构建带查询参数的 URL，用于 SSE 连接
      const url = `/verify/${result.jobId}?endpoint=${encodeURIComponent(data.endpoint)}&apiKey=${encodeURIComponent(data.apiKey)}&model=${encodeURIComponent(data.model)}`
      router.push(url)
    } catch (error) {
      console.error('提交失败:', error)
      alert(error instanceof Error ? error.message : '提交失败,请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">开始验证</CardTitle>
        <CardDescription>
          填写中转站 API 信息,我们将对模型进行全面检测
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Endpoint URL */}
          <div className="space-y-2">
            <Label htmlFor="endpoint">
              API 端点 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="endpoint"
              type="text"
              placeholder="https://api.example.com/v1"
              {...register('endpoint')}
              disabled={isSubmitting}
              className={errors.endpoint ? 'border-destructive' : ''}
            />
            {errors.endpoint && (
              <p className="text-sm text-destructive">{errors.endpoint.message}</p>
            )}
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">
              API Key <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-..."
                {...register('apiKey')}
                disabled={isSubmitting}
                className={errors.apiKey ? 'border-destructive pr-10' : 'pr-10'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowApiKey(!showApiKey)}
                disabled={isSubmitting}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {errors.apiKey && (
              <p className="text-sm text-destructive">{errors.apiKey.message}</p>
            )}
          </div>

          {/* Model Selector */}
          <div className="space-y-2">
            <Label htmlFor="model">
              模型 <span className="text-destructive">*</span>
            </Label>
            <ModelSelector
              value={modelValue}
              onChange={(value) => setValue('model', value, { shouldValidate: true })}
              disabled={isSubmitting}
            />
            {errors.model && (
              <p className="text-sm text-destructive">{errors.model.message}</p>
            )}
          </div>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isSubmitting} size="lg">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>验证中...</span>
              </>
            ) : (
              <span>开始验证</span>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
