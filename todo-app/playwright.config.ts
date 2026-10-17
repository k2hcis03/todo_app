import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: 'tests/e2e',
  // 인메모리 DB 하나를 공유하므로 테스트는 순차 실행하고, 각 테스트가 시작 전에 데이터를 비운다.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/api/me`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
