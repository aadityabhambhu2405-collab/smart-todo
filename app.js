// ============================================================
// app.js — TaskFlow Frontend JavaScript
// BCA 1st Year College Project
// ============================================================

const API = '';  // Same origin — backend is at localhost:3000

// ── State ────────────────────────────────────────────────────
let token       = localStorage.getItem('tf_token') || '';
let currentUser = JSON.parse(localStorage.getItem('tf_user') || 'null');
let currentFilter   = 'all';
let currentPriority = 'all';
let currentCategory = null;
let editingTaskId   = null;
let searchTimeout   = null;
let categories      = [];

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token && currentUser) {
    showApp();
  }
  // Enter key listeners for auth forms
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('reg-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });
});

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
function toggleAuth() {
  const login = document.getElementById('login-form');
  const reg   = document.getElementById('register-form');
  if (login.classList.contains('active')) {
    login.classList.remove('active');
    reg.classList.add('active');
  } else {
    reg.classList.remove('active');
    login.classList.add('active');
  }
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');

  if (!email || !password) {
    showError(errEl, 'Please fill in all fields');
    return;
  }

  try {
    const res  = await apiFetch('/api/auth/login', 'POST', { email, password });
    const data = await res.json();
    if (!res.ok) { showError(errEl, data.error); return; }
    setSession(data);
    showApp();
  } catch {
    showError(errEl, 'Connection error. Is the server running?');
  }
}

async function handleRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('reg-error');
  errEl.classList.add('hidden');

  if (!username || !email || !password) {
    showError(errEl, 'Please fill in all fields');
    return;
  }

  try {
    const res  = await apiFetch('/api/auth/register', 'POST', { username, email, password });
    const data = await res.json();
    if (!res.ok) { showError(errEl, data.error); return; }
    setSession(data);
    showApp();
  } catch {
    showError(errEl, 'Connection error. Is the server running?');
  }
}

function setSession(data) {
  token = data.token;
  currentUser = { username: data.username, email: data.email, userId: data.userId };
  localStorage.setItem('tf_token', token);
  localStorage.setItem('tf_user', JSON.stringify(currentUser));
}

function logout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('tf_token');
  localStorage.removeItem('tf_user');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-form').classList.add('active');
  document.getElementById('register-form').classList.remove('active');
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Set user info
  document.getElementById('sidebar-username').textContent = currentUser.username;
  document.getElementById('sidebar-email').textContent    = currentUser.email;
  document.getElementById('sidebar-avatar').textContent   = currentUser.username[0].toUpperCase();

  loadCategories();
  loadStats();
  loadTasks();
}

// ─────────────────────────────────────────────────────────────
//  FILTERS & SORT
// ─────────────────────────────────────────────────────────────
function setFilter(filter, el) {
  currentFilter   = filter;
  currentCategory = null;
  currentPriority = 'all';

  document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
  el.classList.add('active');

  document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.pf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.p === 'all');
  });

  const titles = {
    all: 'All Tasks', today: 'Due Today', pending: 'Pending',
    completed: 'Completed', overdue: '⚠ Overdue'
  };
  document.getElementById('page-title').textContent = titles[filter] || 'Tasks';
  loadTasks();
}

function setPriority(p, el) {
  currentPriority = p;
  document.querySelectorAll('.pf-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadTasks();
}

function filterByCategory(name, el) {
  currentFilter   = 'all';
  currentCategory = name;
  document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
  document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('page-title').textContent = '# ' + name;
  loadTasks();
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadTasks, 350);
}

// ─────────────────────────────────────────────────────────────
//  TASKS — LOAD & RENDER
// ─────────────────────────────────────────────────────────────
async function loadTasks() {
  const list     = document.getElementById('task-list');
  const empty    = document.getElementById('empty-state');
  const loading  = document.getElementById('loading');
  const search   = document.getElementById('search-input').value.trim();
  const sort     = document.getElementById('sort-select').value;

  loading.classList.remove('hidden');
  list.innerHTML = '';
  empty.classList.add('hidden');

  const params = new URLSearchParams({ filter: currentFilter, sort });
  if (currentPriority !== 'all') params.set('priority', currentPriority);
  if (currentCategory) params.set('category', currentCategory);
  if (search) params.set('search', search);

  try {
    const res   = await apiFetch(`/api/tasks?${params}`);
    const tasks = await res.json();
    loading.classList.add('hidden');

    if (!Array.isArray(tasks) || tasks.length === 0) {
      empty.classList.remove('hidden');
      updateProgress(0, 0);
      return;
    }

    tasks.forEach(t => list.appendChild(renderTask(t)));
    updateProgress(tasks.filter(t => t.completed).length, tasks.length);
  } catch {
    loading.classList.add('hidden');
    toast('Failed to load tasks', 'error');
  }
}

