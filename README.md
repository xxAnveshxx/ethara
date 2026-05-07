# Ethara Project Tracker

A full-stack web app where users can:
- Signup/Login
- Create and manage projects
- Add team members to projects
- Create, assign, and track tasks
- View dashboard stats including overdue tasks

Roles:
- `ADMIN`: Can create projects, add members, create tasks, and update any task.
- `MEMBER`: Can view only assigned/accessible projects and update status of tasks assigned to them.

## Tech Stack

- Node.js + Express
- PostgreSQL (`pg`)
- JWT auth + bcrypt password hashing
- Vanilla HTML/CSS/JS frontend (served by Express)

## Project Structure

```text
.
├─ frontend/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ backend/
│  ├─ server.js
│  ├─ db.js
│  └─ auth.js
├─ .env.example
├─ .gitignore
├─ package.json
└─ README.md
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and update values:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ethara
JWT_SECRET=replace-with-a-long-random-secret
```

3. Start the app:

```bash
npm start
```

4. Open:

`http://localhost:3000`

## API Summary

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users` (ADMIN)
- `POST /api/projects` (ADMIN)
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/projects/:projectId/members` (project/global admin)
- `POST /api/projects/:projectId/tasks` (project/global admin)
- `PATCH /api/tasks/:taskId` (project admin or assignee)
- `GET /api/dashboard`