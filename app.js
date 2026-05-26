const STORAGE_KEY = "infinite-todo:data:v1";
const CLICK_DELAY = 240;
const DRAG_THRESHOLD = 6;
const BACK_ANIMATION_MS = 150;

const board = document.querySelector("#todoBoard");
const boardTitle = document.querySelector("#boardTitle");
const titleEditor = document.querySelector("#titleEditor");
const titleInput = document.querySelector("#titleInput");
const viewport = document.querySelector("#viewport");
const listStage = document.querySelector("#listStage");

let state = loadState();
let currentPath = [];
let clickTimer = null;
let clickCount = 0;
let pendingClickItemId = null;
let pointerState = null;
let dragSource = null;
let navDirection = "none";
let isNavigatingBack = false;
let pendingDeleteId = null;
let pendingDeleteIsShift = false;
let editingItemId = null;
let editingItemIsNew = false;
let pendingScrollDepth = null;

render();

boardTitle.addEventListener("click", startTitleEdit);
titleEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  finishTitleEdit();
});
titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.stopPropagation();
    cancelTitleEdit();
  }
});
titleInput.addEventListener("blur", finishTitleEdit);
listStage.addEventListener("scroll", updateScrollFades);

document.addEventListener("keydown", (event) => {
  const isEditingText = document.activeElement === titleInput || document.activeElement?.classList.contains("todo-edit-input");
  if (event.key === "Escape" && !isEditingText) {
    goBack();
  }
  if (event.key === "Shift") {
    document.documentElement.classList.add("shift-sublist");
    syncShiftDeleteHover(true);
  }
});
document.addEventListener("keyup", (event) => {
  if (event.key === "Shift") {
    document.documentElement.classList.remove("shift-sublist");
    syncShiftDeleteHover(false);
  }
});
document.addEventListener("pointermove", resetDeleteIfPointerLeft);

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

