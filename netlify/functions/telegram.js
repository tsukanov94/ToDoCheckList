// netlify/functions/telegram.js
// Telegram-бот, работающий с теми же данными, что и PWA (через _lib/store.js -> Netlify Blobs).
// Личное использование: доступ ограничен одним Telegram-пользователем (ALLOWED_USER_ID).

const { readData, writeData, uid, sessionGet, sessionSet } = require('./_lib/store');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID ? String(process.env.ALLOWED_USER_ID) : null;

const CAT_PALETTE = ['#3D6B5C', '#E8A23B', '#C1443B', '#4A6FA5', '#8C5AA8', '#3A9188'];
const PRIORITIES = [
  { v: 'low', label: '🟢 Низкий' },
  { v: 'medium', label: '🟡 Средний' },
  { v: 'high', label: '🔴 Высокий' },
];

function api(method) {
  return `https://api.telegram.org/bot${TOKEN}/${method}`;
}
async function tg(method, payload) {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}
function sendMessage(chatId, text, keyboard) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}
function editMessage(chatId, messageId, text, keyboard) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : { inline_keyboard: [] },
  });
}
function answerCallback(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || undefined });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
function todayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function catName(data, id) {
  const c = data.categories.find((x) => x.id === id);
  return c ? c.name : 'Без категории';
}
function prioLabel(v) {
  const p = PRIORITIES.find((x) => x.v === v);
  return p ? p.label : PRIORITIES[1].label;
}

// ---------- Экраны ----------

function mainMenu(data) {
  const text =
    `🏠 <b>Планировщик</b>\n\n` +
    `Задач: ${data.tasks.length} (активных: ${data.tasks.filter((t) => !t.done).length})\n` +
    `Категорий: ${data.categories.length}`;
  const kb = [
    [{ text: '📋 Список задач', callback_data: 'list:all' }],
    [{ text: '➕ Новая задача', callback_data: 'newtask' }],
    [{ text: '🗂 Категории', callback_data: 'cats' }],
  ];
  return { text, kb };
}

function taskLine(t, data) {
  const box = t.done ? '✅' : '☐';
  const cat = t.categoryId ? ` · ${esc(catName(data, t.categoryId))}` : '';
  const date = t.date ? ` · ${t.date}` : '';
  return `${box} ${esc(t.title)}${cat}${date}`;
}

function listScreen(data, filter) {
  let tasks = data.tasks.slice();
  if (filter === 'active') tasks = tasks.filter((t) => !t.done);
  if (filter === 'done') tasks = tasks.filter((t) => t.done);
  tasks.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  const filterRow = [
    { text: filter === 'all' ? '• Все' : 'Все', callback_data: 'list:all' },
    { text: filter === 'active' ? '• Активные' : 'Активные', callback_data: 'list:active' },
    { text: filter === 'done' ? '• Выполненные' : 'Выполненные', callback_data: 'list:done' },
  ];
  const kb = [filterRow];
  tasks.slice(0, 30).forEach((t) => {
    kb.push([{ text: (t.done ? '✅ ' : '☐ ') + t.title.slice(0, 60), callback_data: 'task:' + t.id }]);
  });
  kb.push([{ text: '➕ Новая задача', callback_data: 'newtask' }]);
  kb.push([{ text: '🏠 Меню', callback_data: 'menu' }]);

  const text = tasks.length
    ? `📋 <b>Задачи</b> (${tasks.length})`
    : '📋 <b>Задачи</b>\n\nПусто. Добавьте первую задачу.';
  return { text, kb };
}

