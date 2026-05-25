const STORAGE_KEY = "infinite-todo:data:v1";
const CLICK_DELAY = 240;
const DRAG_THRESHOLD = 6;

const board = document.querySelector("#todoBoard");
const boardTitle = document.querySelector("#boardTitle");
const titleEditor = document.querySelector("#titleEditor");
const titleInput = document.querySelector("#titleInput");
const listStage = document.querySelector("#listStage");

let state = loadState();
let currentPath = [];
let clickTimer = null;
let clickCount = 0;
let pendingClickItemId = null;
let pointerState = null;
let draggedId = null;
let navDirection = "none";

render();

boardTitle.addEventListener("click", startTitleEdit);
titleEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  finishTitleEdit();
});
titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cancelTitleEdit();
  }
});
titleInput.addEventListener("blur", finishTitleEdit);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.activeElement !== titleInput) {
    goBack();
  }
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.items)) {
      return saved;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    title: "title",
    items: [
      createItem("todo #1", true),
      createItem("todo #2", true, [createItem("sub todo #1", true), createItem("sub todo #2", true)]),
      createItem("todo #3", false),
      createItem("todo #4"),
      createItem("todo #5"),
      createItem("todo #6"),
      createItem("todo #7"),
      createItem("todo #8"),
      createItem("todo #9"),
      createItem("todo #10"),
      createItem("todo #11"),
      createItem("todo #12")
    ]
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createItem(text = "new todo", completed = false, children) {
  const item = {
    id: createId(),
    text,
    completed
  };
  if (children) {
    item.hasSublist = true;
    item.children = children;
  }
  return item;
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getCurrentList() {
  let list = state.items;
  for (const id of currentPath) {
    const item = list.find((candidate) => candidate.id === id);
    if (!item) {
      currentPath = [];
      return state.items;
    }
    item.children ||= [];
    list = item.children;
  }
  return list;
}

function getCurrentParent() {
  if (!currentPath.length) {
    return null;
  }

  let list = state.items;
  let parent = null;
  for (const id of currentPath) {
    parent = list.find((candidate) => candidate.id === id);
    if (!parent) {
      return null;
    }
    parent.children ||= [];
    list = parent.children;
  }
  return parent;
}

function getCurrentTitle() {
  const parent = getCurrentParent();
  return parent ? parent.text : state.title;
}

function setCurrentTitle(value) {
  const title = value.trim() || "untitled";
  const parent = getCurrentParent();
  if (parent) {
    parent.text = title;
  } else {
    state.title = title;
  }
  saveState();
}

function render() {
  boardTitle.textContent = getCurrentTitle();
  board.dataset.depth = currentPath.length;
  listStage.replaceChildren(...renderPathViews());

  if (window.lucide) {
    window.lucide.createIcons();
  }

  navDirection = "none";
}

function renderPathViews() {
  if (currentPath.length) {
    return [createContextListView()];
  }

  const views = [];
  views.push(createListView(state.items, 0, null));
  return views;
}

function createContextListView() {
  const context = getCurrentContext();
  if (!context) {
    currentPath = [];
    return createListView(state.items, 0, null);
  }

  const view = document.createElement("div");
  view.className = "list-view context-view";
  view.dataset.depth = String(currentPath.length);
  view.dataset.distance = "0";
  view.style.setProperty("--ancestor-shift", "0vh");
  view.style.setProperty("--selected-offset", "0rem");
  view.style.setProperty("--view-scale", 1);
  view.style.setProperty("--view-opacity", 1);
  view.style.zIndex = String(currentPath.length + 1);

  if (navDirection !== "none") {
    view.classList.add(`nav-${navDirection}`);
  }

  view.appendChild(renderContextList(context));
  return view;
}

function getCurrentContext() {
  let list = state.items;
  let parentList = state.items;
  let parent = null;

  for (const id of currentPath) {
    parentList = list;
    parent = list.find((candidate) => candidate.id === id);
    if (!parent) {
      return null;
    }
    parent.children ||= [];
    list = parent.children;
  }

  return {
    parent,
    parentList,
    parentIndex: parentList.findIndex((candidate) => candidate.id === parent.id),
    items: list
  };
}

function renderContextList({ parent, parentList, parentIndex, items }) {
  const list = document.createElement("ol");
  list.className = "todo-list context-list";
  list.dataset.depth = String(currentPath.length);
  list.dataset.parentId = parent.id;

  parentList.slice(0, parentIndex).forEach((item) => {
    list.appendChild(createStaticDivider());
    list.appendChild(createTodoRow(item, "context-sibling"));
  });

  list.appendChild(createStaticDivider());
  list.appendChild(createTodoRow(parent, "context-parent"));
  list.appendChild(createDivider(0));

  items.forEach((item, index) => {
    list.appendChild(createTodoRow(item, "context-child"));
    list.appendChild(createDivider(index + 1));
  });

  parentList.slice(parentIndex + 1).forEach((item) => {
    list.appendChild(createStaticDivider());
    list.appendChild(createTodoRow(item, "context-sibling"));
  });

  return list;
}

function createListView(items, depth, parentId) {
  const view = document.createElement("div");
  const distance = currentPath.length - depth;
  const selectedId = currentPath[depth];
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
  view.className = "list-view";
  view.dataset.depth = String(depth);
  view.dataset.distance = String(distance);
  view.style.setProperty("--ancestor-shift", `-${distance * 28}vh`);
  view.style.setProperty("--selected-offset", `${Math.max(0, selectedIndex) * 3.6}rem`);
  view.style.setProperty("--view-scale", 1 + distance * 0.22);
  view.style.setProperty("--view-opacity", Math.max(0.18, 1 - Math.min(distance, 3) * 0.34));
  view.style.zIndex = String(depth + 1);

  if (depth === currentPath.length && navDirection !== "none") {
    view.classList.add(`nav-${navDirection}`);
  }

  view.appendChild(renderList(items, depth, parentId));
  return view;
}

function renderList(items, depth, parentId) {
  const list = document.createElement("ol");
  list.className = "todo-list";
  list.dataset.depth = String(depth);
  list.dataset.parentId = parentId || "";
  if (depth !== currentPath.length) {
    list.classList.add("ancestor-list");
  }
  list.appendChild(createDivider(0));

  items.forEach((item, index) => {
    list.appendChild(createTodoRow(item));
    list.appendChild(createDivider(index + 1));
  });

  return list;
}

function createTodoRow(item, modifier) {
  const row = document.createElement("li");
  row.className = modifier ? `todo-row ${modifier}` : "todo-row";
  row.appendChild(createTodoElement(item));
  return row;
}

function createDivider(index) {
  const divider = document.createElement("button");
  divider.className = "divider";
  divider.type = "button";
  divider.setAttribute("aria-label", "Add todo");
  divider.addEventListener("click", () => addItemAt(index));
  return divider;
}

function createStaticDivider() {
  const divider = document.createElement("div");
  divider.className = "divider static-divider";
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

function createTodoElement(item) {
  const todo = document.createElement("div");
  todo.className = "todo-item";
  todo.draggable = true;
  todo.dataset.id = item.id;
  todo.tabIndex = 0;
  todo.setAttribute("role", "button");
  todo.setAttribute("aria-label", item.text || "Todo item");
  if (item.completed) {
    todo.classList.add("completed");
  }
  if (hasSublist(item)) {
    todo.classList.add("has-children");
  }
  if (currentPath.includes(item.id)) {
    todo.classList.add("path-parent");
  }

  const text = document.createElement("span");
  text.className = "todo-text";
  text.textContent = item.text || "untitled";

  todo.appendChild(text);

  const descendantCount = countDescendants(item);
  if (hasSublist(item)) {
    const badge = document.createElement("span");
    badge.className = "child-badge";
    if (allDescendantsComplete(item)) {
      badge.classList.add("all-done");
    }
    badge.innerHTML = `<i data-lucide="list-tree" aria-hidden="true"></i><span>${descendantCount}</span>`;
    todo.appendChild(badge);
  }

  todo.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openSublist(item);
    }
  });
  todo.addEventListener("pointerdown", (event) => beginPointer(event, item));
  todo.addEventListener("pointermove", updatePointer);
  todo.addEventListener("pointerup", (event) => endPointer(event, item));
  todo.addEventListener("pointercancel", clearPointer);
  todo.addEventListener("dragstart", (event) => beginDrag(event, item));
  todo.addEventListener("dragover", handleDragOver);
  todo.addEventListener("dragleave", handleDragLeave);
  todo.addEventListener("drop", (event) => handleDrop(event, item));
  todo.addEventListener("dragend", endDrag);

  return todo;
}

