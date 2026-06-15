const STORAGE_KEY = "infinite-todo:data:v1";
const CLICK_DELAY = 240;
const DRAG_THRESHOLD = 6;
const BACK_ANIMATION_MS = 150;
const DRAG_ENTER_DELAY = 500;
const ICONS = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-icon lucide-pencil" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2-icon lucide-trash-2" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link-icon lucide-link" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
};

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
let pendingScrollItemId = null;
let lastMovedItemId = null;
let dragPreview = null;
let dragEnterTimer = null;
let dragEnterTargetId = null;

render();
registerServiceWorker();

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
document.addEventListener("dragend", () => finishDrag(Boolean(dragSource?.didDrop)));

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

function createLinkItem(targetItem) {
  const target = resolveItem(targetItem);
  if (!target) {
    return null;
  }
  return {
    id: createId(),
    linkTargetId: target.id
  };
}

function isLinkItem(item) {
  return Boolean(item?.linkTargetId);
}

function resolveItem(item, seen = new Set()) {
  if (!isLinkItem(item)) {
    return item;
  }
  if (seen.has(item.linkTargetId)) {
    return null;
  }
  seen.add(item.linkTargetId);
  const target = findItemRecord(item.linkTargetId)?.item;
  return target ? resolveItem(target, seen) : null;
}

function getItemChildren(item) {
  const resolved = resolveItem(item);
  return Array.isArray(resolved?.children) ? resolved.children : [];
}

function getItemText(item) {
  const resolved = resolveItem(item);
  return resolved?.text || (isLinkItem(item) ? "missing item" : "untitled");
}

function getItemIdForViewName(item) {
  const resolved = resolveItem(item);
  return isLinkItem(item) ? item.id : resolved?.id || item.id;
}

function findItemRecord(targetId, items = state.items, path = [], parentList = null, parent = null) {
  for (const item of items) {
    const itemPath = [...path, item.id];
    if (item.id === targetId) {
      return { item, parentList: items, parent, path: itemPath, parentPath: path };
    }
    if (Array.isArray(item.children)) {
      const found = findItemRecord(targetId, item.children, itemPath, item.children, item);
      if (found) {
        return found;
      }
    }
  }
  return null;
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
    if (pendingScrollItemId !== null) {
      const target = listStage.querySelector(`[data-id="${CSS.escape(pendingScrollItemId)}"]`);
      if (target) {
        scrollListStageToElement(target);
      }
      pendingScrollItemId = null;
    }
    updateScrollFades();
  });

  navDirection = "none";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function getCurrentList() {
  let list = state.items;
  for (const id of currentPath) {
    const item = list.find((candidate) => candidate.id === id);
    if (!item) {
      currentPath = [];
      return state.items;
    }
    const resolved = resolveItem(item);
    if (!resolved) {
      currentPath = [];
      return state.items;
    }
    resolved.children ||= [];
    list = resolved.children;
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
    const resolved = resolveItem(parent);
    if (!resolved) {
      return null;
    }
    resolved.children ||= [];
    parent = resolved;
    list = resolved.children;
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

function renderList(items, depth, parentId, context = {}) {
  const list = document.createElement("ol");
  list.className = "todo-list";
  const focusDistance = Math.max(0, currentPath.length - depth);
  list.dataset.depth = String(depth);
  list.dataset.focusDistance = String(focusDistance);
  list.style.setProperty("--depth", depth);
  list.style.setProperty("--focus-distance", focusDistance);
  list.dataset.parentId = parentId || "";
  list.appendChild(createDivider(0, items, depth, parentId, context));

  items.forEach((item, index) => {
    list.appendChild(createTodoRow(item, depth, parentId, items, undefined, context));
    list.appendChild(createDivider(index + 1, items, depth, parentId, context));
  });

  return list;
}

function renderFocusedList(items, depth, parentId, context = {}) {
  const selectedId = currentPath[depth];
  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  if (selectedIndex < 0) {
    currentPath = currentPath.slice(0, depth);
    return renderList(items, depth, parentId, context);
  }

  const selected = items[selectedIndex];
  const selectedTarget = resolveItem(selected);
  if (!selectedTarget) {
    return renderList(items, depth, parentId, context);
  }
  selectedTarget.children ||= [];
  const childContext = context.linkedRootTargetId
    ? context
    : isLinkItem(selected)
      ? { linkedRootId: selected.id, linkedRootTargetId: selectedTarget.id, linkedRootDepth: depth }
      : context;

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
    list.appendChild(createTodoRow(item, depth, parentId, items, "context-sibling", context));
  });

  list.appendChild(createStaticDivider(depth));
  list.appendChild(createTodoRow(selected, depth, parentId, items, "context-parent", context));

  const subspace = document.createElement("li");
  subspace.className = "subspace";
  subspace.dataset.depth = String(depth + 1);
  subspace.appendChild(
    depth + 1 < currentPath.length
      ? renderFocusedList(selectedTarget.children, depth + 1, selectedTarget.id, childContext)
      : renderList(selectedTarget.children, depth + 1, selectedTarget.id, childContext)
  );
  list.appendChild(subspace);

  items.slice(selectedIndex + 1).forEach((item) => {
    list.appendChild(createStaticDivider(depth));
    list.appendChild(createTodoRow(item, depth, parentId, items, "context-sibling", context));
  });

  return list;
}