function taskScreen(task, data) {
  const lines = [`📌 <b>${esc(task.title)}</b>`];
  if (task.notes) lines.push('📝 ' + esc(task.notes));
  lines.push('🗂 ' + esc(catName(data, task.categoryId)));
  lines.push('🚩 ' + prioLabel(task.priority));
  lines.push('📅 ' + (task.date ? task.date : 'без даты') + (task.time ? ` ⏰ ${task.time}` : ''));
  const cl = task.checklist || [];
  if (cl.length) {
    const doneCount = cl.filter((i) => i.done).length;
    lines.push(`☑️ Чек-лист: ${doneCount}/${cl.length}`);
  }
  lines.push(task.done ? '\n✅ Выполнена' : '\n⏳ Не выполнена');

  const kb = [
    [{ text: task.done ? '↩️ Вернуть в активные' : '✅ Отметить выполненной', callback_data: 'task_toggle:' + task.id }],
    [
      { text: '✏️ Название', callback_data: 'task_edit_title:' + task.id },
      { text: '📝 Заметка', callback_data: 'task_edit_notes:' + task.id },
    ],
    [
      { text: '🗂 Категория', callback_data: 'task_cat:' + task.id },
      { text: '🚩 Приоритет', callback_data: 'task_prio:' + task.id },
    ],
    [
      { text: '📅 Дата', callback_data: 'task_date:' + task.id },
      { text: '⏰ Время', callback_data: 'task_time:' + task.id },
    ],
    [{ text: `☑️ Чек-лист (${cl.length})`, callback_data: 'checklist:' + task.id }],
    [{ text: '🗑 Удалить задачу', callback_data: 'task_del_confirm:' + task.id }],
    [{ text: '◀️ К списку', callback_data: 'list:all' }],
  ];
  return { text: lines.join('\n'), kb };
}

function categoryPickScreen(taskId, data) {
  const kb = data.categories.map((c) => [{ text: c.name, callback_data: `task_setcat:${taskId}:${c.id}` }]);
  kb.push([{ text: 'Без категории', callback_data: `task_setcat:${taskId}:none` }]);
  kb.push([{ text: '◀️ Назад', callback_data: 'task:' + taskId }]);
  return { text: '🗂 Выберите категорию:', kb };
}

function priorityPickScreen(taskId) {
  const kb = PRIORITIES.map((p) => [{ text: p.label, callback_data: `task_setprio:${taskId}:${p.v}` }]);
  kb.push([{ text: '◀️ Назад', callback_data: 'task:' + taskId }]);
  return { text: '🚩 Выберите приоритет:', kb };
}

function datePickScreen(taskId) {
  const kb = [
    [
      { text: 'Сегодня', callback_data: `task_setdate:${taskId}:${todayStr(0)}` },
      { text: 'Завтра', callback_data: `task_setdate:${taskId}:${todayStr(1)}` },
    ],
    [{ text: 'Без даты', callback_data: `task_setdate:${taskId}:none` }],
    [{ text: '✍️ Ввести дату (ГГГГ-ММ-ДД)', callback_data: `task_setdate_manual:${taskId}` }],
    [{ text: '◀️ Назад', callback_data: 'task:' + taskId }],
  ];
  return { text: '📅 Выберите дату:', kb };
}

function timePickScreen(taskId) {
  const kb = [
    [{ text: 'Без времени', callback_data: `task_settime:${taskId}:none` }],
    [{ text: '✍️ Ввести время (ЧЧ:ММ)', callback_data: `task_settime_manual:${taskId}` }],
    [{ text: '◀️ Назад', callback_data: 'task:' + taskId }],
  ];
  return { text: '⏰ Выберите время:', kb };
}

function checklistScreen(task) {
  const cl = task.checklist || [];
  const kb = cl.map((i) => [
    { text: (i.done ? '☑️ ' : '☐ ') + i.text.slice(0, 40), callback_data: `ci_toggle:${task.id}:${i.id}` },
    { text: '🗑', callback_data: `ci_del:${task.id}:${i.id}` },
  ]);
  kb.push([{ text: '➕ Добавить пункт', callback_data: 'ci_add:' + task.id }]);
  kb.push([{ text: '◀️ Назад', callback_data: 'task:' + task.id }]);
  const text = cl.length ? `☑️ <b>Чек-лист:</b> ${esc(task.title)}` : `☑️ <b>Чек-лист пуст.</b>\n${esc(task.title)}`;
  return { text, kb };
}

