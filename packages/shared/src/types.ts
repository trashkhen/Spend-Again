import type { Category, SubCategory } from './categories.js'

export type { Category, SubCategory }

// Transaction — core expense record
export type Transaction = {
  id: string
  userId: string
  amount: number // stored as integer cents
  item: string
  category: Category
  subCategory: SubCategory
  date: string // DD/MM/YYYY
  source: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3 // which parse tier resolved it
  confidence?: number
  createdAt: string
  updatedAt: string
}

// User
export type User = {
  id: string
  email?: string
  telegramId?: string
  telegramUsername?: string
  createdAt: string
}

// LearnedMapping — item → category mapping stored in DB
export type LearnedMapping = {
  id: string
  itemName: string // normalized lowercase
  category: Category
  subCategory: SubCategory
  confidence: number // 0–1
  source: 'regex' | 'gemini' | 'user'
  usageCount: number
  createdAt: string
  updatedAt: string
}
