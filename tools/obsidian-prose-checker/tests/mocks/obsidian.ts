import { StateField } from "@codemirror/state"

export const editorInfoField = StateField.define<{ file: null }>({
  create: () => ({ file: null }),
  update: (value) => value,
})
