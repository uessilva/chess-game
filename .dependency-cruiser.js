export default {
  forbidden: [
    {
      name: 'core-stays-pure',
      comment:
        'src/core must stay framework-agnostic and side-effect free: it may only depend on other core modules (and npm packages)',
      severity: 'error',
      from: { path: '^src/core' },
      to: { pathNot: '^src/core|^node_modules' },
    },
    {
      name: 'engine-depends-on-core-only',
      comment:
        'src/engine may only depend on src/core, itself, and npm packages: eval stays pure and Node-testable until the Web Worker lands (3.2)',
      severity: 'error',
      from: { path: '^src/engine' },
      to: { pathNot: '^src/(core|engine)|^node_modules' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
