# ResearchConnect

A researcher networking platform where scientists can find collaborators, post and discover research projects, browse jobs, message peers, and build their academic network.

## File Structure

```
researchconnect/
├── server.js           Backend — Express server, Mongoose models, all API routes
├── package.json        Node.js dependencies and npm scripts
├── package-lock.json   Locked dependency versions
├── replit.nix          Nix environment config (Node.js runtime)
├── .replit             Replit workflow config (starts server on port 5000)
└── public/
    └── index.html      Frontend — full single-page app (no build step)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 16+ |
| Server | Express 4 |
| Database | MongoDB Atlas via Mongoose |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Frontend | Vanilla HTML/CSS/JS, single file, no framework |
| Fonts | Syne (headings), DM Sans (body) via Google Fonts |

## Environment Variables

Set these in Replit Secrets before running:

| Key | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `JWT_SECRET` | No | JWT signing key — change this in production. Defaults to a dev value |
| `PORT` | No | Server port. Set to `5000` by the Replit workflow config |

## Running the App

```bash
npm install
PORT=5000 node server.js
```

The app is served at the configured port. All frontend routes fall through to `public/index.html` (SPA).

---

## Features

- **Authentication** — register, login, JWT sessions persisted in localStorage
- **Researcher directory** — search by name/bio, filter by field, institution, and position
- **Research Projects** — post projects with status (Ongoing / Seeking Collaborators / Completed), filter by field and status, request to collaborate with one click
- **Job board** — post and browse research jobs (Postdoc, Faculty, PhD, Industry, Research Scientist), apply with a message
- **Messaging** — 1-on-1 conversations, unread badges, chat view
- **Connections** — send, accept, and reject connection requests
- **Publications** — add and manage publications per researcher profile
- **Profiles** — editable profile with completeness score, tabbed Publications / My Projects view
- **Persistent storage** — all data stored in MongoDB Atlas

---

## Data Models

### User
| Field | Type | Notes |
|---|---|---|
| email | String | Unique, required |
| password_hash | String | bcrypt, required |
| first_name | String | |
| last_name | String | |
| institution | String | |
| position | String | |
| bio | String | |
| research_fields | [String] | |
| h_index | Number | |
| total_publications | Number | Auto-incremented on publication add |
| profile_completeness | Number | 0–100, calculated on profile save |

### Job
| Field | Type | Notes |
|---|---|---|
| posted_by_user_id | String | |
| organization_name | String | |
| title | String | Required |
| description | String | Required |
| job_type | String | postdoc / faculty / phd / industry / research-scientist |
| location | String | |
| is_remote | Boolean | |
| salary_min / salary_max | Number | |
| required_fields | [String] | |
| application_email | String | |
| is_active | Boolean | |
| expires_at | Date | 30 days from creation |

### Project
| Field | Type | Notes |
|---|---|---|
| user_id | String | Owner |
| title | String | Required |
| description | String | Required |
| field | String | |
| status | String | ongoing / completed / seeking-collaborators |

### Message
| Field | Type |
|---|---|
| sender_id | String |
| recipient_id | String |
| content | String |
| is_read | Boolean |

### Connection
| Field | Type | Notes |
|---|---|---|
| user_id_1 | String | Requester |
| user_id_2 | String | Recipient |
| status | String | pending / connected / rejected |

### Publication
| Field | Type |
|---|---|
| user_id | String |
| title | String |
| authors | [String] |
| journal_name | String |
| publication_date | Date |
| doi | String |
| citation_count | Number |

### JobApplication
| Field | Type |
|---|---|
| job_id | String |
| user_id | String |
| message | String |
| status | String |

---

## API Reference

All authenticated routes require an `Authorization: Bearer <token>` header.

### Auth

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/api/auth/register` | — | `{ email, password, firstName, lastName }` | Create account, returns JWT |
| POST | `/api/auth/login` | — | `{ email, password }` | Login, returns JWT |
| GET | `/api/auth/me` | ✓ | — | Returns current user object |

### Researchers

| Method | Path | Auth | Query Params | Description |
|---|---|---|---|---|
| GET | `/api/researchers` | — | `search, field, institution, position, limit, offset` | List/search researchers |
| GET | `/api/researchers/:id` | — | — | Get researcher by ID |
| PUT | `/api/researchers/:id` | ✓ | — | Update own profile. Body: `{ firstName, lastName, institution, position, bio, researchFields, hIndex }` |

### Jobs

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/jobs` | — | List jobs. Query: `jobType, field, location, limit, offset` |
| GET | `/api/jobs/:id` | — | Get job detail (includes applicant count) |
| POST | `/api/jobs` | ✓ | Post a job. Body: `{ title, description, jobType, organization, location, isRemote, salaryMin, salaryMax, requiredFields, applicationEmail }` |
| DELETE | `/api/jobs/:id` | ✓ | Delete own job |
| POST | `/api/jobs/:id/apply` | ✓ | Apply to a job. Body: `{ message }` |

### Projects

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/projects` | — | List projects. Query: `field, status, userId, limit, offset`. Returns owner info embedded. |
| GET | `/api/projects/:id` | — | Get project detail with owner info |
| POST | `/api/projects` | ✓ | Create project. Body: `{ title, description, field, status }` |
| PUT | `/api/projects/:id` | ✓ | Update own project. Body: `{ title, description, field, status }` |
| DELETE | `/api/projects/:id` | ✓ | Delete own project |
| POST | `/api/projects/:id/collaborate` | ✓ | Send a collaboration request message to the project owner |

### Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/messages` | ✓ | List conversations with last message and unread count |
| GET | `/api/messages/:userId` | ✓ | Get full thread with user. Marks messages as read. |
| POST | `/api/messages/:userId` | ✓ | Send message. Body: `{ content }` |

### Connections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/connections` | ✓ | List accepted connection user IDs |
| GET | `/api/connections/pending` | ✓ | List pending incoming requests |
| POST | `/api/connections/:userId/request` | ✓ | Send a connection request |
| PUT | `/api/connections/:connectionId` | ✓ | Accept or reject. Body: `{ status: "accepted" \| "rejected" }` |

### Publications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/publications/:userId` | — | List a user's publications, sorted newest first |
| POST | `/api/publications` | ✓ | Add publication. Body: `{ title, authors, journal, publicationDate, doi }` |
| DELETE | `/api/publications/:id` | ✓ | Delete own publication |

---

## Frontend Pages

The frontend is a single-page app in `public/index.html`. Navigation is handled by the `navigate(page, extra)` JS function which shows/hides page `div`s.

| Page | Route Key | Description |
|---|---|---|
| Home | `home` | Landing page with hero and feature overview |
| Sign Up | `signup` | Registration form |
| Sign In | `login` | Login form |
| Dashboard | `dashboard` | Stats summary and quick-action shortcuts |
| Researchers | `researchers` | Directory with search + field / institution / position filters and active filter chips |
| Researcher Profile | `researcher-profile` | Public view — bio, stats, research projects with Collaborate button, publications |
| Projects | `projects` | All projects — filter by field and status |
| Jobs | `jobs` | Job board — filter by type and field |
| Job Detail | `job-detail` | Full listing with apply modal |
| My Profile | `profile` | Editable profile with Publications / My Projects tabs |
| Messages | `messages` | Conversation list with unread badges |
| Chat | `chat` | Individual message thread |