function catsScreen(data) {
  const kb = data.categories.map((c) => [{ text: '🎨 ' + c.name, callback_data: 'cat:' + c.id }]);
  kb.push([{ text: '➕ Новая категория', callback_data: 'newcat' }]);
  kb.push([{ text: '🏠 Меню', callback_data: 'menu' }]);
  return { text: '🗂 <b>Категории</b>', kb };
}

function catScreen(cat, data) {
  const count = data.tasks.filter((t) => t.categoryId === cat.id).length;
  const text = `🎨 <b>${esc(cat.name)}</b>\nЗадач в категории: ${count}`;
  const kb = [
    [{ text: '✏️ Переименовать', callback_data: 'cat_rename:' + cat.id }],
    [{ text: '🎨 Изменить цвет', callback_data: 'cat_color:' + cat.id }],
    [{ text: '🗑 Удалить категорию', callback_data: 'cat_del_confirm:' + cat.id }],
    [{ text: '◀️ Назад', callback_data: 'cats' }],
  ];
  return { text, kb };
}

function colorPickScreen(catId) {
  const kb = CAT_PALETTE.map((c) => [{ text: c, callback_data: `cat_setcolor:${catId}:${c}` }]);
  kb.push([{ text: '◀️ Назад', callback_data: 'cat:' + catId }]);
  return { text: '🎨 Выберите цвет:', kb };
}

// ---------- Обработка ----------

async function render(chatId, messageId, screen) {
  if (messageId) return editMessage(chatId, messageId, screen.text, screen.kb);
  return sendMessage(chatId, screen.text, screen.kb);
}

