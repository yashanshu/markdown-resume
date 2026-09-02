# Conventions

- Always use pnpm. Never npm/npx; one-off binaries via `pnpm dlx`.
- Wrangler operations that need auth (login, deploy, secret put, remote D1) are run by the owner on their machine. Do not run them.
- Build/test: `pnpm build`, `pnpm run build:pkg`.