function addItemAt(index) {
  const list = getCurrentList();
  const item = createItem("new todo");
  list.splice(index, 0, item);
  saveState();
  render();
}

function beginPointer(event, item) {
  pointerState = {
    id: item.id,
    x: event.clientX,
    y: event.clientY,
    dragged: false
  };
}

function updatePointer(event) {
  if (!pointerState) {
    return;
  }

  const distance = Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y);
  if (distance > DRAG_THRESHOLD) {
    pointerState.dragged = true;
    clearPendingClick();
  }
}

function endPointer(event, item) {
  if (!pointerState || pointerState.id !== item.id) {
    clearPointer();
    return;
  }

  const wasDragged = pointerState.dragged;
  clearPointer();
  if (!wasDragged) {
    registerItemClick(item);
  }
}

function clearPointer() {
  pointerState = null;
}

function registerItemClick(item) {
  if (currentPath[currentPath.length - 1] === item.id) {
    clearPendingClick();
    goBack();
    return;
  }

  if (pendingClickItemId !== item.id) {
    clearPendingClick();
    pendingClickItemId = item.id;
  }

  clickCount += 1;
  clearTimeout(clickTimer);

  if (clickCount >= 3) {
    const count = clickCount;
    clearPendingClick();
    if (count >= 3) {
      createSublist(item);
    }
    return;
  }

  clickTimer = window.setTimeout(() => {
    const count = clickCount;
    clearPendingClick();
    if (count === 1) {
      openSublist(item);
    } else if (count === 2) {
      toggleCompleted(item);
    }
  }, CLICK_DELAY);
}