async function handleCallback(cbq) {
  const chatId = cbq.message.chat.id;
  const messageId = cbq.message.message_id;
  const data = await readData();
  const [action, a, b] = cbq.data.split(':');

  await answerCallback(cbq.id);

  if (action === 'menu') {
    const m = mainMenu(data);
    return render(chatId, messageId, m);
  }
  if (action === 'list') return render(chatId, messageId, listScreen(data, a));

  if (action === 'newtask') {
    await sessionSet(chatId, { step: 'new_title', draft: {} });
    return sendMessage(chatId, '✍️ Введите название новой задачи:');
  }

  if (action === 'task') {
    const t = data.tasks.find((x) => x.id === a);
    if (!t) return render(chatId, messageId, listScreen(data, 'all'));
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_toggle') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) {
      t.done = !t.done;
      t.completedOn = t.done ? Date.now() : null;
      await writeData(data);
    }
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_edit_title') {
    await sessionSet(chatId, { step: 'edit_title', taskId: a });
    return sendMessage(chatId, '✍️ Введите новое название:');
  }
  if (action === 'task_edit_notes') {
    await sessionSet(chatId, { step: 'edit_notes', taskId: a });
    return sendMessage(chatId, '✍️ Введите заметку (текст):');
  }
  if (action === 'task_cat') return render(chatId, messageId, categoryPickScreen(a, data));
  if (action === 'task_setcat') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) { t.categoryId = b === 'none' ? null : b; await writeData(data); }
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_prio') return render(chatId, messageId, priorityPickScreen(a));
  if (action === 'task_setprio') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) { t.priority = b; await writeData(data); }
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_date') return render(chatId, messageId, datePickScreen(a));
  if (action === 'task_setdate') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) { t.date = b === 'none' ? null : b; await writeData(data); }
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_setdate_manual') {
    await sessionSet(chatId, { step: 'set_date', taskId: a });
    return sendMessage(chatId, '✍️ Введите дату в формате ГГГГ-ММ-ДД (например 2026-09-01):');
  }
  if (action === 'task_time') return render(chatId, messageId, timePickScreen(a));
  if (action === 'task_settime') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) { t.time = b === 'none' ? null : b; await writeData(data); }
    return render(chatId, messageId, taskScreen(t, data));
  }
  if (action === 'task_settime_manual') {
    await sessionSet(chatId, { step: 'set_time', taskId: a });
    return sendMessage(chatId, '✍️ Введите время в формате ЧЧ:ММ (например 18:30):');
  }
  if (action === 'task_del_confirm') {
    const kb = [
      [{ text: '❗ Да, удалить', callback_data: 'task_del:' + a }],
      [{ text: '◀️ Отмена', callback_data: 'task:' + a }],
    ];
    return render(chatId, messageId, { text: '🗑 Удалить задачу без возможности отмены?', kb });
  }
  if (action === 'task_del') {
    data.tasks = data.tasks.filter((x) => x.id !== a);
    await writeData(data);
    return render(chatId, messageId, listScreen(data, 'all'));
  }

  if (action === 'checklist') {
    const t = data.tasks.find((x) => x.id === a);
    if (!t) return render(chatId, messageId, listScreen(data, 'all'));
    return render(chatId, messageId, checklistScreen(t));
  }
  if (action === 'ci_add') {
    await sessionSet(chatId, { step: 'add_checklist_item', taskId: a });
    return sendMessage(chatId, '✍️ Введите текст пункта чек-листа:');
  }
  if (action === 'ci_toggle') {
    const t = data.tasks.find((x) => x.id === a);
    const item = t && (t.checklist || []).find((i) => i.id === b);
    if (item) { item.done = !item.done; await writeData(data); }
    return render(chatId, messageId, checklistScreen(t));
  }
  if (action === 'ci_del') {
    const t = data.tasks.find((x) => x.id === a);
    if (t) { t.checklist = (t.checklist || []).filter((i) => i.id !== b); await writeData(data); }
    return render(chatId, messageId, checklistScreen(t));
  }

  if (action === 'cats') return render(chatId, messageId, catsScreen(data));
  if (action === 'newcat') {
    await sessionSet(chatId, { step: 'new_cat_name' });
    return sendMessage(chatId, '✍️ Введите название новой категории:');
  }
  if (action === 'cat') {
    const c = data.categories.find((x) => x.id === a);
    if (!c) return render(chatId, messageId, catsScreen(data));
    return render(chatId, messageId, catScreen(c, data));
  }
  if (action === 'cat_rename') {
    await sessionSet(chatId, { step: 'rename_cat', catId: a });
    return sendMessage(chatId, '✍️ Введите новое название категории:');
  }
  if (action === 'cat_color') return render(chatId, messageId, colorPickScreen(a));
  if (action === 'cat_setcolor') {
    const c = data.categories.find((x) => x.id === a);
    if (c) { c.color = b; await writeData(data); }
    return render(chatId, messageId, catScreen(c, data));
  }
  if (action === 'cat_del_confirm') {
    const kb = [
      [{ text: '❗ Да, удалить', callback_data: 'cat_del:' + a }],
      [{ text: '◀️ Отмена', callback_data: 'cat:' + a }],
    ];
    return render(chatId, messageId, { text: '🗑 Удалить категорию? Задачи останутся, но без категории.', kb });
  }
  if (action === 'cat_del') {
    data.categories = data.categories.filter((x) => x.id !== a);
    data.tasks.forEach((t) => { if (t.categoryId === a) t.categoryId = null; });
    await writeData(data);
    return render(chatId, messageId, catsScreen(data));
  }
}

