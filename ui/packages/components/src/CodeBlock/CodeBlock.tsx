'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert } from '@inngest/components/Alert';
import { Button } from '@inngest/components/Button';
import { CopyButton } from '@inngest/components/CopyButton';
import { maxRenderedOutputSizeBytes } from '@inngest/components/constants';
import { useCopyToClipboard } from '@inngest/components/hooks/useCopyToClipboard';
import { IconExpandText } from '@inngest/components/icons/ExpandText';
import { IconOverflowText } from '@inngest/components/icons/OverflowText';
import { IconShrinkText } from '@inngest/components/icons/ShrinkText';
import { IconWrapText } from '@inngest/components/icons/WrapText';
import { cn } from '@inngest/components/utils/classNames';
import Editor, { useMonaco } from '@monaco-editor/react';
import { RiDownload2Line } from '@remixicon/react';
import { type editor } from 'monaco-editor';
import { useLocalStorage } from 'react-use';
import colors from 'tailwindcss/colors';

import { isDark } from '../utils/theme';

const DARK_RULES = [
  {
    token: 'delimiter.bracket.json',
    foreground: colors.slate['300'],
  },
  {
    token: 'string.key.json',
    foreground: colors.indigo['400'],
  },
  {
    token: 'number.json',
    foreground: colors.amber['400'],
  },
  {
    token: 'string.value.json',
    foreground: colors.emerald['300'],
  },
  {
    token: 'keyword.json',
    foreground: colors.fuchsia['300'],
  },
  {
    token: 'comment',
    fontStyle: 'italic',
    foreground: colors.slate['500'],
  },
  {
    token: 'string',
    foreground: colors.teal['400'],
  },
  {
    token: 'keyword',
    foreground: colors.indigo['400'],
  },
  {
    token: 'entity.name.function',
    foreground: colors.red['500'],
  },
];
const LIGHT_RULES = [
  {
    token: 'delimiter.bracket.json',
    foreground: colors.slate['700'],
  },
  {
    token: 'string.key.json',
    foreground: colors.indigo['600'],
  },
  {
    token: 'number.json',
    foreground: colors.amber['600'],
  },
  {
    token: 'string.value.json',
    foreground: colors.emerald['600'],
  },
  {
    token: 'keyword.json',
    foreground: colors.fuchsia['600'],
  },
  {
    token: 'comment',
    fontStyle: 'italic',
    foreground: colors.slate['500'],
  },
  {
    token: 'string',
    foreground: colors.teal['600'],
  },
  {
    token: 'keyword',
    foreground: colors.indigo['600'],
  },
  {
    token: 'entity.name.function',
    foreground: colors.red['500'],
  },
];

const DARK_COLORS = {
  'editor.background': '#1e293b4d', // slate-800/40
  'editorLineNumber.foreground': '#cbd5e14d', // slate-300/30
  'editorLineNumber.activeForeground': colors.slate['300'], // slate-300
  'editorWidget.background': colors.slate['800'],
  'editorWidget.border': colors.slate['500'],
  'editorBracketHighlight.foreground1': colors.amber['400'],
};

const LIGHT_COLORS = {
  'editor.background': colors.slate['50'],
  'editorLineNumber.foreground': colors.slate['400'],
  'editorLineNumber.activeForeground': colors.slate['600'],
  'editorWidget.background': colors.slate['50'],
  'editorWidget.border': colors.slate['200'],
  'editorBracketHighlight.foreground1': colors.amber['600'],
};

const LINE_HEIGHT = 26;
const MAX_HEIGHT = 280; // Equivalent to 10 lines + padding
const MAX_LINES = 10;
const FONT = {
  size: 13,
  type: 'monospace',
  font: 'RobotoMono',
};

type MonacoEditorType = editor.IStandaloneCodeEditor | null;

