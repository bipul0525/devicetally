import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { SETUP_TOKEN: 'test-setup-token', RELEASE_REPO: 'me/devicetally', TEST_MIGRATIONS: await readD1Migrations('./migrations') },
      },
    })),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
})