function renderTask(t) {
  const card = document.createElement('div');
  card.className = `task-card ${t.priority}${t.completed ? ' completed' : ''}${t.pinned ? ' pinned' : ''}`;
  card.dataset.id = t.id;

  const dueLabel  = getDueLabel(t.due_date, t.completed);
  const subLabel  = t.subtask_count > 0
    ? `<span class="subtask-progress" onclick="openSubtaskModal(${t.id}, '${escHtml(t.title)}')" title="View subtasks">
        ☑ ${t.subtask_done}/${t.subtask_count} subtasks
       </span>` : '';

  card.innerHTML = `
    <button class="task-check ${t.completed ? 'checked' : ''}" 
      onclick="toggleTask(${t.id}, this)" title="Toggle complete">
      ${t.completed ? '✓' : ''}
    </button>
    <div class="task-body">
      <div class="task-title">${escHtml(t.title)}</div>
      ${t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
      <div class="task-meta">
        <span class="task-tag tag-priority ${t.priority}">${t.priority.toUpperCase()}</span>
        ${t.category && t.category !== 'General' ? `<span class="task-tag tag-cat">${escHtml(t.category)}</span>` : ''}
        ${dueLabel}
        ${t.pinned ? '<span class="task-tag tag-pin">📌 Pinned</span>' : ''}
        ${subLabel}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-btn ${t.pinned ? 'pin-on' : ''}" 
        onclick="togglePin(${t.id})" title="${t.pinned ? 'Unpin' : 'Pin'}">📌</button>
      <button class="task-btn" onclick="openEditModal(${t.id})" title="Edit">✎</button>
      <button class="task-btn delete" onclick="deleteTask(${t.id})" title="Delete">🗑</button>
    </div>
  `;
  return card;
}

function getDueLabel(due, completed) {
  if (!due) return '';
  const today  = new Date(); today.setHours(0,0,0,0);
  const dueD   = new Date(due); dueD.setHours(0,0,0,0);
  const diff   = Math.round((dueD - today) / (1000*60*60*24));
  let cls = 'tag-due';
  let label = `📅 ${formatDate(due)}`;

  if (!completed) {
    if (diff < 0)  { cls = 'tag-due overdue'; label = `⚠ Overdue (${formatDate(due)})`; }
    else if (diff === 0) { cls = 'tag-due today'; label = '🕐 Due today'; }
    else if (diff === 1) { label = '📅 Tomorrow'; }
  }
  return `<span class="${cls}">${label}</span>`;
}

function formatDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`;
}

function updateProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${pct}% complete (${done}/${total})`;
}

// ─────────────────────────────────────────────────────────────
//  TASK ACTIONS
// ─────────────────────────────────────────────────────────────
async function toggleTask(id, btn) {
  try {
    const res  = await apiFetch(`/api/tasks/${id}/toggle`, 'PATCH');
    const data = await res.json();
    const card = btn.closest('.task-card');

    btn.classList.toggle('checked', data.completed);
    btn.innerHTML = data.completed ? '✓' : '';
    card.classList.toggle('completed', data.completed);

    toast(data.completed ? '✓ Task completed!' : 'Task reopened', 'success');
    loadStats();
    // Refresh progress
    setTimeout(loadTasks, 300);
  } catch {
    toast('Failed to update task', 'error');
  }
}

async function togglePin(id) {
  const card  = document.querySelector(`.task-card[data-id="${id}"]`);
  const isPinned = card.classList.contains('pinned');
  try {
    await apiFetch(`/api/tasks/${id}`, 'PUT', { pinned: !isPinned });
    toast(isPinned ? 'Unpinned' : '📌 Pinned to top', 'success');
    loadTasks();
  } catch {
    toast('Failed to update', 'error');
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await apiFetch(`/api/tasks/${id}`, 'DELETE');
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
      card.style.animation = 'none';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      card.style.transition = 'all 0.25s';
      setTimeout(() => card.remove(), 250);
    }
    toast('Task deleted', 'success');
    loadStats();
  } catch {
    toast('Failed to delete task', 'error');
  }
}

