import { useEffect, useRef } from "react";
import { TERMINAL_FONT_FAMILY, terminalFontOptions } from "../appearance";
import { monacoLanguageForPath } from "../monacoLanguages";
import { applyMonacoTheme, monaco } from "../monacoSetup";
import "./FileEditor.css";

/**
 * Monaco text editor for one file. The parent owns the draft text: the editor
 * reports every change and asks the parent to save on Ctrl/Cmd+S. `value` is
 * only applied when it differs from the model, e.g. after Revert or Reload.
 */
export function FileEditor({
  path,
  value,
  theme,
  uiScale = 100,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  theme: "dark" | "light";
  uiScale?: number;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applyMonacoTheme(theme);
    const model = monaco.editor.createModel(value, monacoLanguageForPath(path));
    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: terminalFontOptions(false, uiScale).fontSize,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      smoothScrolling: true,
      tabSize: 2,
      detectIndentation: true,
      wordWrap: /\.(md|markdown|txt)$/i.test(path) ? "on" : "off",
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    const subscription = model.onDidChangeContent(() =>
      onChangeRef.current(model.getValue()),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current(),
    );
    editor.focus();
    return () => {
      subscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // The model is created once per path; value/theme updates apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);

  useEffect(() => {
    applyMonacoTheme(theme);
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: terminalFontOptions(false, uiScale).fontSize,
    });
  }, [uiScale]);

  return (
    <div
      ref={containerRef}
      className="file-editor"
      role="region"
      aria-label={`Editor for ${path}`}
    />
  );
}
