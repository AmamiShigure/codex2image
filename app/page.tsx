import Generator from '@/components/Generator'
import { SIZE_PRESETS, DEFAULT_PRESET_ID, DEFAULT_QUALITY, QUALITY_OPTIONS } from '@/lib/presets'

export default function Page() {
  return (
    <Generator
      presets={SIZE_PRESETS}
      defaultPresetId={DEFAULT_PRESET_ID}
      defaultQuality={DEFAULT_QUALITY}
      qualityOptions={[...QUALITY_OPTIONS]}
    />
  )
}
