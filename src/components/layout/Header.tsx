'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Shield, Sun, Moon, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet'

export default function Header() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light')
    setTheme(initialTheme)
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  const navLinks = [
    { href: '/', label: '首页' },
    { href: '/history', label: '历史记录' },
    { href: '/leaderboard', label: '排行榜' },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
          <Shield className="h-6 w-6 text-primary" />
          <span>AI 模型验证</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Theme Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="hidden md:inline-flex"
            aria-label="切换主题"
          >
            {mounted && theme === 'light' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          {/* Mobile Menu */}
          <Sheet>
            <SheetTrigger className="md:hidden" render={<Button variant="ghost" size="icon" aria-label="打开菜单" />}>
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <div className="flex flex-col gap-4 mt-8">
                {navLinks.map((link) => (
                  <SheetClose key={link.href} render={<Link href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2" />}>
                    {link.label}
                  </SheetClose>
                ))}
                <div className="border-t pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleTheme}
                    className="w-full justify-start"
                  >
                    {mounted && theme === 'light' ? (
                      <>
                        <Sun className="h-4 w-4 mr-2" />
                        <span>浅色模式</span>
                      </>
                    ) : (
                      <>
                        <Moon className="h-4 w-4 mr-2" />
                        <span>深色模式</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
