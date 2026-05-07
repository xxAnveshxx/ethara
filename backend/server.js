require("dotenv").config();

const path = require("path");
const express = require("express");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const { pool, initDb } = require("./db");
const { signToken, authRequired, requireGlobalRole } = require("./auth");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

function normalizeRole(role) {
  const value = (role || "").toUpperCase();
  return value === "ADMIN" || value === "MEMBER" ? value : null;
}

function normalizeStatus(status) {
  const value = (status || "").toUpperCase();
  return ["TODO", "IN_PROGRESS", "DONE"].includes(value) ? value : null;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function getProjectMembership(userId, projectId) {
  const { rows } = await pool.query(
    `
      SELECT role
      FROM project_members
      WHERE user_id = $1 AND project_id = $2
    `,
    [userId, projectId]
  );
  return rows[0] || null;
}

async function canAccessProject(user, projectId) {
  if (user.role === "ADMIN") return true;
  const membership = await getProjectMembership(user.id, projectId);
  return Boolean(membership);
}

async function canManageProject(user, projectId) {
  if (user.role === "ADMIN") return true;
  const membership = await getProjectMembership(user.id, projectId);
  return membership?.role === "ADMIN";
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Database is not reachable" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const role = normalizeRole(req.body.role) || "MEMBER";

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ message: "Name must be 2-80 characters" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email address" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, email, role, created_at
      `,
      [name, email, passwordHash, role]
    );

    const user = result.rows[0];
    const token = signToken(user);

    return res.status(201).json({ token, user });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ message: "Failed to create account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const result = await pool.query(
      `
        SELECT id, name, email, password_hash, role, created_at
        FROM users
        WHERE email = $1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at
    };

    const token = signToken(safeUser);
    return res.json({ token, user: safeUser });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed" });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ message: "Failed to load user" });
  }
});

app.get("/api/users", authRequired, requireGlobalRole("ADMIN"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC"
    );
    return res.json(rows);
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ message: "Failed to load users" });
  }
});

app.post("/api/projects", authRequired, requireGlobalRole("ADMIN"), async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const description = (req.body.description || "").trim();

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ message: "Project name must be 2-120 characters" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const projectResult = await client.query(
        `
          INSERT INTO projects (name, description, created_by)
          VALUES ($1, $2, $3)
          RETURNING *
        `,
        [name, description, req.user.id]
      );

      const project = projectResult.rows[0];
      await client.query(
        `
          INSERT INTO project_members (project_id, user_id, role)
          VALUES ($1, $2, 'ADMIN')
          ON CONFLICT (project_id, user_id) DO NOTHING
        `,
        [project.id, req.user.id]
      );

      await client.query("COMMIT");
      return res.status(201).json(project);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create project error:", error);
    return res.status(500).json({ message: "Failed to create project" });
  }
});

app.get("/api/projects", authRequired, async (req, res) => {
  try {
    let result;
    if (req.user.role === "ADMIN") {
      result = await pool.query(`
        SELECT
          p.*,
          COUNT(t.id)::int AS task_count,
          COUNT(CASE WHEN t.status <> 'DONE' AND t.due_date < CURRENT_DATE THEN 1 END)::int AS overdue_count
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `);
    } else {
      result = await pool.query(
        `
          SELECT
            p.*,
            COUNT(t.id)::int AS task_count,
            COUNT(CASE WHEN t.status <> 'DONE' AND t.due_date < CURRENT_DATE THEN 1 END)::int AS overdue_count
          FROM projects p
          INNER JOIN project_members pm ON pm.project_id = p.id
          LEFT JOIN tasks t ON t.project_id = p.id
          WHERE pm.user_id = $1
          GROUP BY p.id
          ORDER BY p.created_at DESC
        `,
        [req.user.id]
      );
    }
    return res.json(result.rows);
  } catch (error) {
    console.error("List projects error:", error);
    return res.status(500).json({ message: "Failed to load projects" });
  }
});

app.get("/api/projects/:projectId", authRequired, async (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const accessible = await canAccessProject(req.user, projectId);
    if (!accessible) {
      return res.status(403).json({ message: "No access to this project" });
    }

    const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const membersResult = await pool.query(
      `
        SELECT u.id, u.name, u.email, u.role AS global_role, pm.role AS project_role
        FROM project_members pm
        INNER JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1
        ORDER BY pm.created_at ASC
      `,
      [projectId]
    );

    const tasksResult = await pool.query(
      `
        SELECT
          t.*,
          assignee.name AS assignee_name,
          creator.name AS creator_name
        FROM tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigned_to
        LEFT JOIN users creator ON creator.id = t.created_by
        WHERE t.project_id = $1
        ORDER BY t.created_at DESC
      `,
      [projectId]
    );

    return res.json({
      project: projectResult.rows[0],
      members: membersResult.rows,
      tasks: tasksResult.rows
    });
  } catch (error) {
    console.error("Project details error:", error);
    return res.status(500).json({ message: "Failed to load project" });
  }
});

app.post("/api/projects/:projectId/members", authRequired, async (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const userId = Number(req.body.userId);
    const projectRole = normalizeRole(req.body.role) || "MEMBER";

    if (!Number.isInteger(projectId) || !Number.isInteger(userId)) {
      return res.status(400).json({ message: "Invalid project or user id" });
    }

    const canManage = await canManageProject(req.user, projectId);
    if (!canManage) {
      return res.status(403).json({ message: "Only project admins can add members" });
    }

    const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await pool.query(
      `
        INSERT INTO project_members (project_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_id)
        DO UPDATE SET role = EXCLUDED.role
      `,
      [projectId, userId, projectRole]
    );

    return res.status(201).json({ message: "Member added to project" });
  } catch (error) {
    console.error("Add member error:", error);
    return res.status(500).json({ message: "Failed to add member" });
  }
});