export type CodeBlockAction = {
  label: string;
  title?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

interface CodeBlockProps {
  className?: string;
  header?: {
    title?: string;
    status?: 'success' | 'error';
  };
  tab: {
    content: string;
    readOnly?: boolean;
    language?: string;
    handleChange?: (value: string) => void;
  };
  actions?: CodeBlockAction[];
  minLines?: number;
}

export function CodeBlock({ header, tab, actions = [], minLines = 0 }: CodeBlockProps) {
  const [dark, setDark] = useState(isDark());
  const [editorHeight, setEditorHeight] = useState(0);
  const editorRef = useRef<MonacoEditorType>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [isWordWrap, setIsWordWrap] = useLocalStorage('isWordWrap', false);
  const [isFullHeight, setIsFullHeight] = useLocalStorage('isFullHeight', false);

  const { handleCopyClick, isCopying } = useCopyToClipboard();

  const monaco = useMonaco();
  const { content, readOnly = true, language = 'json', handleChange = undefined } = tab;

  useEffect(() => {
    // We don't have a DOM ref until we're rendered, so check for dark theme parent classes then
    if (wrapperRef.current) {
      setDark(isDark(wrapperRef.current));
    }
  });

  useEffect(() => {
    if (!monaco) {
      return;
    }

    monaco.editor.defineTheme('inngest-theme', {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: dark ? DARK_RULES : LIGHT_RULES,
      colors: dark ? DARK_COLORS : LIGHT_COLORS,
    });
  }, [monaco, dark]);

  useEffect(() => {
    if (editorRef.current) {
      updateEditorLayout(editorRef.current);
    }
  }, [isWordWrap, isFullHeight]);

  function getTextWidth(text: string, font: string) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = font;
      const metrics = context.measureText(text);
      return metrics.width;
    } else {
      return text.length;
    }
  }

  function updateEditorLayout(editor: MonacoEditorType) {
    const container = editor?.getDomNode();
    if (!editor || !container) return;
    setEditorHeight(editor.getScrollHeight());
    const containerWidthWithLineNumbers = container.getBoundingClientRect().width;

    if (!isWordWrap) {
      const contentHeight = editor.getContentHeight();
      const contentHeightWithScroll =
        contentHeight + editor.getLayoutInfo().horizontalScrollbarHeight;

      const linesContent = editor.getModel()?.getLinesContent();
      const containerWidth = containerWidthWithLineNumbers - editor.getLayoutInfo().contentLeft;

      let isScroll = false;

      if (linesContent) {
        for (let lineNumber = 1; lineNumber <= linesContent.length; lineNumber++) {
          const lineContent = linesContent[lineNumber - 1];
          const lineLength = lineContent
            ? getTextWidth(lineContent, `${FONT.size}px ${FONT.font}, ${FONT.type}`)
            : 0;

          if (lineLength > containerWidth) {
            isScroll = true;
            break;
          }
        }
      }

      const newHeight = isScroll ? contentHeightWithScroll : contentHeight;

      if (isFullHeight) {
        editor.layout({ height: newHeight, width: containerWidthWithLineNumbers });
        setEditorHeight(newHeight);
      } else {
        const minHeight = minLines * LINE_HEIGHT + 20;
        const height = Math.max(Math.min(MAX_HEIGHT, contentHeight), minHeight);
        editor.layout({ height: height, width: containerWidthWithLineNumbers });
        setEditorHeight(height);
      }
    }

    if (isWordWrap) {
      const containerWidth =
        container.getBoundingClientRect().width -
        editor.getLayoutInfo().contentLeft -
        editor.getLayoutInfo().verticalScrollbarWidth;
      const linesContent = editor.getModel()?.getLinesContent();
      let totalLinesThatFit = 0;

      if (containerWidth && linesContent && linesContent.length > 0) {
        for (let lineNumber = 1; lineNumber <= linesContent.length; lineNumber++) {
          const lineContent = linesContent[lineNumber - 1];

          const lineLength = lineContent
            ? getTextWidth(lineContent, `${FONT.size}px ${FONT.font}, ${FONT.type}`)
            : 0;

          if (lineLength <= containerWidth) {
            totalLinesThatFit++;
          } else {
            // When using word wrap, monaco breaks keys and values in different lines
            const keyValuePair = lineContent?.split(':');
            let linesNeeded = 1;
            if (keyValuePair && keyValuePair.length === 2 && keyValuePair[0] && keyValuePair[1]) {
              const initialSpaces = (keyValuePair[0]?.match(/^\s*/) || [])[0];
              const keyLength = getTextWidth(
                keyValuePair[0] ?? '',
                `${FONT.size}px ${FONT.font}, ${FONT.type}`
              );
              const valueLength = getTextWidth(
                keyValuePair[1] + initialSpaces,
                `${FONT.size}px ${FONT.font}, ${FONT.type}`
              );
              const keyLinesNeeded = Math.ceil(keyLength / containerWidth);
              const valueLinesNeeded = Math.ceil(valueLength / containerWidth);
              linesNeeded = keyLinesNeeded + valueLinesNeeded;
            } else {
              linesNeeded = Math.ceil(lineLength / containerWidth);
            }
            totalLinesThatFit += linesNeeded;
          }
        }
      }

      if (totalLinesThatFit > MAX_LINES && !isFullHeight) {
        editor.layout({ height: MAX_HEIGHT, width: containerWidthWithLineNumbers });
        setEditorHeight(MAX_HEIGHT);
      } else {
        editor.layout({
          height: totalLinesThatFit * LINE_HEIGHT + 20,
          width: containerWidthWithLineNumbers,
        });
        setEditorHeight(totalLinesThatFit * LINE_HEIGHT + 20);
      }
    }
  }

  const handleFullHeight = () => {
    if (editorRef.current) {
      setIsFullHeight(!isFullHeight);
    }
  };

  const handleWrapText = () => {
    const newWordWrap = isWordWrap ? 'off' : 'on';
    setIsWordWrap(!isWordWrap);
    if (editorRef.current) {
      editorRef.current.updateOptions({ wordWrap: newWordWrap });
    }
  };

  // This prevents larger outputs from crashing the browser
  const isOutputTooLarge = (content?.length ?? 0) > maxRenderedOutputSizeBytes;

  const downloadJson = ({ content }: { content?: string }) => {
    if (content) {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const element = document.createElement('a');
      element.href = url;
      element.download = 'data.json'; // Set the file name with a .json extension
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      {monaco && (
        <>
          <div
            className={cn(
              'border-b border-b-slate-300 bg-slate-50 dark:border-slate-700/20 dark:bg-slate-800/40 dark:shadow'
            )}
          >
            <div
              className={cn(
                'flex items-center justify-between border-l-4 border-l-transparent',
                header?.status === 'error' && 'border-l-status-failed',
                header?.status === 'success' && 'border-l-status-completed'
              )}
            >
              <p
                className={cn(
                  header?.status === 'error' ? 'text-status-failedText' : 'text-muted',
                  ' px-5 py-2.5 text-sm'
                )}
              >
                {header?.title}
              </p>
              {!isOutputTooLarge && (
                <div className="mr-4 flex items-center gap-2 py-2">
                  {actions.map(({ label, title, icon, onClick, disabled }, idx) => (
                    <Button
                      key={idx}
                      icon={icon}
                      btnAction={onClick}
                      size="small"
                      aria-label={label}
                      title={title ?? label}
                      label={label}
                      disabled={disabled}
                      appearance="outlined"
                    />
                  ))}
                  <CopyButton
                    size="small"
                    code={content}
                    isCopying={isCopying}
                    handleCopyClick={handleCopyClick}
                    appearance="outlined"
                  />
                  <Button
                    icon={isWordWrap ? <IconOverflowText /> : <IconWrapText />}
                    btnAction={handleWrapText}
                    size="small"
                    aria-label={isWordWrap ? 'Do not wrap text' : 'Wrap text'}
                    title={isWordWrap ? 'Do not wrap text' : 'Wrap text'}
                    tooltip={isWordWrap ? 'Do not wrap text' : 'Wrap text'}
                    appearance="outlined"
                  />
                  <Button
                    btnAction={handleFullHeight}
                    size="small"
                    icon={isFullHeight ? <IconShrinkText /> : <IconExpandText />}
                    aria-label={isFullHeight ? 'Shrink text' : 'Expand text'}
                    title={isFullHeight ? 'Shrink text' : 'Expand text'}
                    tooltip={isFullHeight ? 'Shrink text' : 'Expand text'}
                    appearance="outlined"
                  />
                </div>
              )}
            </div>
          </div>
          {/* Content */}
          <div ref={wrapperRef}>
            {isOutputTooLarge ? (
              <>
                <Alert severity="warning">Output size is too large to render {`( > 1MB )`}</Alert>
                <div className="flex h-24 items-center justify-center	">
                  <Button
                    label="Download Raw"
                    icon={<RiDownload2Line />}
                    btnAction={() => downloadJson({ content: content })}
                    appearance="outlined"
                  />
                </div>
              </>
            ) : (
              <Editor
                className="absolute"
                height={editorHeight}
                defaultLanguage={language}
                value={content}
                theme="inngest-theme"
                options={{
                  // Need to set automaticLayout to true to avoid a resizing bug
                  // (code block never narrows). This is combined with the
                  // `absolute` class and explicit height prop
                  automaticLayout: true,

                  extraEditorClassName: '!w-full',
                  readOnly: readOnly,
                  minimap: {
                    enabled: false,
                  },
                  lineNumbers: 'on',
                  contextmenu: false,
                  scrollBeyondLastLine: false,
                  fontFamily: FONT.font,
                  fontSize: FONT.size,
                  fontWeight: 'light',
                  lineHeight: LINE_HEIGHT,
                  renderLineHighlight: 'none',
                  renderWhitespace: 'none',
                  guides: {
                    indentation: false,
                    highlightActiveBracketPair: false,
                    highlightActiveIndentation: false,
                  },
                  scrollbar: {
                    verticalScrollbarSize: 10,
                    alwaysConsumeMouseWheel: false,
                  },
                  padding: {
                    top: 10,
                    bottom: 10,
                  },
                  wordWrap: isWordWrap ? 'on' : 'off',
                }}
                onMount={(editor) => {
                  updateEditorLayout(editor);
                }}
                onChange={(value) => {
                  if (value !== undefined) {
                    handleChange && handleChange(value);
                    updateEditorLayout(editorRef.current);
                  }
                }}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

CodeBlock.Wrapper = ({ children }: React.PropsWithChildren) => {
  return (
    <div
      className="border-muted w-full overflow-hidden rounded-lg
     border dark:border-slate-700/30 dark:shadow"
    >
      {children}
    </div>
  );
};