async function handleTextStep(chatId, text) {
  const session = await sessionGet(chatId);
  if (!session) return false; // не в сценарии — обработается как обычная команда
  const data = await readData();

  if (session.step === 'new_title') {
    session.draft.title = text.trim();
    session.step = 'new_category';
    await sessionSet(chatId, session);
    const kb = data.categories.map((c) => [{ text: c.name, callback_data: 'draft_cat:' + c.id }]);
    kb.push([{ text: 'Без категории', callback_data: 'draft_cat:none' }]);
    await sendMessage(chatId, '🗂 Выберите категорию:', kb);
    return true;
  }
  if (session.step === 'edit_title') {
    const t = data.tasks.find((x) => x.id === session.taskId);
    if (t) { t.title = text.trim(); await writeData(data); }
    await sessionSet(chatId, null);
    await sendMessage(chatId, '✅ Название обновлено.');
    if (t) await sendMessage(chatId, taskScreen(t, data).text, taskScreen(t, data).kb);
    return true;
  }
  if (session.step === 'edit_notes') {
    const t = data.tasks.find((x) => x.id === session.taskId);
    if (t) { t.notes = text.trim(); await writeData(data); }
    await sessionSet(chatId, null);
    await sendMessage(chatId, '✅ Заметка обновлена.');
    if (t) await sendMessage(chatId, taskScreen(t, data).text, taskScreen(t, data).kb);
    return true;
  }
  if (session.step === 'set_date') {
    const v = text.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { await sendMessage(chatId, '⚠️ Формат должен быть ГГГГ-ММ-ДД. Попробуйте снова:'); return true; }
    const t = data.tasks.find((x) => x.id === session.taskId);
    if (t) { t.date = v; await writeData(data); }
    await sessionSet(chatId, null);
    if (t) await sendMessage(chatId, taskScreen(t, data).text, taskScreen(t, data).kb);
    return true;
  }
  if (session.step === 'set_time') {
    const v = text.trim();
    if (!/^\d{2}:\d{2}$/.test(v)) { await sendMessage(chatId, '⚠️ Формат должен быть ЧЧ:ММ. Попробуйте снова:'); return true; }
    const t = data.tasks.find((x) => x.id === session.taskId);
    if (t) { t.time = v; await writeData(data); }
    await sessionSet(chatId, null);
    if (t) await sendMessage(chatId, taskScreen(t, data).text, taskScreen(t, data).kb);
    return true;
  }
  if (session.step === 'add_checklist_item') {
    const t = data.tasks.find((x) => x.id === session.taskId);
    if (t) {
      t.checklist = t.checklist || [];
      t.checklist.push({ id: uid('ci'), text: text.trim(), done: false, qty: 1, unit: 'шт' });
      await writeData(data);
    }
    await sessionSet(chatId, null);
    if (t) await sendMessage(chatId, checklistScreen(t).text, checklistScreen(t).kb);
    return true;
  }
  if (session.step === 'new_cat_name') {
    session.name = text.trim();
    session.step = null;
    const color = CAT_PALETTE[data.categories.length % CAT_PALETTE.length];
    data.categories.push({ id: uid('cat'), name: session.name, color });
    await writeData(data);
    await sessionSet(chatId, null);
    await sendMessage(chatId, `✅ Категория «${esc(session.name)}» создана.`);
    await sendMessage(chatId, catsScreen(data).text, catsScreen(data).kb);
    return true;
  }
  if (session.step === 'rename_cat') {
    const c = data.categories.find((x) => x.id === session.catId);
    if (c) { c.name = text.trim(); await writeData(data); }
    await sessionSet(chatId, null);
    if (c) await sendMessage(chatId, catScreen(c, data).text, catScreen(c, data).kb);
    return true;
  }
  return false;
}

