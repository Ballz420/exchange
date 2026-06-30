# Domain & Deployment Setup

See deploy/ folder for all configs.

## Quickest Path
1. Buy domain (Namecheap/Porkbun)
2. Push repo to GitHub
3. Create account on https://railway.app
4. Connect GitHub repo
5. Add custom domain in Railway settings
6. Done

## VPS Path
See deploy/setup-server.sh

## CI/CD
See .github/workflows/deploy.yml


## Supabase (Free PostgreSQL)

```
1. Go to https://supabase.com → Start new project
2. Get your connection string from Project Settings → Database
3. Set environment variables:
   DB_TYPE=postgres
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_PROJECT.supabase.co:5432/postgres
4. Restart the app — tables auto-create on first start
```

## Local Dev (SQLite — default)
Just run as normal. DB_TYPE defaults to sqlite.

## Switch Backends
```bash
# Local (SQLite)
python main.py

# Production (PostgreSQL via Supabase)
DB_TYPE=postgres DATABASE_URL=postgresql://... python main.py
```
