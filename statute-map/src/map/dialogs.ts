/** Small in-app replacements for window.prompt/confirm, which can't follow the
 *  app's theme and block the whole page while they're open. */

interface DialogParts {
  dialog: HTMLDialogElement;
  actions: HTMLDivElement;
  /** Adds a button that closes the dialog with `value`. */
  addButton(label: string, value: string, className?: string): void;
  /** Closes the dialog with `value`, as a button would. */
  settle(value: string): void;
}

function openDialog(onSettle: (value: string) => void): DialogParts {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";

  let settled = false;
  const settle = (value: string) => {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onSettle(value);
  };
  // Escape closes the dialog natively, with no button involved.
  dialog.addEventListener("close", () => settle("cancel"));

  const addButton = (label: string, value: string, className = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", () => settle(value));
    actions.appendChild(button);
  };
  return { dialog, actions, addButton, settle };
}

export function promptDialog(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    input.maxLength = 200;

    const { dialog, actions, addButton, settle } = openDialog((value) => resolve(value === "ok" ? input.value : null));
    const label = document.createElement("label");
    label.textContent = title;
    label.appendChild(input);
    addButton("Cancel", "cancel");
    addButton("Save", "ok", "primary");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        settle("ok");
      }
    });

    dialog.append(label, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
    input.select();
  });
}

export function confirmDialog(title: string, detail: string, actionLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { dialog, actions, addButton } = openDialog((value) => resolve(value === "ok"));
    const heading = document.createElement("p");
    heading.className = "app-dialog-title";
    heading.textContent = title;
    const note = document.createElement("p");
    note.textContent = detail;
    addButton("Cancel", "cancel");
    addButton(actionLabel, "ok", "danger");

    dialog.append(heading, note, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
