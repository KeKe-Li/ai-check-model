import Link from 'next/link'
import { GitBranch } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="container py-8 md:py-12">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold">AI 模型验证</p>
            <p className="text-sm text-muted-foreground">
              检测中转站 API 模型真伪
            </p>
          </div>

          <Link
            href="https://github.com/KeKe-Li/ai-check-model"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitBranch className="h-4 w-4" />
            <span>GitHub</span>
          </Link>

          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AI 模型验证. 保留所有权利.
          </p>
        </div>
      </div>
    </footer>
  )
}