async function handleDraftCallback(cbq) {
  // Продолжение сценария "новая задача" после выбора категории/даты/времени/приоритета кнопками
  const chatId = cbq.message.chat.id;
  const session = await sessionGet(chatId);
  if (!session) return false;
  const [action, val] = cbq.data.split(':');
  const data = await readData();

  if (action === 'draft_cat' && session.step === 'new_category') {
    session.draft.categoryId = val === 'none' ? null : val;
    session.step = 'new_date';
    await sessionSet(chatId, session);
    await answerCallback(cbq.id);
    const kb = [
      [{ text: 'Сегодня', callback_data: 'draft_date:' + todayStr(0) }, { text: 'Завтра', callback_data: 'draft_date:' + todayStr(1) }],
      [{ text: 'Без даты', callback_data: 'draft_date:none' }],
    ];
    await sendMessage(chatId, '📅 Выберите дату:', kb);
    return true;
  }
  if (action === 'draft_date' && session.step === 'new_date') {
    session.draft.date = val === 'none' ? null : val;
    session.step = 'new_priority';
    await sessionSet(chatId, session);
    await answerCallback(cbq.id);
    const kb = PRIORITIES.map((p) => [{ text: p.label, callback_data: 'draft_prio:' + p.v }]);
    await sendMessage(chatId, '🚩 Выберите приоритет:', kb);
    return true;
  }
  if (action === 'draft_prio' && session.step === 'new_priority') {
    session.draft.priority = val;
    await answerCallback(cbq.id);
    const task = {
      id: uid('t'),
      title: session.draft.title,
      notes: '',
      date: session.draft.date || null,
      time: null,
      reminder: null,
      recur: 'none',
      priority: session.draft.priority || 'medium',
      categoryId: session.draft.categoryId || null,
      done: false,
      completedOn: null,
      createdAt: Date.now(),
      checklist: [],
    };
    data.tasks.push(task);
    await writeData(data);
    await sessionSet(chatId, null);
    const scr = taskScreen(task, data);
    await sendMessage(chatId, '✅ Задача создана!');
    await sendMessage(chatId, scr.text, scr.kb);
    return true;
  }
  return false;
}

exports.handler = async (event) => {
  // Диагностика: открыть URL функции в браузере (GET-запрос) покажет,
  // какие переменные окружения реально видит функция — без утечки самих значений.
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenConfigured: !!TOKEN,
        secretConfigured: !!WEBHOOK_SECRET,
        secretLength: WEBHOOK_SECRET ? WEBHOOK_SECRET.length : 0,
        allowedUserConfigured: !!ALLOWED_USER_ID,
      }),
    };
  }

  if (!TOKEN) return { statusCode: 500, body: 'TELEGRAM_BOT_TOKEN is not configured' };

  if (WEBHOOK_SECRET) {
    const secret = (event.headers['x-telegram-bot-api-secret-token'] || event.headers['X-Telegram-Bot-Api-Secret-Token'] || '').trim();
    if (secret !== WEBHOOK_SECRET.trim()) return { statusCode: 401, body: 'unauthorized' };
  }

  let update;
  try { update = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 200, body: 'ok' }; }

  try {
    const fromId = update.message ? update.message.from.id : update.callback_query ? update.callback_query.from.id : null;
    const chatId = update.message ? update.message.chat.id : update.callback_query ? update.callback_query.message.chat.id : null;

    if (ALLOWED_USER_ID && fromId && String(fromId) !== ALLOWED_USER_ID) {
      if (chatId) await sendMessage(chatId, '⛔ Этот бот приватный и настроен для другого пользователя.');
      return { statusCode: 200, body: 'ok' };
    }

    if (update.callback_query) {
      const handledDraft = await handleDraftCallback(update.callback_query);
      if (!handledDraft) await handleCallback(update.callback_query);
      return { statusCode: 200, body: 'ok' };
    }

    if (update.message && typeof update.message.text === 'string') {
      const text = update.message.text;

      if (text === '/start' || text === '/menu') {
        await sessionSet(chatId, null);
        const data = await readData();
        const m = mainMenu(data);
        await sendMessage(chatId, m.text, m.kb);
        return { statusCode: 200, body: 'ok' };
      }

      const handled = await handleTextStep(chatId, text);
      if (!handled) {
        await sendMessage(chatId, 'Не понял 🤔 Нажмите /start, чтобы открыть меню.');
      }
      return { statusCode: 200, body: 'ok' };
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    // Всегда отвечаем 200, чтобы Telegram не заваливал повторными отправками при ошибке.
    return { statusCode: 200, body: 'ok' };
  }
};