function updateScrollFades() {
  const maxScroll = Math.max(0, listStage.scrollHeight - listStage.clientHeight);
  viewport.classList.toggle("at-scroll-top", listStage.scrollTop <= 2);
  viewport.classList.toggle("at-scroll-bottom", maxScroll - listStage.scrollTop <= 2);
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
  listStage.replaceChildren(createStageView());
  requestAnimationFrame(() => {
    if (pendingScrollDepth !== null) {
      const target = listStage.querySelector(`.subspace[data-depth="${pendingScrollDepth}"]`);
      if (target) {
        scrollListStageToElement(target);
      }
      pendingScrollDepth = null;
    }
    updateScrollFades();
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }

  navDirection = "none";
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

function createStageView() {
  const view = document.createElement("div");
  view.className = "list-view focus-view";
  view.dataset.depth = String(currentPath.length);

  if (navDirection !== "none") {
    view.classList.add(`nav-${navDirection}`);
  }

  view.appendChild(currentPath.length ? renderFocusedList(state.items, 0, null) : renderList(state.items, 0, null));
  return view;
}

function renderList(items, depth, parentId) {
  const list = document.createElement("ol");
  list.className = "todo-list";
  const focusDistance = Math.max(0, currentPath.length - depth);
  list.dataset.depth = String(depth);
  list.dataset.focusDistance = String(focusDistance);
  list.style.setProperty("--depth", depth);
  list.style.setProperty("--focus-distance", focusDistance);
  list.dataset.parentId = parentId || "";
  list.appendChild(createDivider(0, items, depth));

  items.forEach((item, index) => {
    list.appendChild(createTodoRow(item, depth, parentId, items));
    list.appendChild(createDivider(index + 1, items, depth));
  });

  return list;
}

function renderFocusedList(items, depth, parentId) {
  const selectedId = currentPath[depth];
  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  if (selectedIndex < 0) {
    currentPath = currentPath.slice(0, depth);
    return renderList(items, depth, parentId);
  }

  const selected = items[selectedIndex];
  selected.children ||= [];

  const list = document.createElement("ol");
  list.className = "todo-list focus-list";
  const focusDistance = Math.max(0, currentPath.length - depth);
  list.dataset.depth = String(depth);
  list.dataset.focusDistance = String(focusDistance);
  list.style.setProperty("--depth", depth);
  list.style.setProperty("--focus-distance", focusDistance);
  list.dataset.parentId = parentId || "";

  items.slice(0, selectedIndex).forEach((item) => {
    list.appendChild(createStaticDivider(depth));
    list.appendChild(createTodoRow(item, depth, parentId, items, "context-sibling"));
  });

  list.appendChild(createStaticDivider(depth));
  list.appendChild(createTodoRow(selected, depth, parentId, items, "context-parent"));

  const subspace = document.createElement("li");
  subspace.className = "subspace";
  subspace.dataset.depth = String(depth + 1);
  subspace.appendChild(
    depth + 1 < currentPath.length
      ? renderFocusedList(selected.children, depth + 1, selected.id)
      : renderList(selected.children, depth + 1, selected.id)
  );
  list.appendChild(subspace);

  items.slice(selectedIndex + 1).forEach((item) => {
    list.appendChild(createStaticDivider(depth));
    list.appendChild(createTodoRow(item, depth, parentId, items, "context-sibling"));
  });

  return list;
}

function createTodoRow(item, depth, parentId, parentList, modifier) {
  const row = document.createElement("li");
  row.className = modifier ? `todo-row ${modifier}` : "todo-row";
  row.dataset.depth = String(depth);
  row.appendChild(createTodoElement(item, depth, parentId, parentList));
  return row;
}

function createDivider(index, list, depth) {
  const divider = document.createElement("button");
  divider.className = "divider";
  divider.type = "button";
  divider.setAttribute("aria-label", "Add todo");
  divider.style.setProperty("--depth", depth);
  divider.appendChild(createDividerLine());
  divider.addEventListener("click", () => addItemAt(index, list));
  return divider;
}

function createStaticDivider(depth) {
  const divider = document.createElement("div");
  divider.className = "divider static-divider";
  divider.style.setProperty("--depth", depth);
  divider.setAttribute("aria-hidden", "true");
  divider.appendChild(createDividerLine());
  return divider;
}

function createDividerLine() {
  const line = document.createElement("span");
  line.setAttribute("aria-hidden", "true");
  return line;
}

function createTodoElement(item, depth, parentId, parentList) {
  const canReorder = depth === currentPath.length;
  const todo = document.createElement("div");
  todo.className = "todo-item";
  todo.draggable = canReorder;
  todo.dataset.id = item.id;
  todo.dataset.parentId = parentId || "";
  todo.style.setProperty("--depth", depth);
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
    todo.setAttribute("aria-expanded", "true");
  } else if (hasSublist(item)) {
    todo.setAttribute("aria-expanded", "false");
  }

  if (editingItemId === item.id) {
    todo.classList.add("editing-item");
    todo.draggable = false;
    const editor = createItemEditor(item);
    todo.appendChild(editor);
  } else {
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.text || "untitled";
    todo.appendChild(text);
  }

  const controls = document.createElement("span");
  controls.className = "todo-controls";

  const descendantCount = countDescendants(item);
  if (hasSublist(item)) {
    const badge = document.createElement("span");
    badge.className = "child-badge";
    if (allDescendantsComplete(item)) {
      badge.classList.add("all-done");
    }
    badge.textContent = String(descendantCount);
    badge.setAttribute("aria-label", `${descendantCount} items`);
    controls.appendChild(badge);
  }

  const editAction = document.createElement("button");
  editAction.className = "edit-action item-action";
  editAction.type = "button";
  editAction.setAttribute("aria-label", "Edit todo");
  editAction.innerHTML = `<i data-lucide="pencil" aria-hidden="true"></i>`;
  editAction.addEventListener("pointerdown", (event) => event.stopPropagation());
  editAction.addEventListener("click", (event) => {
    event.stopPropagation();
    startItemEdit(item);
  });
  controls.appendChild(editAction);

  const deleteAction = document.createElement("button");
  deleteAction.className = "delete-action item-action";
  deleteAction.type = "button";
  deleteAction.setAttribute("aria-label", "Delete todo");
  deleteAction.innerHTML = `<i data-lucide="trash-2" aria-hidden="true"></i>`;
  deleteAction.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteAction.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pendingDeleteId === item.id) {
      deleteItem(item, parentList);
      return;
    }
    pendingDeleteId = item.id;
    pendingDeleteIsShift = false;
    deleteAction.classList.add("confirm-delete");
  });
  deleteAction.addEventListener("pointerenter", (event) => updateShiftDeleteConfirm(item.id, deleteAction, event.shiftKey));
  deleteAction.addEventListener("pointermove", (event) => updateShiftDeleteConfirm(item.id, deleteAction, event.shiftKey));
  const resetDeleteConfirmation = () => {
    if (pendingDeleteId === item.id) {
      pendingDeleteId = null;
      pendingDeleteIsShift = false;
      deleteAction.classList.remove("confirm-delete");
      deleteAction.blur();
    }
  };
  deleteAction.addEventListener("mouseleave", resetDeleteConfirmation);
  controls.addEventListener("mouseleave", resetDeleteConfirmation);
  todo.addEventListener("mouseleave", resetDeleteConfirmation);
  controls.appendChild(deleteAction);
  todo.appendChild(controls);

  todo.addEventListener("keydown", (event) => {
    if (editingItemId === item.id) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (hasSublist(item)) {
        openSublist(item);
      } else {
        createSublist(item);
      }
    }
  });
  todo.addEventListener("pointerdown", (event) => beginPointer(event, item));
  todo.addEventListener("pointermove", updatePointer);
  todo.addEventListener("pointerup", (event) => endPointer(event, item));
  todo.addEventListener("pointercancel", clearPointer);
  todo.addEventListener("dragstart", (event) => beginDrag(event, item, parentList, parentId, depth));
  todo.addEventListener("dragover", handleDragOver);
  todo.addEventListener("dragleave", handleDragLeave);
  todo.addEventListener("drop", (event) => handleDrop(event, item, parentList, parentId));
  todo.addEventListener("dragend", endDrag);

  return todo;
}

