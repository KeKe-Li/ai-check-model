'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

interface ScoreGaugeProps {
  score: number // 0-100
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW'
}

export default function ScoreGauge({ score, confidenceLevel }: ScoreGaugeProps) {
  const [displayScore, setDisplayScore] = useState(0)

  // 根据置信度确定颜色
  const getColor = () => {
    switch (confidenceLevel) {
      case 'HIGH':
        return {
          stroke: '#22c55e', // green-500
          text: 'text-green-600',
          bg: 'bg-green-50',
        }
      case 'MEDIUM':
        return {
          stroke: '#eab308', // yellow-500
          text: 'text-yellow-600',
          bg: 'bg-yellow-50',
        }
      case 'LOW':
        return {
          stroke: '#f97316', // orange-500
          text: 'text-orange-600',
          bg: 'bg-orange-50',
        }
      case 'VERY_LOW':
        return {
          stroke: '#ef4444', // red-500
          text: 'text-red-600',
          bg: 'bg-red-50',
        }
      default:
        return {
          stroke: '#6b7280', // gray-500
          text: 'text-gray-600',
          bg: 'bg-gray-50',
        }
    }
  }

  const color = getColor()

  // 圆形参数
  const size = 200
  const strokeWidth = 12
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  // 动画计数
  useEffect(() => {
    let start = 0
    const duration = 1500 // 1.5秒
    const increment = score / (duration / 16) // 60fps

    const timer = setInterval(() => {
      start += increment
      if (start >= score) {
        setDisplayScore(score)
        clearInterval(timer)
      } else {
        setDisplayScore(Math.floor(start))
      }
    }, 16)

    return () => clearInterval(timer)
  }, [score])

  // 置信度文本映射
  const confidenceText: Record<typeof confidenceLevel, string> = {
    HIGH: '高置信度',
    MEDIUM: '中等置信度',
    LOW: '低置信度',
    VERY_LOW: '极低置信度',
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* 圆形进度 */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* 背景圆 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* 进度圆 */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color.stroke}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
          />
        </svg>

        {/* 中心文字 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className={`text-5xl font-bold ${color.text}`}
          >
            {displayScore}
          </motion.div>
          <div className="text-sm text-muted-foreground">/ 100</div>
        </div>
      </div>

      {/* 置信度标签 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className={`px-4 py-2 rounded-full text-sm font-medium ${color.bg} ${color.text}`}
      >
        {confidenceText[confidenceLevel]}
      </motion.div>
    </div>
  )
}