function clearPendingClick() {
  clearTimeout(clickTimer);
  clickTimer = null;
  clickCount = 0;
  pendingClickItemId = null;
}

function toggleCompleted(item) {
  item.completed = !item.completed;
  saveState();
  render();
}

function createSublist(item) {
  if (hasSublist(item)) {
    return;
  }
  item.hasSublist = true;
  item.children = [];
  saveState();
  currentPath.push(item.id);
  navDirection = "forward";
  render();
}

function openSublist(item) {
  if (!hasSublist(item)) {
    return;
  }
  item.children ||= [];
  currentPath.push(item.id);
  navDirection = "forward";
  render();
}

function goBack() {
  if (!currentPath.length) {
    return;
  }
  clearPendingClick();
  currentPath.pop();
  navDirection = "back";
  render();
}

function beginDrag(event, item) {
  draggedId = item.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.id);
  event.currentTarget.classList.add("dragging");
  clearPendingClick();
}

function handleDragOver(event) {
  if (!draggedId) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drag-over");
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleDrop(event, targetItem) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");

  const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
  if (!sourceId || sourceId === targetItem.id) {
    return;
  }

  const list = getCurrentList();
  const fromIndex = list.findIndex((item) => item.id === sourceId);
  const toIndex = list.findIndex((item) => item.id === targetItem.id);
  if (fromIndex < 0 || toIndex < 0) {
    return;
  }

  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  saveState();
  render();
}

function endDrag(event) {
  event.currentTarget.classList.remove("dragging", "drag-over");
  draggedId = null;
}

function startTitleEdit() {
  board.classList.add("editing-title");
  boardTitle.parentElement.hidden = true;
  titleEditor.hidden = false;
  titleInput.value = getCurrentTitle();
  requestAnimationFrame(() => {
    titleInput.focus();
    titleInput.select();
  });
}

function finishTitleEdit() {
  if (titleEditor.hidden) {
    return;
  }
  setCurrentTitle(titleInput.value);
  closeTitleEdit();
  render();
}

function cancelTitleEdit() {
  closeTitleEdit();
}

function closeTitleEdit() {
  board.classList.remove("editing-title");
  titleEditor.hidden = true;
  boardTitle.parentElement.hidden = false;
  boardTitle.textContent = getCurrentTitle();
}

function hasSublist(item) {
  return Boolean(item.hasSublist) || (Array.isArray(item.children) && item.children.length > 0);
}

function countDescendants(item) {
  if (!Array.isArray(item.children)) {
    return 0;
  }
  return item.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function allDescendantsComplete(item) {
  if (!hasSublist(item)) {
    return false;
  }
  if (!Array.isArray(item.children) || item.children.length === 0) {
    return true;
  }
  return item.children.every((child) => child.completed && allNestedComplete(child));
}

function allNestedComplete(item) {
  return item.completed && (!Array.isArray(item.children) || item.children.every(allNestedComplete));
}