function updateShiftDeleteConfirm(itemId, deleteAction, isShiftHeld) {
  if (isShiftHeld) {
    if (pendingDeleteId === itemId && !pendingDeleteIsShift) {
      deleteAction.classList.add("confirm-delete");
      return;
    }
    pendingDeleteId = itemId;
    pendingDeleteIsShift = true;
    deleteAction.classList.add("confirm-delete");
    return;
  }

  if (pendingDeleteIsShift && pendingDeleteId === itemId) {
    pendingDeleteId = null;
    pendingDeleteIsShift = false;
    deleteAction.classList.remove("confirm-delete");
  }
}

function syncShiftDeleteHover(isShiftHeld) {
  const hovered = document.querySelector(".delete-action:hover");
  if (!hovered) {
    return;
  }
  const todo = hovered.closest(".todo-item");
  if (!todo?.dataset.id) {
    return;
  }
  updateShiftDeleteConfirm(todo.dataset.id, hovered, isShiftHeld);
}

function createItemEditor(item) {
  const input = document.createElement("input");
  input.className = "todo-edit-input";
  input.type = "text";
  input.value = item.text || "";
  const preservedScrollTop = listStage.scrollTop;
  input.setAttribute("aria-label", "Todo text");
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finishItemEdit(item, input.value, { deleteIfEmpty: true });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handleItemEditCancel(item, input.value);
    }
  });
  input.addEventListener("blur", () => handleItemEditCancel(item, input.value));

  input.addEventListener("focus", () => {
    listStage.scrollTop = preservedScrollTop;
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
    listStage.scrollTop = preservedScrollTop;
  });

  return input;
}

function startItemEdit(item) {
  clearPendingClick();
  pendingDeleteId = null;
  editingItemId = item.id;
  editingItemIsNew = false;
  document.documentElement.classList.add("editing-item");
  document.body.classList.add("editing-item");
  render();
}

