// Aspect-ratio & resolution presets for gpt-image-2 via CPA.
// CPA 实测结论（low quality）：
//   ✅ 单边 ≤ 3072 都能成功： 2048² / 2048×3072 / 2880² / 3072×2048 / 2560×1440
//   ❌ 单边 > 3072 一路 502 “stream disconnected before completion”：
//       3456×2304 / 2304×3456 / 3840×2160 / 2160×3840 均挂
// 真实卡点：单边 ≤ 3072，而不是总像素。
// OpenAI 约束：宽高 16 倍数，总像素 655,360 ~ 8,294,400，宽高比 ≤ 3:1。
// 以下预设全部限制单边 ≤ 3072，保证 CPA 下稳定运行。

export type SizePreset = {
  id: string
  label: string      // zh-CN label
  ratio: string      // e.g. '1:1'
  width: number
  height: number
  orientation: 'square' | 'portrait' | 'landscape'
  official?: boolean // true = OpenAI 官方预设
  tier: 'preview' | 'standard' | '2k' | 'max'
  note?: string
}

export const SIZE_PRESETS: SizePreset[] = [
  // ————— 预览级 (~1 MP，快、省钱，官方 3 个预设) —————
  { id: 'sq-1024',     tier: 'preview', label: '1:1 · 1024²',        ratio: '1:1',  width: 1024, height: 1024, orientation: 'square',    official: true },
  { id: 'po-23-1024',  tier: 'preview', label: '2:3 · 1024×1536',    ratio: '2:3',  width: 1024, height: 1536, orientation: 'portrait', official: true },
  { id: 'la-32-1024',  tier: 'preview', label: '3:2 · 1536×1024',    ratio: '3:2',  width: 1536, height: 1024, orientation: 'landscape', official: true },

  // ————— 标准级 (~1.5-2 MP) —————
  { id: 'sq-1536',     tier: 'standard', label: '1:1 · 1536²',        ratio: '1:1',  width: 1536, height: 1536, orientation: 'square' },
  { id: 'po-34-1536',  tier: 'standard', label: '3:4 · 1152×1536',    ratio: '3:4',  width: 1152, height: 1536, orientation: 'portrait' },
  { id: 'po-45-1280',  tier: 'standard', label: '4:5 · 1024×1280',    ratio: '4:5',  width: 1024, height: 1280, orientation: 'portrait' },
  { id: 'po-916-1344', tier: 'standard', label: '9:16 · 768×1344',    ratio: '9:16', width: 768,  height: 1344, orientation: 'portrait' },
  { id: 'la-169-1344', tier: 'standard', label: '16:9 · 1344×768',    ratio: '16:9', width: 1344, height: 768,  orientation: 'landscape' },
  { id: 'la-43-1536',  tier: 'standard', label: '4:3 · 1536×1152',    ratio: '4:3',  width: 1536, height: 1152, orientation: 'landscape' },
  { id: 'la-219-1920', tier: 'standard', label: '21:9 · 1920×832',    ratio: '21:9', width: 1920, height: 832,  orientation: 'landscape' },

  // ————— 2K 级 (~4-6 MP，卡牌立绘首选，全部实测通过) —————
  { id: 'sq-2048',     tier: '2k', label: '1:1 · 2048² (4.2 MP)',         ratio: '1:1',  width: 2048, height: 2048, orientation: 'square',    note: '实测 98s' },
  { id: 'po-23-2048',  tier: '2k', label: '2:3 · 2048×3072 ⭐ (6.3 MP)', ratio: '2:3',  width: 2048, height: 3072, orientation: 'portrait', note: '卡牌立绘推荐 · 实测 71s' },
  { id: 'po-34-2048',  tier: '2k', label: '3:4 · 2304×3072 (7.1 MP)',    ratio: '3:4',  width: 2304, height: 3072, orientation: 'portrait', note: '手游卡牌常用' },
  { id: 'la-32-3072',  tier: '2k', label: '3:2 · 3072×2048 (6.3 MP)',    ratio: '3:2',  width: 3072, height: 2048, orientation: 'landscape', note: '横版原画 · 实测 76s' },
  { id: 'la-169-2560', tier: '2k', label: '16:9 · 2560×1440 (3.7 MP)',   ratio: '16:9', width: 2560, height: 1440, orientation: 'landscape', note: '实测 125s' },

  // ————— 极限级 (仅方图可到 8 MP，其他比例超 3072 单边都会 502) —————
  { id: 'sq-2880',     tier: 'max', label: '1:1 · 2880² (8.3 MP 上限)',  ratio: '1:1',  width: 2880, height: 2880, orientation: 'square',   note: '方图最大 · 实测 88s' },
]

export const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const
export type Quality = (typeof QUALITY_OPTIONS)[number]

// 默认切到 2K 卡牌立绘（实测 71s，性价比最高）
export const DEFAULT_PRESET_ID = 'po-23-2048'
export const DEFAULT_QUALITY: Quality = 'medium'

export const TIER_LABELS: Record<SizePreset['tier'], string> = {
  preview:  '预览级 · 1024 (~45s)',
  standard: '标准级 · 1.5-2 MP',
  '2k':     '2K 级 · 4-7 MP (推荐)',
  max:      '极限 · 8 MP 方图',
}

// CPA 代理的稳定上限，用于自定义尺寸校验
export const CPA_MAX_SINGLE_EDGE = 3072
export const MIN_TOTAL_PIXELS = 655360
export const MAX_TOTAL_PIXELS = 8294400

// 为了提高模型对尺寸的命中率，在 prompt 末尾追加显式尺寸提示。
export function appendSizeHint(prompt: string, p: SizePreset): string {
  const shape = p.orientation === 'square' ? 'square' : p.orientation
  const hint = `Output in exactly ${p.width}x${p.height} (${p.ratio} ratio) resolution, ${shape} format.`
  const trimmed = prompt.trim()
  return trimmed.endsWith('.') || trimmed.endsWith('。')
    ? `${trimmed} ${hint}`
    : `${trimmed}. ${hint}`
}