app.post("/api/projects/:projectId/tasks", authRequired, async (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();
    const assignedTo = req.body.assignedTo ? Number(req.body.assignedTo) : null;
    const status = normalizeStatus(req.body.status) || "TODO";
    const dueDate = parseDateOrNull(req.body.dueDate);

    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }
    if (title.length < 2 || title.length > 140) {
      return res.status(400).json({ message: "Task title must be 2-140 characters" });
    }
    if (req.body.dueDate && !dueDate) {
      return res.status(400).json({ message: "Invalid due date" });
    }

    const canManage = await canManageProject(req.user, projectId);
    if (!canManage) {
      return res.status(403).json({ message: "Only project admins can create tasks" });
    }

    if (assignedTo) {
      const assigneeInProject = await pool.query(
        `
          SELECT 1
          FROM project_members
          WHERE project_id = $1 AND user_id = $2
        `,
        [projectId, assignedTo]
      );
      if (assigneeInProject.rows.length === 0) {
        return res.status(400).json({ message: "Assignee must be a project member" });
      }
    }

    const { rows } = await pool.query(
      `
        INSERT INTO tasks (
          project_id, title, description, status, due_date, assigned_to, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [projectId, title, description, status, dueDate, assignedTo, req.user.id]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("Create task error:", error);
    return res.status(500).json({ message: "Failed to create task" });
  }
});

app.patch("/api/tasks/:taskId", authRequired, async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const taskResult = await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }

    const existingTask = taskResult.rows[0];
    const canManage = await canManageProject(req.user, existingTask.project_id);
    const isAssignee = existingTask.assigned_to === req.user.id;

    if (!canManage && !isAssignee) {
      return res.status(403).json({ message: "No access to modify this task" });
    }

    const title =
      req.body.title !== undefined ? String(req.body.title).trim() : existingTask.title;
    const description =
      req.body.description !== undefined
        ? String(req.body.description).trim()
        : existingTask.description;
    const status =
      req.body.status !== undefined
        ? normalizeStatus(req.body.status)
        : existingTask.status;

    if (!status) {
      return res.status(400).json({ message: "Invalid task status" });
    }
    if (title.length < 2 || title.length > 140) {
      return res.status(400).json({ message: "Task title must be 2-140 characters" });
    }

    let assignedTo = existingTask.assigned_to;
    if (req.body.assignedTo !== undefined) {
      if (!canManage) {
        return res.status(403).json({ message: "Only project admins can reassign tasks" });
      }
      if (req.body.assignedTo === null || req.body.assignedTo === "") {
        assignedTo = null;
      } else {
        assignedTo = Number(req.body.assignedTo);
        if (!Number.isInteger(assignedTo)) {
          return res.status(400).json({ message: "Invalid assignee id" });
        }

        const assigneeInProject = await pool.query(
          `
            SELECT 1
            FROM project_members
            WHERE project_id = $1 AND user_id = $2
          `,
          [existingTask.project_id, assignedTo]
        );
        if (assigneeInProject.rows.length === 0) {
          return res.status(400).json({ message: "Assignee must be a project member" });
        }
      }
    }

    let dueDate = existingTask.due_date;
    if (req.body.dueDate !== undefined) {
      if (req.body.dueDate === null || req.body.dueDate === "") {
        dueDate = null;
      } else {
        dueDate = parseDateOrNull(req.body.dueDate);
        if (!dueDate) {
          return res.status(400).json({ message: "Invalid due date" });
        }
      }
    }

    const { rows } = await pool.query(
      `
        UPDATE tasks
        SET title = $1, description = $2, status = $3, due_date = $4, assigned_to = $5
        WHERE id = $6
        RETURNING *
      `,
      [title, description, status, dueDate, assignedTo, taskId]
    );

    return res.json(rows[0]);
  } catch (error) {
    console.error("Update task error:", error);
    return res.status(500).json({ message: "Failed to update task" });
  }
});

app.get("/api/dashboard", authRequired, async (req, res) => {
  try {
    let tasksQuery;
    let tasksParams;

    if (req.user.role === "ADMIN") {
      tasksQuery = `
        SELECT t.*, p.name AS project_name, assignee.name AS assignee_name
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
        LEFT JOIN users assignee ON assignee.id = t.assigned_to
      `;
      tasksParams = [];
    } else {
      tasksQuery = `
        SELECT t.*, p.name AS project_name, assignee.name AS assignee_name
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
        LEFT JOIN users assignee ON assignee.id = t.assigned_to
        INNER JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = $1
      `;
      tasksParams = [req.user.id];
    }

    const { rows } = await pool.query(tasksQuery, tasksParams);
    const today = new Date().toISOString().slice(0, 10);

    const total = rows.length;
    const todo = rows.filter((task) => task.status === "TODO").length;
    const inProgress = rows.filter((task) => task.status === "IN_PROGRESS").length;
    const done = rows.filter((task) => task.status === "DONE").length;
    const overdue = rows.filter(
      (task) =>
        task.status !== "DONE" &&
        task.due_date &&
        new Date(task.due_date).toISOString().slice(0, 10) < today
    ).length;

    return res.json({
      summary: { total, todo, inProgress, done, overdue },
      tasks: rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ message: "Failed to load dashboard" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

async function startServer() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
