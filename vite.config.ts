import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

function stripManualChunks() {
  return {
    name: 'contentkit-deck-strip-manual-chunks',
    enforce: 'post' as const,
    configResolved(config: any) {
      const output = config?.build?.rollupOptions?.output
      if (Array.isArray(output)) output.forEach((entry: any) => delete entry.manualChunks)
      else if (output) delete output.manualChunks
    },
  }
}

export default defineConfig({
  plugins: [viteSingleFile({ useRecommendedBuildConfig: true, removeViteModuleLoader: true }), stripManualChunks()],
})
