import { describe, expect, it } from 'vitest'
import { fullInDays } from '../src/health'

describe('disk-full estimate', () => {
  const day = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10)
  it('projects a steady decline', () => {
    // 1 GB less free each day, 20 GB left → about 20 days.
    expect(fullInDays([0, 1, 2, 3].map((i) => ({ day: day(i), free: (23 - i) * 1e9 })))).toBe(20)
  })
  it('says nothing when not filling up or too little data', () => {
    expect(fullInDays([0, 1, 2].map((i) => ({ day: day(i), free: (20 + i) * 1e9 })))).toBeNull()
    expect(fullInDays([{ day: day(0), free: 1 }])).toBeNull()
  })
})
