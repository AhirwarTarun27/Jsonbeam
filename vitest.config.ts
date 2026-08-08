import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node is the default because most of `src/lib` is pure data work and
		// starting a DOM per file is not free. The workbench kernel is the
		// exception: it exists to talk to the DOM, so those files opt in with
		// `// @vitest-environment jsdom` at the top.
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});
