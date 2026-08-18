// ============================================================
// Monaco 的"定制入口"文件 —— 整个 Monaco 库在这里被引入，也是裁剪体积的核心。
//
// 为什么需要定制入口？
//   如果直接 import('monaco-editor')，会带上 4 个"语言服务 worker"——
//   TypeScript/JavaScript、CSS、HTML、JSON 的智能提示能力，TS 一个就约 7MB。
//   而本项目是"片段收藏/浏览"，不需要 IDE 级智能提示（自动补全/错误诊断），
//   只需要"语法高亮 + 标准编辑器功能"。
//   所以这里只引入：核心 API + 语法高亮 + 按需的功能模块，剪掉那 4 个 worker。
//
// ⚠️ 本文件由脚本 _gen-monaco-entry.cjs 生成（裁剪自 editor.main.js）。
//    改这个文件请重新生成或手动同步，否则下次生成会被覆盖。
// ============================================================

// Monaco 的核心 API（monaco.editor.create、monaco.KeyCode 等都从这里导出）
export * from 'monaco-editor/editor/editor.api'

// 语法高亮：basic-languages 给所有语言提供"颜色着色规则"（tokenizer）。
// 有了它，Python/Java/JavaScript 等才能显示彩色高亮。这是"廉价"的语言支持——
// 只管颜色，不做智能分析。上面说的 4 个 worker 才是"智能"的部分，已剪掉。
import 'monaco-editor/basic-languages/monaco.contribution'

// ============================================================
// 下面这一长串 import 全是"编辑器功能模块"（contributions）。
// Monaco 把每个功能拆成独立模块，import 哪行就注册哪个功能。
// 看不懂每行没关系——它们合起来就是让编辑器具备标准交互能力：
//   括号匹配、代码折叠、查找替换、多光标、复制粘贴、上下文菜单、格式化……
// 把整段理解为"把编辑器该有的标准功能都装上"即可，不必逐行深究。
// （注意：这里刻意没有引入 4 个语言服务的 worker，所以没有智能提示。）
// ============================================================
import 'monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions'
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget'
import 'monaco-editor/editor/contrib/codelens/browser/codelensController'
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo'
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution'
import 'monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution'
import 'monaco-editor/editor/contrib/dnd/browser/dnd'
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution'
import 'monaco-editor/features/find/register'
import 'monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution'
import 'monaco-editor/editor/contrib/folding/browser/folding'
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom'
import 'monaco-editor/editor/contrib/format/browser/formatActions'
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition'
import 'monaco-editor/editor/contrib/gpu/browser/gpuActions'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution'
import 'monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution'
import 'monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress'
import 'monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace'
import 'monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine'
import 'monaco-editor/editor/standalone/browser/inspectTokens/inspectTokens'
import 'monaco-editor/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard'
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing'
import 'monaco-editor/editor/contrib/links/browser/links'
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper'
import 'monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints'
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess'
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution'
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch'
import 'monaco-editor/editor/contrib/rename/browser/rename'
import 'monaco-editor/editor/contrib/sectionHeaders/browser/sectionHeaders'
import 'monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens'
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect'
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2'
import 'monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution'
import 'monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions'
import 'monaco-editor/editor/standalone/browser/toggleHighContrast/toggleHighContrast'
import 'monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization'
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter'
import 'monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators'
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands'
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus'
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/editor/common/standaloneStrings'
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css'
