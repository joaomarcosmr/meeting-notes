// Painel da menu bar: lista de tarefas pendentes + gravar/parar + menu de opções.

const $ = (id) => document.getElementById(id);

let filter = 'all';
let phase = 'idle';
let startedAt = null;
let tick = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clock(totalSeconds) {
  const s = Math.floor(totalSeconds);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
}

// ---- Tarefas --------------------------------------------------------------

function taskItem(task) {
  const li = el('li', undefined, task.minha ? 'task mine' : 'task');

  const box = el('input');
  box.type = 'checkbox';
  box.title = 'Concluir';
  box.addEventListener('change', async () => {
    li.classList.add('leaving'); // some da lista: aqui só ficam as pendentes
    if (task.manual) await window.api.updateManualTask(task.id, { concluida: true });
    else await window.api.updateTask(task.meetingId, task.index, { concluida: true });
  });

  const body = el('div', undefined, 'body');
  body.append(el('div', task.descricao, 'text'));
  const meta = el('div', undefined, 'meta');
  if (task.prazo) meta.append(el('span', `📅 ${task.prazo}`));
  if (!task.minha && task.responsavel) meta.append(el('span', `👤 ${task.responsavel}`));
  if (task.meetingId) {
    const link = el('button', task.meetingTitle);
    link.title = 'Abrir a reunião';
    link.addEventListener('click', () => window.api.openMeeting(task.meetingId));
    meta.append(link);
  }
  if (meta.childElementCount) body.append(meta);

  li.append(box, body);
  if (task.manual) {
    const remove = el('button', '×', 'remove');
    remove.title = 'Apagar';
    remove.addEventListener('click', () => window.api.removeManualTask(task.id));
    li.append(remove);
  }
  return li;
}

async function render() {
  const tasks = await window.api.listOpenTasks();
  const mine = tasks.filter((t) => t.minha);
  $('count').textContent = mine.length || '';

  const visible = filter === 'mine' ? mine : tasks;
  const list = $('list');
  list.replaceChildren();
  if (!visible.length) {
    list.append(el('li', filter === 'mine' ? 'Nenhuma tarefa sua pendente 🎉\nAdicione uma acima ou grave uma reunião.' : 'Nenhuma tarefa pendente 🎉', 'empty'));
    return;
  }
  visible.forEach((task) => list.append(taskItem(task)));
}

$('add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('add-input');
  if (!input.value.trim()) return;
  await window.api.addTask(input.value);
  input.value = '';
});

for (const button of document.querySelectorAll('.filter button')) {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter button').forEach((b) => b.classList.toggle('active', b === button));
    render();
  });
}

window.api.onTasksChanged(render);
window.api.onPopoverShown(() => {
  render();
  $('add-input').focus();
});

// ---- Gravação -------------------------------------------------------------

function renderRecord() {
  const button = $('record');
  button.classList.toggle('recording', phase === 'recording');
  button.disabled = phase === 'processing';
  clearInterval(tick);
  if (phase === 'recording') {
    const update = () => ($('record-label').textContent = `Parar e resumir · ${clock((Date.now() - startedAt) / 1000)}`);
    update();
    tick = setInterval(update, 1000);
  } else {
    $('record-label').textContent = phase === 'processing' ? 'Resumindo a reunião…' : 'Gravar reunião';
  }
}

window.api.onState((next) => {
  phase = next.phase;
  startedAt = next.startedAt;
  renderRecord();
});

$('record').addEventListener('click', () => window.api.toggle({ show: false }));
$('menu-button').addEventListener('click', () => window.api.showTrayMenu());
$('open-main').addEventListener('click', () => window.api.showMain());
$('open-tasks').addEventListener('click', () => window.api.showMain('tasks'));

(async () => {
  const state = await window.api.getState();
  phase = state.phase;
  startedAt = state.startedAt;
  renderRecord();
  render();
})();
