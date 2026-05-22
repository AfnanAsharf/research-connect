# ResearchConnect MVP

A researcher networking platform — find collaborators, post jobs, message peers.

## 🚀 Run on Replit (2 minutes)

1. Create a new **Node.js** Repl at replit.com
2. Upload all files (or paste contents manually):
   - `server.js` → root
   - `package.json` → root
   - `.replit` → root
   - `public/index.html` → create `public/` folder first
3. Click **Run** — Replit auto-installs dependencies
4. Your app opens in the preview pane!

## File Structure

```
researchconnect/
├── server.js          ← All backend routes (auth, jobs, researchers, messages...)
├── package.json       ← Dependencies
├── .replit            ← Replit config
└── public/
    └── index.html     ← Full SPA frontend (no build step needed)
```

## Features

- ✅ Sign up / Login (JWT auth)
- ✅ Researcher profiles with search & filters
- ✅ Job board — post, browse, apply
- ✅ Messaging (1-on-1 conversations)
- ✅ Connection requests
- ✅ Publications management
- ✅ Dashboard with stats

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Create account |
| POST | /api/auth/login | — | Login |
| GET | /api/auth/me | ✓ | Current user |
| GET | /api/researchers | — | List/search researchers |
| GET | /api/researchers/:id | — | Researcher profile |
| PUT | /api/researchers/:id | ✓ | Update profile |
| GET | /api/jobs | — | List jobs |
| POST | /api/jobs | ✓ | Post job |
| POST | /api/jobs/:id/apply | ✓ | Apply for job |
| GET | /api/messages | ✓ | Conversations |
| POST | /api/messages/:userId | ✓ | Send message |
| GET | /api/publications/:userId | — | Get publications |
| POST | /api/publications | ✓ | Add publication |

## ⚠️ MVP Limitations

- **In-memory storage** — data resets when server restarts
- To persist data: add a database (MongoDB Atlas free tier works great with Replit)

## Add a Database (optional upgrade)

1. Create free MongoDB Atlas cluster at mongodb.com
2. Set `MONGODB_URI` in Replit Secrets
3. Replace in-memory arrays in `server.js` with Mongoose models

## Environment Variables (Replit Secrets)

| Key | Default | Description |
|-----|---------|-------------|
| JWT_SECRET | researchconnect_dev_secret_2026 | Change in production! |
| PORT | 3000 | Replit sets this automatically |
