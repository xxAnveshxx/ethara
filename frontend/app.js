const state = {
  token: localStorage.getItem("ethara_token") || "",
  user: null,
  projects: [],
  selectedProjectId: null,
  selectedProjectData: null,
  users: []
};

const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");
const welcomeText = document.getElementById("welcomeText");
const projectList = document.getElementById("projectList");
const projectDetails = document.getElementById("projectDetails");
const dashboardCards = document.getElementById("dashboardCards");
const taskBoard = document.getElementById("taskBoard");
const projectForm = document.getElementById("projectForm");
const memberForm = document.getElementById("memberForm");
const taskForm = document.getElementById("taskForm");
const toast = document.getElementById("toast");

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = isError ? "#942f2f" : "#122223";
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function statusBadge(status) {
  if (status === "DONE") return `<span class="badge b-done">Done</span>`;
  if (status === "IN_PROGRESS") return `<span class="badge b-progress">In Progress</span>`;
  return `<span class="badge b-todo">Todo</span>`;
}

function isOverdue(task) {
  if (task.status === "DONE" || !task.due_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(task.due_date).toISOString().slice(0, 10);
  return due < today;
}

function formatDate(dateString) {
  if (!dateString) return "No due date";
  return new Date(dateString).toLocaleDateString();
}

function renderDashboard(summary) {
  dashboardCards.innerHTML = "";
  const items = [
    ["Total Tasks", summary.total],
    ["Todo", summary.todo],
    ["In Progress", summary.inProgress],
    ["Done", summary.done],
    ["Overdue", summary.overdue]
  ];

  for (const [label, value] of items) {
    const div = document.createElement("div");
    div.className = "stat-card";
    div.innerHTML = `<h4>${label}</h4><p>${value}</p>`;
    dashboardCards.appendChild(div);
  }
}

function renderProjects() {
  projectList.innerHTML = "";
  if (state.projects.length === 0) {
    projectList.innerHTML = `<p class="subtle">No projects yet.</p>`;
    return;
  }

  for (const project of state.projects) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <h4>${project.name}</h4>
      <p class="subtle">${project.description || "No description"}</p>
      <div class="status-row">
        <span class="badge b-todo">Tasks: ${project.task_count || 0}</span>
        <span class="badge b-overdue">Overdue: ${project.overdue_count || 0}</span>
      </div>
    `;
    div.style.cursor = "pointer";
    div.onclick = () => selectProject(project.id);
    projectList.appendChild(div);
  }
}

function renderProjectDetails() {
  const data = state.selectedProjectData;
  if (!data) {
    projectDetails.textContent = "No project selected.";
    return;
  }

  const membersHtml = data.members
    .map(
      (m) =>
        `<li>${m.name} (${m.email}) - <strong>${m.project_role}</strong> / global ${m.global_role}</li>`
    )
    .join("");

  const tasksHtml =
    data.tasks.length === 0
      ? `<p class="subtle">No tasks in this project yet.</p>`
      : data.tasks
          .map((t) => {
            const overdueBadge = isOverdue(t)
              ? `<span class="badge b-overdue">Overdue</span>`
              : "";
            return `
              <div class="item">
                <h4>${t.title}</h4>
                <p class="subtle">${t.description || "No description"}</p>
                <div class="status-row">
                  ${statusBadge(t.status)}
                  ${overdueBadge}
                  <span class="subtle">Assignee: ${t.assignee_name || "Unassigned"}</span>
                  <span class="subtle">Due: ${formatDate(t.due_date)}</span>
                </div>
              </div>
            `;
          })
          .join("");

  projectDetails.innerHTML = `
    <div class="item">
      <h4>${data.project.name}</h4>
      <p class="subtle">${data.project.description || "No description"}</p>
      <h4>Members</h4>
      <ul>${membersHtml || "<li>No members yet</li>"}</ul>
      <h4>Tasks</h4>
      <div class="list">${tasksHtml}</div>
    </div>
  `;

  const memberSelect = memberForm.querySelector('select[name="userId"]');
  memberSelect.innerHTML = state.users
    .map((u) => `<option value="${u.id}">${u.name} (${u.email})</option>`)
    .join("");

  const assigneeSelect = taskForm.querySelector('select[name="assignedTo"]');
  assigneeSelect.innerHTML = `<option value="">Unassigned</option>` +
    data.members
      .map((m) => `<option value="${m.id}">${m.name} (${m.project_role})</option>`)
      .join("");
}

function renderTaskBoard(tasks) {
  taskBoard.innerHTML = "";
  if (!tasks.length) {
    taskBoard.innerHTML = `<p class="subtle">No tasks available.</p>`;
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "item";
    const overdueBadge = isOverdue(task) ? `<span class="badge b-overdue">Overdue</span>` : "";
    row.innerHTML = `
      <h4>${task.title}</h4>
      <p class="subtle">${task.project_name}</p>
      <div class="status-row">
        ${statusBadge(task.status)}
        ${overdueBadge}
        <span class="subtle">Assignee: ${task.assignee_name || "Unassigned"}</span>
        <span class="subtle">Due: ${formatDate(task.due_date)}</span>
      </div>
      <div class="status-row">
        <label>Update status</label>
        <select class="inline-select" data-task-id="${task.id}">
          <option value="TODO" ${task.status === "TODO" ? "selected" : ""}>TODO</option>
          <option value="IN_PROGRESS" ${task.status === "IN_PROGRESS" ? "selected" : ""}>IN_PROGRESS</option>
          <option value="DONE" ${task.status === "DONE" ? "selected" : ""}>DONE</option>
        </select>
      </div>
    `;
    taskBoard.appendChild(row);
  }

  taskBoard.querySelectorAll("select[data-task-id]").forEach((select) => {
    select.addEventListener("change", async () => {
      const taskId = select.getAttribute("data-task-id");
      try {
        await api(`/api/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value })
        });
        showToast("Task status updated");
        await loadDashboard();
        if (state.selectedProjectId) {
          await selectProject(state.selectedProjectId);
        }
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