// ─────────────────────────────────────────────────────────────
//  TASK MODAL — CREATE / EDIT
// ─────────────────────────────────────────────────────────────
function openTaskModal() {
  editingTaskId = null;
  document.getElementById('modal-title').textContent = 'New Task';
  document.getElementById('modal-save-btn').textContent = 'Save Task';
  clearTaskForm();
  populateCategorySelect();
  document.getElementById('task-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('task-title').focus(), 100);
}

async function openEditModal(id) {
  editingTaskId = id;
  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('modal-save-btn').textContent = 'Update Task';

  try {
    const res  = await apiFetch(`/api/tasks?filter=all`);
    const tasks = await res.json();
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    populateCategorySelect();
    document.getElementById('task-title').value    = task.title;
    document.getElementById('task-desc').value     = task.description || '';
    document.getElementById('task-priority').value = task.priority;
    document.getElementById('task-due').value      = task.due_date || '';

    // Wait for category select to populate
    setTimeout(() => {
      document.getElementById('task-category').value = task.category || 'General';
    }, 50);

    // Load subtasks
    const subRes  = await apiFetch(`/api/tasks/${id}/subtasks`);
    const subs    = await subRes.json();
    const subCont = document.getElementById('subtask-inputs');
    subCont.innerHTML = '';
    if (subs.length > 0) {
      subs.forEach(s => addSubtaskInput(s.title));
    } else {
      addSubtaskInput();
    }

    document.getElementById('task-modal').classList.remove('hidden');
  } catch {
    toast('Failed to load task details', 'error');
  }
}

function clearTaskForm() {
  document.getElementById('task-title').value    = '';
  document.getElementById('task-desc').value     = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-due').value      = '';
  document.getElementById('subtask-inputs').innerHTML = `
    <div class="subtask-row">
      <input type="text" placeholder="Add a subtask..." class="subtask-inp" />
      <button onclick="addSubtaskInput()" class="btn-sub-add">＋</button>
    </div>`;
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

function addSubtaskInput(value = '') {
  const cont = document.getElementById('subtask-inputs');
  const row  = document.createElement('div');
  row.className = 'subtask-row';
  row.innerHTML = `
    <input type="text" placeholder="Add a subtask..." class="subtask-inp" value="${escHtml(value)}" />
    <button onclick="removeSubtaskRow(this)" class="btn-sub-add" style="color:var(--high)">−</button>`;
  cont.appendChild(row);
  row.querySelector('input').focus();
}

function removeSubtaskRow(btn) {
  const row = btn.closest('.subtask-row');
  const cont = document.getElementById('subtask-inputs');
  if (cont.children.length > 1) row.remove();
  else row.querySelector('input').value = '';
}

function populateCategorySelect() {
  const sel = document.getElementById('task-category');
  sel.innerHTML = '<option value="General">General</option>';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

async function saveTask() {
  const title    = document.getElementById('task-title').value.trim();
  const desc     = document.getElementById('task-desc').value.trim();
  const priority = document.getElementById('task-priority').value;
  const category = document.getElementById('task-category').value;
  const due_date = document.getElementById('task-due').value || null;

  if (!title) {
    document.getElementById('task-title').focus();
    toast('Please enter a task title', 'error');
    return;
  }

  // Collect subtasks
  const subtasks = Array.from(document.querySelectorAll('.subtask-inp'))
    .map(i => i.value.trim()).filter(Boolean);

  const btn = document.getElementById('modal-save-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    let res;
    if (editingTaskId) {
      res = await apiFetch(`/api/tasks/${editingTaskId}`, 'PUT', {
        title, description: desc, priority, category, due_date
      });
    } else {
      res = await apiFetch('/api/tasks', 'POST', {
        title, description: desc, priority, category, due_date, subtasks
      });
    }

    if (!res.ok) {
      const err = await res.json();
      toast(err.error || 'Failed to save', 'error');
    } else {
      closeTaskModal();
      toast(editingTaskId ? '✓ Task updated!' : '✓ Task created!', 'success');
      loadTasks();
      loadStats();
    }
  } catch {
    toast('Connection error', 'error');
  } finally {
    btn.textContent = editingTaskId ? 'Update Task' : 'Save Task';
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  SUBTASK MODAL
// ─────────────────────────────────────────────────────────────
async function openSubtaskModal(taskId, taskTitle) {
  document.getElementById('subtask-modal-title').textContent = taskTitle;
  const view = document.getElementById('subtask-list-view');
  view.innerHTML = '<div style="color:var(--text3);padding:16px 0;">Loading...</div>';
  document.getElementById('subtask-modal').classList.remove('hidden');

  try {
    const res  = await apiFetch(`/api/tasks/${taskId}/subtasks`);
    const subs = await res.json();
    view.innerHTML = '';

    if (subs.length === 0) {
      view.innerHTML = '<div style="color:var(--text3);padding:12px 0;">No subtasks</div>';
      return;
    }

    subs.forEach(s => {
      const item = document.createElement('div');
      item.className = 'subtask-view-item';
      item.innerHTML = `
        <button class="sub-check ${s.completed ? 'checked' : ''}" 
          onclick="toggleSubtask(${s.id}, this)" data-subid="${s.id}">
          ${s.completed ? '✓' : ''}
        </button>
        <span class="sub-title ${s.completed ? 'done' : ''}" id="sub-title-${s.id}">${escHtml(s.title)}</span>
      `;
      view.appendChild(item);
    });
  } catch {
    view.innerHTML = '<div style="color:var(--high);">Failed to load</div>';
  }
}

function closeSubtaskModal() {
  document.getElementById('subtask-modal').classList.add('hidden');
  loadTasks(); // Refresh to update subtask progress
}

async function toggleSubtask(id, btn) {
  try {
    const res  = await apiFetch(`/api/subtasks/${id}/toggle`, 'PATCH');
    const data = await res.json();
    btn.classList.toggle('checked', data.completed);
    btn.innerHTML = data.completed ? '✓' : '';
    const title = document.getElementById(`sub-title-${id}`);
    if (title) title.className = `sub-title ${data.completed ? 'done' : ''}`;
  } catch {
    toast('Failed to update subtask', 'error');
  }
}

// ─────────────────────────────────────────────────────────────
//  CATEGORIES
// ─────────────────────────────────────────────────────────────
async function loadCategories() {
  try {
    const res  = await apiFetch('/api/categories');
    categories = await res.json();
    renderCategories();
  } catch {
    console.warn('Failed to load categories');
  }
}

function renderCategories() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  categories.forEach(c => {
    const item = document.createElement('div');
    item.className = 'cat-item';
    item.innerHTML = `
      <span class="cat-dot" style="background:${c.color}"></span>
      <span class="cat-name">${escHtml(c.name)}</span>
      <button class="cat-del" onclick="deleteCategory(${c.id}, event)" title="Delete">✕</button>
    `;
    item.addEventListener('click', () => filterByCategory(c.name, item));
    list.appendChild(item);
  });
}

function openCatModal()  { document.getElementById('cat-modal').classList.remove('hidden'); }
function closeCatModal() { document.getElementById('cat-modal').classList.add('hidden'); }

async function saveCategory() {
  const name  = document.getElementById('cat-name').value.trim();
  const color = document.getElementById('cat-color').value;
  if (!name) { toast('Category name required', 'error'); return; }

  try {
    const res = await apiFetch('/api/categories', 'POST', { name, color });
    if (res.ok) {
      closeCatModal();
      document.getElementById('cat-name').value = '';
      await loadCategories();
      toast('Category added', 'success');
    }
  } catch {
    toast('Failed to add category', 'error');
  }
}

async function deleteCategory(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this category?')) return;
  await apiFetch(`/api/categories/${id}`, 'DELETE');
  await loadCategories();
  toast('Category deleted', 'success');
}

// ─────────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await apiFetch('/api/stats');
    const data = await res.json();

    document.getElementById('stat-total').textContent   = data.total;
    document.getElementById('stat-done').textContent    = data.completed;
    document.getElementById('stat-pending').textContent = data.pending;

    document.getElementById('badge-all').textContent     = data.total;
    document.getElementById('badge-today').textContent   = data.today;
    document.getElementById('badge-pending').textContent = data.pending;
    document.getElementById('badge-done').textContent    = data.completed;
    document.getElementById('badge-overdue').textContent = data.overdue;

    // Show overdue badge in red if there are overdue tasks
    const overdueEl = document.getElementById('badge-overdue');
    overdueEl.classList.toggle('danger', data.overdue > 0);
  } catch {
    console.warn('Failed to load stats');
  }
}

// ─────────────────────────────────────────────────────────────
//  SIDEBAR TOGGLE (MOBILE)
// ─────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Close sidebar when clicking outside (mobile)
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('sidebar');
  const hamburger = document.querySelector('.hamburger');
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !hamburger.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// ─────────────────────────────────────────────────────────────
//  MODAL KEYBOARD HANDLER
// ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTaskModal();
    closeSubtaskModal();
    closeCatModal();
  }
  // Ctrl+N = new task
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openTaskModal();
  }
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeTaskModal();
      closeSubtaskModal();
      closeCatModal();
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
async function apiFetch(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + url, opts);
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}