function finishItemEdit(item, value, options = {}) {
  if (editingItemId !== item.id) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed === "" && options.deleteIfEmpty) {
    const parentList = findParentList(item.id);
    if (parentList) {
      deleteItem(item, parentList);
      return;
    }
  }
  item.text = trimmed || "untitled";
  editingItemId = null;
  editingItemIsNew = false;
  document.documentElement.classList.remove("editing-item");
  document.body.classList.remove("editing-item");
  saveState();
  render();
}

function cancelItemEdit() {
  if (!editingItemId) {
    return;
  }
  editingItemId = null;
  editingItemIsNew = false;
  document.documentElement.classList.remove("editing-item");
  document.body.classList.remove("editing-item");
  render();
}

function handleItemEditCancel(item, value) {
  if (editingItemIsNew && value.trim() === "") {
    const parentList = findParentList(item.id);
    if (parentList) {
      deleteItem(item, parentList);
      return;
    }
  }
  cancelItemEdit();
}

function addItemAt(index, list) {
  const item = createItem("");
  list.splice(index, 0, item);
  editingItemId = item.id;
  editingItemIsNew = true;
  saveState();
  render();
  requestAnimationFrame(() => {
    const added = listStage.querySelector(`[data-id="${item.id}"]`);
    if (added) {
      const listRect = listStage.getBoundingClientRect();
      const itemRect = added.getBoundingClientRect();
      const offset = itemRect.top - listRect.top - listStage.clientHeight / 2 + itemRect.height / 2;
      const nextScrollTop = Math.max(
        0,
        Math.min(listStage.scrollHeight - listStage.clientHeight, listStage.scrollTop + offset)
      );
      listStage.scrollTo({ top: nextScrollTop, behavior: "smooth" });
    }
    window.setTimeout(updateScrollFades, 260);
  });
}

function deleteItem(item, parentList) {
  const index = parentList.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return;
  }
  parentList.splice(index, 1);
  currentPath = currentPath.filter((id) => id !== item.id);
  pendingDeleteId = null;
  pendingDeleteIsShift = false;
  if (editingItemId === item.id) {
    editingItemId = null;
    editingItemIsNew = false;
    document.documentElement.classList.remove("editing-item");
    document.body.classList.remove("editing-item");
  }
  clearPendingClick();
  saveState();
  render();
}

function resetDeleteIfPointerLeft(event) {
  if (!pendingDeleteId) {
    return;
  }

  const pendingTodo = [...listStage.querySelectorAll(".todo-item")].find((todo) => todo.dataset.id === pendingDeleteId);
  if (!pendingTodo || pendingTodo.contains(event.target)) {
    return;
  }

  pendingTodo.querySelector(".delete-action")?.classList.remove("confirm-delete");
  if (document.activeElement === pendingTodo.querySelector(".delete-action")) {
    document.activeElement.blur();
  }
  pendingDeleteId = null;
  pendingDeleteIsShift = false;
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
    registerItemClick(item, event);
  }
}

function clearPointer() {
  pointerState = null;
}

