## Ringkasan
Apa yang berubah dan kenapa (bukan cuma "apa").

## Perubahan
- ...

## Test Plan
- [ ] `pnpm type-check` lolos
- [ ] `pnpm test` lolos
- [ ] `pnpm build` lolos
- [ ] Sudah dites manual di `pnpm dev` (kalau perubahan menyentuh UI/alur user)

## Terkait
Issue/PR terkait (kalau ada): #

## Checklist
- [ ] Kalau mengubah schema di `packages/db/src/schema/`, sudah generate migration (`pnpm db:generate`) dan commit hasilnya
- [ ] Kalau menambah env var/secret baru, sudah update `.dev.vars.example` / `wrangler.toml` / `.env.example` terkait