function createTodoRow(item, depth, parentId, parentList, modifier, context = {}) {
  const row = document.createElement("li");
  row.className = modifier ? `todo-row ${modifier}` : "todo-row";
  row.dataset.depth = String(depth);
  row.appendChild(createTodoElement(item, depth, parentId, parentList, context));
  return row;
}

function createDivider(index, list, depth, parentId, context = {}) {
  const divider = document.createElement("button");
  divider.className = "divider";
  divider.type = "button";
  divider.setAttribute("aria-label", "Add todo");
  divider.style.setProperty("--depth", depth);
  divider.appendChild(createDividerLine());
  divider.addEventListener("click", () => addItemAt(index, list));
  divider.addEventListener("dragover", (event) => handleDividerDragOver(event, list, parentId, depth, context));
  divider.addEventListener("dragleave", handleDividerDragLeave);
  divider.addEventListener("drop", (event) => handleDividerDrop(event, index, list, parentId, depth, context));
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

function createTodoElement(item, depth, parentId, parentList, context = {}) {
  const targetItem = resolveItem(item);
  const isBrokenLink = isLinkItem(item) && !targetItem;
  const displayItem = targetItem || item;
  const isLinkedContext = Boolean(context.linkedRootTargetId);
  const isLinkedRow = isLinkItem(item) || isLinkedContext;
  const actionId = isLinkItem(item) ? item.id : displayItem.id;
  const canReorder = depth === currentPath.length;
  const todo = document.createElement("div");
  todo.className = "todo-item";
  todo.draggable = canReorder && !isBrokenLink;
  todo.dataset.id = actionId;
  todo.dataset.targetId = displayItem.id || "";
  todo.dataset.parentId = parentId || "";
  todo.style.viewTransitionName = `todo-${getItemIdForViewName(item).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  todo.style.setProperty("--depth", depth);
  todo.tabIndex = 0;
  todo.setAttribute("role", "button");
  todo.setAttribute("aria-label", getItemText(item) || "Todo item");
  if (displayItem.completed) {
    todo.classList.add("completed");
  }
  if (isLinkedRow) {
    todo.classList.add("linked-item");
  }
  if (isLinkItem(item) && !isBrokenLink) {
    todo.classList.add("portal-root");
  }
  if (isBrokenLink) {
    todo.classList.add("broken-link");
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

  if (editingItemId === displayItem.id && !isBrokenLink) {
    todo.classList.add("editing-item");
    todo.draggable = false;
    const editor = createItemEditor(displayItem);
    todo.appendChild(editor);
  } else {
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = getItemText(item);
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

  if (isLinkedRow && !isBrokenLink) {
    const linkAction = document.createElement("button");
    linkAction.className = "link-action item-action always-visible";
    linkAction.type = "button";
    linkAction.setAttribute("aria-label", "Go to original item");
    linkAction.innerHTML = ICONS.link;
    linkAction.addEventListener("pointerdown", (event) => event.stopPropagation());
    linkAction.addEventListener("click", (event) => {
      event.stopPropagation();
      jumpToOriginalItem(displayItem.id);
    });
    controls.appendChild(linkAction);
  }

  const editAction = document.createElement("button");
  editAction.className = "edit-action item-action";
  editAction.type = "button";
  editAction.setAttribute("aria-label", "Edit todo");
  editAction.innerHTML = ICONS.pencil;
  editAction.addEventListener("pointerdown", (event) => event.stopPropagation());
  editAction.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isBrokenLink) {
      startItemEdit(displayItem);
    }
  });
  controls.appendChild(editAction);

  const deleteAction = document.createElement("button");
  deleteAction.className = "delete-action item-action";
  deleteAction.type = "button";
  deleteAction.setAttribute("aria-label", "Delete todo");
  deleteAction.innerHTML = ICONS.trash;
  deleteAction.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteAction.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pendingDeleteId === actionId) {
      deleteItem(item, parentList);
      return;
    }
    pendingDeleteId = actionId;
    pendingDeleteIsShift = false;
    deleteAction.classList.add("confirm-delete");
  });
  deleteAction.addEventListener("pointerenter", (event) => updateShiftDeleteConfirm(actionId, deleteAction, event.shiftKey));
  deleteAction.addEventListener("pointermove", (event) => updateShiftDeleteConfirm(actionId, deleteAction, event.shiftKey));
  const resetDeleteConfirmation = () => {
    if (pendingDeleteId === actionId) {
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
    if (editingItemId === displayItem.id) {
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
  todo.addEventListener("dragstart", (event) => beginDrag(event, item, parentList, parentId, depth, context));
  todo.addEventListener("dragover", (event) => handleItemDragOver(event, item, parentList, parentId, depth, context));
  todo.addEventListener("dragleave", (event) => handleItemDragLeave(event, item));
  todo.addEventListener("drop", (event) => handleItemDrop(event, item, parentList, parentId, depth, context));
  todo.addEventListener("dragend", endDrag);

  if (lastMovedItemId === actionId) {
    todo.classList.add("just-dropped");
    requestAnimationFrame(() => {
      todo.classList.remove("just-dropped");
      lastMovedItemId = null;
    });
  }

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
  const removedOriginalIds = isLinkItem(item) ? [] : collectItemIds(item);
  parentList.splice(index, 1);
  if (removedOriginalIds.length) {
    removeLinksToTargets(removedOriginalIds);
  }
  currentPath = currentPath.filter((id) => id !== item.id && !removedOriginalIds.includes(id));
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

function collectItemIds(item, ids = []) {
  ids.push(item.id);
  if (Array.isArray(item.children)) {
    item.children.forEach((child) => collectItemIds(child, ids));
  }
  return ids;
}

function removeLinksToTargets(targetIds, list = state.items) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (isLinkItem(item) && targetIds.includes(item.linkTargetId)) {
      list.splice(index, 1);
      continue;
    }
    if (Array.isArray(item.children)) {
      removeLinksToTargets(targetIds, item.children);
    }
  }
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
  if (isLinkItem(item) && !resolveItem(item)) {
    return;
  }

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
  const target = resolveItem(item);
  if (!target) {
    return;
  }
  target.completed = !target.completed;
  saveState();
  render();
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
  const target = resolveItem(item);
  if (!target) {
    return;
  }
  if (!hasSublist(target)) {
    target.hasSublist = true;
    const newItem = createItem("");
    target.children = [newItem];
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
  const target = resolveItem(item);
  if (!target) {
    return;
  }
  target.children ||= [];
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

function jumpToOriginalItem(itemId) {
  const record = findItemRecord(itemId);
  if (!record) {
    return;
  }
  const previousDepth = currentPath.length;
  currentPath = [...record.parentPath];
  pendingScrollItemId = itemId;
  navDirection = currentPath.length > previousDepth ? "forward" : currentPath.length < previousDepth ? "back" : "none";
  renderWithMoveAnimation();
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

function beginDrag(event, item, parentList, parentId, depth, context = {}) {
  if (depth !== currentPath.length) {
    event.preventDefault();
    return;
  }
  const target = resolveItem(item);
  if (!target) {
    event.preventDefault();
    return;
  }
  dragSource = {
    id: item.id,
    item,
    target,
    parentList,
    parentId,
    depth,
    isLinkCopy: event.ctrlKey,
    linkedRootTargetId: context.linkedRootTargetId || null,
    startPath: [...currentPath],
    navigatedDuringDrag: false,
    didDrop: false
  };
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData("text/plain", item.id);
  event.currentTarget.classList.add("dragging");
  document.documentElement.classList.add("dragging-todo");
  document.documentElement.classList.toggle("link-copy-drag", event.ctrlKey);
  setDragPreview(event, event.currentTarget);
  clearPendingClick();
}

function setDragPreview(event, todo) {
  removeDragPreview();

  const preview = todo.cloneNode(true);
  preview.classList.remove("dragging");
  preview.classList.add("drag-preview");
  preview.querySelectorAll(".item-action").forEach((button) => button.remove());
  if (dragSource?.isLinkCopy) {
    preview.classList.add("link-copy-preview");
    const marker = document.createElement("span");
    marker.className = "drag-link-marker";
    marker.innerHTML = ICONS.link;
    preview.appendChild(marker);
  }

  dragPreview = document.createElement("div");
  dragPreview.className = "drag-preview-wrap";
  dragPreview.appendChild(preview);
  document.body.appendChild(dragPreview);

  const rect = todo.getBoundingClientRect();
  event.dataTransfer.setDragImage(dragPreview, rect.width / 2, rect.height / 2);
}

function handleDividerDragOver(event, targetList, targetParentId, targetDepth, context = {}) {
  if (!isValidDividerDropTarget(targetList, targetParentId, targetDepth)) {
    return;
  }
  event.preventDefault();
  updateLinkCopyDragState(event);
  event.dataTransfer.dropEffect = isLinkCopyDrop(event) ? "copy" : "move";
  clearDragEnterTimer();
  setActiveDropDivider(event.currentTarget);
}

function handleDividerDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) {
    return;
  }
  event.currentTarget.classList.remove("drop-target");
}

function handleDividerDrop(event, targetIndex, targetList, targetParentId, targetDepth, context = {}) {
  event.preventDefault();
  event.currentTarget.classList.remove("drop-target");

  const sourceId = event.dataTransfer.getData("text/plain") || dragSource?.id;
  if (!sourceId || !isValidDividerDropTarget(targetList, targetParentId, targetDepth)) {
    return;
  }

  if (isLinkCopyDrop(event)) {
    const link = createLinkItem(dragSource.target);
    if (!link || isListInsideItem(dragSource.target, targetList)) {
      return;
    }
    dragSource.didDrop = true;
    targetList.splice(targetIndex, 0, link);
    lastMovedItemId = link.id;
    saveState();
    renderWithMoveAnimation();
    return;
  }

  const fromIndex = dragSource.parentList.findIndex((item) => item.id === sourceId);
  if (fromIndex < 0) {
    return;
  }

  const moved = dragSource.parentList[fromIndex];
  if (isListInsideItem(moved, targetList)) {
    return;
  }

  const isSameList = dragSource.parentList === targetList;
  const toIndex = isSameList && fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  if (isSameList && toIndex === fromIndex) {
    return;
  }

  dragSource.didDrop = true;
  dragSource.parentList.splice(fromIndex, 1);
  targetList.splice(toIndex, 0, moved);
  lastMovedItemId = moved.id;
  saveState();
  renderWithMoveAnimation();
}

function handleItemDragOver(event, targetItem, targetList, targetParentId, targetDepth, context = {}) {
  if (!isValidItemDropTarget(targetItem, targetList, targetParentId, targetDepth)) {
    return;
  }
  event.preventDefault();
  updateLinkCopyDragState(event);
  event.dataTransfer.dropEffect = isLinkCopyDrop(event) ? "copy" : "move";
  setActiveSublistDropTarget(event.currentTarget);
  scheduleDragEnterSublist(targetItem);
}

function handleItemDragLeave(event, targetItem) {
  if (event.currentTarget.contains(event.relatedTarget)) {
    return;
  }
  event.currentTarget.classList.remove("sublist-drop-target");
  clearDragEnterTimer(targetItem.id);
}

function handleItemDrop(event, targetItem, targetList, targetParentId, targetDepth, context = {}) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("sublist-drop-target");

  const sourceId = event.dataTransfer.getData("text/plain") || dragSource?.id;
  if (!sourceId || !isValidItemDropTarget(targetItem, targetList, targetParentId, targetDepth)) {
    return;
  }

  const targetResolved = resolveItem(targetItem);
  if (!targetResolved) {
    return;
  }

  if (isLinkCopyDrop(event)) {
    if (targetResolved === dragSource.target || isItemInsideItem(dragSource.target, targetResolved)) {
      return;
    }
    const link = createLinkItem(dragSource.target);
    if (!link) {
      return;
    }
    dragSource.didDrop = true;
    targetResolved.hasSublist = true;
    targetResolved.children ||= [];
    targetResolved.children.push(link);
    lastMovedItemId = link.id;
    saveState();
    focusPathItem(targetItem);
    pendingScrollDepth = currentPath.length;
    navDirection = "forward";
    renderWithMoveAnimation();
    return;
  }

  const fromIndex = dragSource.parentList.findIndex((item) => item.id === sourceId);
  if (fromIndex < 0) {
    return;
  }

  const moved = dragSource.parentList[fromIndex];
  if (targetItem === moved || isItemInsideItem(moved, targetItem)) {
    return;
  }

  dragSource.didDrop = true;
  dragSource.parentList.splice(fromIndex, 1);
  targetResolved.hasSublist = true;
  targetResolved.children ||= [];
  targetResolved.children.push(moved);
  lastMovedItemId = moved.id;
  saveState();

  focusPathItem(targetItem);
  pendingScrollDepth = currentPath.length;
  navDirection = "forward";
  renderWithMoveAnimation();
}

function isValidDividerDropTarget(targetList, targetParentId, targetDepth) {
  return Boolean(dragSource)
    && targetParentId !== dragSource.id
    && targetParentId !== dragSource.target?.id
    && isTargetInsideDragBoundary(targetList)
    && targetDepth === currentPath.length;
}

function isValidItemDropTarget(targetItem, targetList, targetParentId, targetDepth) {
  const targetResolved = resolveItem(targetItem);
  return Boolean(dragSource)
    && isItemDropInsideDragBoundary(targetResolved, targetList, targetDepth)
    && dragSource.id !== targetItem.id
    && dragSource.target !== targetResolved
    && !isItemInsideItem(dragSource.target, targetResolved);
}

function isLinkCopyDrop(event) {
  return Boolean(dragSource?.isLinkCopy || event?.ctrlKey);
}

function updateLinkCopyDragState(event) {
  document.documentElement.classList.toggle("link-copy-drag", isLinkCopyDrop(event));
}

function isTargetInsideDragBoundary(targetList) {
  if (!dragSource?.linkedRootTargetId) {
    return true;
  }
  const linkedRoot = findItemRecord(dragSource.linkedRootTargetId)?.item;
  return Boolean(linkedRoot && isListInsideItem(linkedRoot, targetList));
}

function isItemDropInsideDragBoundary(targetItem, targetList, targetDepth) {
  if (!targetItem) {
    return false;
  }
  if (!dragSource?.linkedRootTargetId) {
    return targetDepth === currentPath.length && targetItem.id !== dragSource.parentId;
  }
  if (targetItem.id === dragSource.linkedRootTargetId) {
    return true;
  }
  const linkedRoot = findItemRecord(dragSource.linkedRootTargetId)?.item;
  return Boolean(linkedRoot && isItemInsideItem(linkedRoot, targetItem));
}

function scheduleDragEnterSublist(item) {
  const children = getItemChildren(item);
  if (!dragSource || dragEnterTargetId === item.id || children.length === 0) {
    return;
  }

  clearDragEnterTimer();
  dragEnterTargetId = item.id;
  dragEnterTimer = window.setTimeout(() => {
    if (!dragSource || dragSource.didDrop || dragEnterTargetId !== item.id || getItemChildren(item).length === 0) {
      return;
    }

    focusPathItem(item);
    dragSource.navigatedDuringDrag = true;
    pendingScrollDepth = currentPath.length;
    navDirection = "forward";
    clearSublistDropTargets();
    renderWithMoveAnimation();
    clearDragEnterTimer();
  }, DRAG_ENTER_DELAY);
}

function clearDragEnterTimer(expectedTargetId) {
  if (expectedTargetId && dragEnterTargetId !== expectedTargetId) {
    return;
  }

  clearTimeout(dragEnterTimer);
  dragEnterTimer = null;
  dragEnterTargetId = null;
}

function isItemInsideItem(parent, candidate) {
  if (!parent?.children?.length || !candidate) {
    return false;
  }
  return parent.children.some((child) => child === candidate || isItemInsideItem(child, candidate));
}

function isListInsideItem(parent, list) {
  if (!parent?.children?.length) {
    return false;
  }
  return parent.children === list || parent.children.some((child) => isListInsideItem(child, list));
}

function setActiveDropDivider(divider) {
  document.querySelectorAll(".divider.drop-target").forEach((target) => {
    if (target !== divider) {
      target.classList.remove("drop-target");
    }
  });
  clearSublistDropTargets();
  divider.classList.add("drop-target");
}

function setActiveSublistDropTarget(todo) {
  document.querySelectorAll(".todo-item.sublist-drop-target").forEach((target) => {
    if (target !== todo) {
      target.classList.remove("sublist-drop-target");
    }
  });
  document.querySelectorAll(".divider.drop-target").forEach((divider) => divider.classList.remove("drop-target"));
  todo.classList.add("sublist-drop-target");
}

function clearSublistDropTargets() {
  document.querySelectorAll(".todo-item.sublist-drop-target").forEach((target) => target.classList.remove("sublist-drop-target"));
}

function renderWithMoveAnimation() {
  const shouldReduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!shouldReduceMotion && document.startViewTransition) {
    document.startViewTransition(() => render());
    return;
  }
  render();
}

function endDrag(event) {
  event.currentTarget.classList.remove("dragging");
  finishDrag(Boolean(dragSource?.didDrop));
}

function finishDrag(dropSucceeded) {
  const source = dragSource;
  clearDragEnterTimer();
  document.documentElement.classList.remove("dragging-todo", "link-copy-drag");
  document.querySelectorAll(".divider.drop-target").forEach((divider) => divider.classList.remove("drop-target"));
  clearSublistDropTargets();
  removeDragPreview();
  dragSource = null;

  if (!dropSucceeded && source?.navigatedDuringDrag) {
    currentPath = [...source.startPath];
    pendingScrollDepth = currentPath.length || null;
    pendingScrollItemId = source.id;
    navDirection = "back";
    renderWithMoveAnimation();
  }
}

function removeDragPreview() {
  dragPreview?.remove();
  dragPreview = null;
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
  const target = resolveItem(item);
  return Boolean(target?.hasSublist) || (Array.isArray(target?.children) && target.children.length > 0);
}

function countDescendants(item) {
  const target = resolveItem(item);
  if (!Array.isArray(target?.children)) {
    return 0;
  }
  return target.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function allDescendantsComplete(item) {
  if (!hasSublist(item)) {
    return false;
  }
  const target = resolveItem(item);
  if (!Array.isArray(target?.children) || target.children.length === 0) {
    return true;
  }
  return target.children.every((child) => {
    const resolved = resolveItem(child);
    return Boolean(resolved?.completed) && allNestedComplete(resolved);
  });
}

function allNestedComplete(item) {
  const target = resolveItem(item);
  return Boolean(target?.completed) && (!Array.isArray(target.children) || target.children.every(allNestedComplete));
}
