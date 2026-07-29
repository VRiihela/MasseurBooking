> All agents (Implementer, Tester, Security, Release) must use these commands unless explicitly overridden by the project.

## Tooling Commands (Node + TypeScript Backend)

### Install
- npm ci

### Development
- npm run dev

### Build
- npm run build

### Start (production)
- npm start

### Lint
- npm run lint

### Format (if configured)
- npm run format

### Test
- npm test

### Test (CI mode, no watch)
- npm test -- --run

### Dependency Audit
- npm audit --audit-level=high

### Type Check
- npx tsc --noEmit

### Production-only Audit (CI)
- npm audit --production