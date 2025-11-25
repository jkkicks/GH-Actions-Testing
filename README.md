# Remix Starter Kit

A production-ready Remix + TypeScript + Drizzle ORM starter template with CI/CD pipelines pre-configured.

Fork this repo to get a fully functional full-stack application with automated testing, security scanning, and deployment workflows out of the box.

## What's Included

- **[Remix](https://remix.run/)** - Full-stack React framework
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript
- **[Drizzle ORM](https://orm.drizzle.team/)** - TypeScript-first ORM for PostgreSQL
- **[ESLint](https://eslint.org/)** - Code linting and style enforcement
- **[Docker](https://www.docker.com/)** - Multi-stage production build with security best practices
- **[GitHub Actions](https://github.com/features/actions)** - Complete CI/CD pipeline

### CI/CD Features

| Feature | Description |
|---------|-------------|
| Lint & Typecheck | Runs on every PR |
| Migration Verification | Detects schema drift, tests migrations apply cleanly |
| Security Scanning | Trivy scans for vulnerabilities (code + Docker images) |
| Docker Builds | Automated builds with layer caching |
| GHCR Publishing | Images pushed to GitHub Container Registry |
| Release Please | Automated versioning and changelog generation |
| GitHub Environments | Staging and production deployment tracking |

## Quick Start

### 1. Fork or Use as Template

Click "Use this template" or fork this repository.

### 2. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
npm install
```

### 3. Set Up Database

Create a PostgreSQL database and set the connection string:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/mydb"
```

### 4. Run Migrations

```bash
npm run db:migrate
```

### 5. Start Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Project Structure

```
.
├── .github/workflows/       # CI/CD pipelines
│   ├── pr-checks.yml        # PR quality gates
│   ├── staging-deploy.yml   # Build and deploy to staging
│   ├── release-please.yml   # Automated releases
│   └── production-deploy.yml# Production deployment
├── app/                     # Remix application
│   ├── lib/db/              # Database schema and connection
│   ├── routes/              # Application routes
│   └── root.tsx             # Root layout
├── drizzle/                 # Migration files
├── docs/                    # Documentation
│   └── CI-CD-SETUP-GUIDE.md # Detailed CI/CD setup instructions
├── Dockerfile               # Production Docker build
├── drizzle.config.ts        # Drizzle ORM configuration
└── package.json
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Run production server (runs migrations first) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler check |
| `npm run db:generate` | Generate new migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |

## Database Schema

The starter includes a basic schema in `app/lib/db/schema.ts`:

```typescript
// Example tables - modify as needed
export const items = pgTable("items", {
  name: text("name").primaryKey(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Making Schema Changes

1. Edit `app/lib/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Commit both the schema and migration files
4. CI will verify migrations apply cleanly

## CI/CD Setup

The workflows are ready to run, but you need to configure a few GitHub settings.

### Required Configuration

1. **Repository Secret**: Create `RELEASE_TOKEN` (fine-grained PAT with Contents and Pull Requests write access)

2. **Actions Permissions** (Settings > Actions > General):
   - Workflow permissions: "Read and write permissions"
   - Allow GitHub Actions to create and approve pull requests: Enabled

3. **Environments** (Settings > Environments):
   - Create `staging` environment (deploy from `main` branch)
   - Create `production` environment (deploy from tags matching `v*`)

For detailed setup instructions, see [docs/CI-CD-SETUP-GUIDE.md](./docs/CI-CD-SETUP-GUIDE.md).

## Deployment Flow

```
PR Opened
    ↓
PR Checks (lint, typecheck, migrations, security)
    ↓
Merge to main
    ↓
Build Docker Image → Push to GHCR → Deploy to Staging
    +
Release Please opens Release PR (if feat/fix commits)
    ↓
Merge Release PR
    ↓
GitHub Release created (v1.0.0)
    ↓
Retag image → Deploy to Production
```

## Docker

### Build Locally

```bash
docker build -t my-app .
```

### Run Locally

```bash
docker run -p 3000:3000 -e DATABASE_URL="..." my-app
```

The Dockerfile includes:
- Multi-stage build for smaller images
- Non-root user for security
- Health check endpoint (`/health`)
- Automatic migrations on startup

## Customization

### Rename the Project

1. Update `name` in `package.json`
2. Update this README
3. Modify the database schema for your needs

### Add Your Deployment

The deploy steps in the workflows are placeholders. Replace them with your deployment method:

- **GitOps**: Update an infra repo with the new image tag
- **SSH**: Deploy directly to servers
- **Cloud**: Use AWS/GCP/Azure CLI
- **Webhook**: Trigger external deployment service

See the [CI/CD Setup Guide](./docs/CI-CD-SETUP-GUIDE.md#adding-deployment-steps) for examples.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |

## Contributing

1. Create a feature branch
2. Make changes following conventional commits (`feat:`, `fix:`, etc.)
3. Open a PR - CI will run automatically
4. Merge after checks pass

## License

MIT
