# Deploy

## One-time setup

1. **Create Cloudflare account** (free) at https://dash.cloudflare.com.
2. **Create KV namespace**:
   ```
   pnpm --filter @wwp/worker exec wrangler kv:namespace create KV
   ```
   Note the returned `id` and `preview_id`. Paste both into `apps/worker/wrangler.toml`.
3. **Generate group secret**:
   ```
   pnpm bootstrap-group --id mygroup --name "My Group" --people alec,mike,sarah,jordan,casey
   ```
   Copy the printed secret.
4. **Write the secret to KV**:
   ```
   pnpm --filter @wwp/worker exec wrangler kv:key put --binding=KV "group:mygroup:secret" "<paste secret>"
   ```
5. **Deploy the worker**:
   ```
   pnpm --filter @wwp/worker deploy
   ```
   Note the worker URL (e.g. `https://whatweplayin.<account>.workers.dev`).
6. **Connect repo to Cloudflare Pages**:
   - Cloudflare dashboard → Pages → Connect to Git → select repo
   - Build command: `pnpm install && pnpm --filter @wwp/site build`
   - Output dir: `apps/site/dist`
   - Env var: `PUBLIC_WORKER_URL` = the worker URL from step 5
7. **Send members the URL**: `https://<your-pages-url>/#g=mygroup&s=<secret>`

## CI deploy on main

GitHub Actions runs `wrangler deploy` for the worker after tests pass; Cloudflare Pages auto-deploys the site from the `main` branch.

To enable CI deploy:

- In GitHub repo → Settings → Secrets and variables → Actions, add `CLOUDFLARE_API_TOKEN` (with `Workers:Edit` and `Pages:Edit` permissions).
- Set `CLOUDFLARE_ACCOUNT_ID` as a repo variable.
