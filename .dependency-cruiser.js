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
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
