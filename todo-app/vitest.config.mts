import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 기본 환경은 node이고, 컴포넌트 테스트는 파일 상단에 `// @vitest-environment jsdom`을 붙여 전환한다.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    // mongodb-memory-server가 첫 실행 때 mongod 바이너리를 내려받을 수 있어 여유를 둔다.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