function registerItemClick(item, event) {
  if (pendingClickItemId !== item.id) {
    clearPendingClick();
    pendingClickItemId = item.id;
  }

  if (event?.shiftKey) {
    clearPendingClick();
    createSublist(item);
    return;
  }

  clickCount += 1;
  clearTimeout(clickTimer);

  clickTimer = window.setTimeout(() => {
    const count = clickCount;
    clearPendingClick();
    if (count === 1) {
      if (hasSublist(item)) {
        openSublist(item);
      }
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
  updateCompletionUI(item);
}

function updateCompletionUI(item) {
  const todo = listStage.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (!todo) {
    render();
    return;
  }

  todo.classList.toggle("completed", item.completed);
  updateBadgeState(item);

  const ancestors = findItemAncestors(item.id);
  ancestors.forEach(updateBadgeState);
}

function updateBadgeState(item) {
  if (!hasSublist(item)) {
    return;
  }

  const todo = listStage.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (!todo) {
    return;
  }

  const badge = todo.querySelector(".child-badge");
  if (!badge) {
    return;
  }

  badge.classList.toggle("all-done", allDescendantsComplete(item));
}

function findItemAncestors(targetId) {
  const path = [];
  collectAncestors(state.items, targetId, path);
  return path;
}

function collectAncestors(items, targetId, path) {
  for (const item of items) {
    if (item.id === targetId) {
      return true;
    }
    if (Array.isArray(item.children) && collectAncestors(item.children, targetId, path)) {
      path.push(item);
      return true;
    }
  }
  return false;
}

function findParentList(targetId, items = state.items) {
  for (const item of items) {
    if (item.id === targetId) {
      return items;
    }
    if (Array.isArray(item.children)) {
      const found = findParentList(targetId, item.children);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function createSublist(item) {
  if (!hasSublist(item)) {
    item.hasSublist = true;
    const newItem = createItem("");
    item.children = [newItem];
    editingItemId = newItem.id;
    editingItemIsNew = true;
    saveState();
  }
  focusPathItem(item);
  pendingScrollDepth = currentPath.length;
  navDirection = "forward";
  render();
}

function openSublist(item) {
  if (!hasSublist(item)) {
    return;
  }
  item.children ||= [];
  focusPathItem(item);
  pendingScrollDepth = currentPath.length;
  navDirection = "forward";
  render();
}

function scrollListStageToElement(element) {
  const listRect = listStage.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const offset = elementRect.top - listRect.top - listStage.clientHeight / 2 + elementRect.height / 2;
  const nextScrollTop = Math.max(
    0,
    Math.min(listStage.scrollHeight - listStage.clientHeight, listStage.scrollTop + offset)
  );
  listStage.scrollTo({ top: nextScrollTop, behavior: "smooth" });
}

function focusPathItem(item) {
  const existingIndex = currentPath.indexOf(item.id);
  if (existingIndex >= 0) {
    currentPath = currentPath.slice(0, existingIndex + 1);
    return;
  }
  currentPath.push(item.id);
}

function goBack() {
  if (!currentPath.length || isNavigatingBack) {
    return;
  }
  clearPendingClick();
  const closingSubspace = listStage.querySelector(`.subspace[data-depth="${currentPath.length}"]`);
  if (!closingSubspace) {
    finishBackNavigation();
    return;
  }

  isNavigatingBack = true;
  closingSubspace.classList.add("is-closing");
  window.setTimeout(finishBackNavigation, BACK_ANIMATION_MS);
}

function finishBackNavigation() {
  removeCurrentSublistIfEmpty();
  currentPath.pop();
  navDirection = "back";
  isNavigatingBack = false;
  render();
}

function removeCurrentSublistIfEmpty() {
  const parent = getCurrentParent();
  if (!parent || parent.children?.length) {
    return;
  }

  parent.hasSublist = false;
  delete parent.children;
  saveState();
}

function beginDrag(event, item, parentList, parentId, depth) {
  if (depth !== currentPath.length) {
    event.preventDefault();
    return;
  }
  dragSource = { id: item.id, parentList, parentId };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.id);
  event.currentTarget.classList.add("dragging");
  clearPendingClick();
}

function handleDragOver(event) {
  if (!dragSource) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drag-over");
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleDrop(event, targetItem, targetList, targetParentId) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");

  const sourceId = event.dataTransfer.getData("text/plain") || dragSource?.id;
  if (!sourceId || sourceId === targetItem.id) {
    return;
  }

  if (dragSource?.parentId !== targetParentId) {
    return;
  }

  const list = targetList;
  const fromIndex = dragSource.parentList.findIndex((item) => item.id === sourceId);
  const toIndex = list.findIndex((item) => item.id === targetItem.id);
  if (fromIndex < 0 || toIndex < 0) {
    return;
  }

  const [moved] = dragSource.parentList.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  saveState();
  render();
}

function endDrag(event) {
  event.currentTarget.classList.remove("dragging", "drag-over");
  dragSource = null;
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
