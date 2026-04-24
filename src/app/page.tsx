import { Shield, Zap, ShieldCheck, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import VerifyForm from '@/components/verify/VerifyForm'

export default function Home() {
  const features = [
    {
      icon: Shield,
      title: '多维度检测',
      description: '8项独立检测器,从元数据到行为指纹全方位验证',
    },
    {
      icon: Zap,
      title: '实时进度',
      description: 'SSE 流式推送,逐步展示每项检测结果',
    },
    {
      icon: ShieldCheck,
      title: '难以伪造',
      description: '基于模型独有能力(thinking块、logprobs)的深度验证',
    },
    {
      icon: BarChart3,
      title: '排行榜',
      description: '社区驱动的中转站信誉排名',
    },
  ]

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="container relative z-10">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI 模型真伪验证
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              输入中转站 API 信息,多维度检测模型是否为官方正版
            </p>
          </div>
        </div>
      </section>

      {/* Verify Form Section */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container">
          <div className="max-w-2xl mx-auto">
            <VerifyForm />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">核心能力</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              通过多种检测方式,确保您使用的模型真实可靠
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon
              return (
                <Card key={index} className="border-2">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{feature.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