async function loadCurrentUser() {
  state.user = await api("/api/auth/me");
  welcomeText.textContent = `Welcome ${state.user.name} (${state.user.role})`;

  if (state.user.role === "ADMIN") {
    projectForm.classList.remove("hidden");
    memberForm.classList.remove("hidden");
    taskForm.classList.remove("hidden");
    try {
      state.users = await api("/api/users");
    } catch (error) {
      state.users = [];
      showToast(error.message, true);
    }
  } else {
    projectForm.classList.add("hidden");
    memberForm.classList.add("hidden");
    taskForm.classList.add("hidden");
  }
}

async function loadProjects() {
  state.projects = await api("/api/projects");
  renderProjects();
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  renderDashboard(data.summary);
  renderTaskBoard(data.tasks);
}

async function selectProject(projectId) {
  state.selectedProjectId = projectId;
  state.selectedProjectData = await api(`/api/projects/${projectId}`);
  renderProjectDetails();
}

async function initializeApp() {
  if (!state.token) {
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    return;
  }

  try {
    await loadCurrentUser();
    await Promise.all([loadProjects(), loadDashboard()]);
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
  } catch (error) {
    localStorage.removeItem("ethara_token");
    state.token = "";
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    showToast("Session expired. Please login again.", true);
  }
}

document.getElementById("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        role: form.get("role")
      })
    });
    state.token = data.token;
    localStorage.setItem("ethara_token", data.token);
    showToast("Account created");
    await initializeApp();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password")
      })
    });
    state.token = data.token;
    localStorage.setItem("ethara_token", data.token);
    showToast("Login successful");
    await initializeApp();
  } catch (error) {
    showToast(error.message, true);
  }
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description")
      })
    });
    event.target.reset();
    showToast("Project created");
    await loadProjects();
  } catch (error) {
    showToast(error.message, true);
  }
});

memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedProjectId) {
    showToast("Select a project first", true);
    return;
  }
  const form = new FormData(event.target);
  try {
    await api(`/api/projects/${state.selectedProjectId}/members`, {
      method: "POST",
      body: JSON.stringify({
        userId: Number(form.get("userId")),
        role: form.get("role")
      })
    });
    showToast("Member updated");
    await selectProject(state.selectedProjectId);
  } catch (error) {
    showToast(error.message, true);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedProjectId) {
    showToast("Select a project first", true);
    return;
  }
  const form = new FormData(event.target);
  try {
    await api(`/api/projects/${state.selectedProjectId}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        assignedTo: form.get("assignedTo") ? Number(form.get("assignedTo")) : null,
        dueDate: form.get("dueDate") || null
      })
    });
    event.target.reset();
    showToast("Task created");
    await Promise.all([loadDashboard(), selectProject(state.selectedProjectId), loadProjects()]);
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  state.token = "";
  state.user = null;
  state.projects = [];
  state.selectedProjectId = null;
  state.selectedProjectData = null;
  localStorage.removeItem("ethara_token");
  authSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  showToast("Logged out");
});

initializeApp();
