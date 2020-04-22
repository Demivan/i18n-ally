import { window, DecorationOptions, Range, Disposable, workspace, TextEditorDecorationType, TextEditor } from 'vscode'
import throttle from 'lodash/throttle'
import { Global, KeyDetector, Config, Loader, CurrentFile } from '../core'
import { ExtensionModule } from '../modules'
import { getCommentState } from '../utils/shared'
import { createHover } from './hover'

const underlineDecorationType = window.createTextEditorDecorationType({
  textDecoration: 'underline',
})

const disappearDecorationType = window.createTextEditorDecorationType({
  textDecoration: 'none; display: none;',
})

export type DecorationOptionsWithGutter = DecorationOptions & {gutterType: string}

const annotation: ExtensionModule = (ctx) => {
  const gutterTypes: Record<string, TextEditorDecorationType> = {
    none: window.createTextEditorDecorationType({}),
    approve: window.createTextEditorDecorationType({
      gutterIconPath: ctx.asAbsolutePath('res/dark/checkmark.svg'),
    }),
    request_change: window.createTextEditorDecorationType({
      gutterIconPath: ctx.asAbsolutePath('res/dark/review-request-change.svg'),
    }),
    comment: window.createTextEditorDecorationType({
      gutterIconPath: ctx.asAbsolutePath('res/dark/review-comment.svg'),
    }),
    conflict: window.createTextEditorDecorationType({
      gutterIconPath: ctx.asAbsolutePath('res/dark/review-conflict.svg'),
    }),
    missing: window.createTextEditorDecorationType({
      gutterIconPath: ctx.asAbsolutePath('res/dark/empty.svg'),
    }),
  }

  const setDecorationsWithGutter = (
    annotations: DecorationOptionsWithGutter[],
    editor: TextEditor,
  ) => {
    const dict: Record<string, DecorationOptions[]> = {
      none: [],
      approve: [],
      request_change: [],
      comment: [],
      conflict: [],
      missing: [],
    }

    for (const annotation of annotations)
      dict[annotation.gutterType].push(annotation)

      ;(Object.keys(gutterTypes))
      .forEach(k =>
        editor.setDecorations(gutterTypes[k], dict[k]),
      )
  }

  function update() {
    if (!Global.enabled)
      return

    const editor = window.activeTextEditor
    if (!editor)
      return

    const loader: Loader = CurrentFile.loader
    const document = editor.document
    const usages = KeyDetector.getUsages(document, loader)
    if (!usages)
      return

    const selection = editor.selection
    const { keys, locale, namespace, type: usageType } = usages

    const annotationDelimiter = Config.annotationDelimiter
    const annotations: DecorationOptionsWithGutter[] = []
    const underlines: DecorationOptions[] = []
    const inplaces: DecorationOptions[] = []
    const maxLength = Config.annotationMaxLength
    const showAnnonations = Config.annotations && locale

    // get all keys of current file
    keys.forEach(({ key, start, end }, i) => {
      if (namespace)
        key = `${namespace}.${key}`

      let text: string | undefined
      let missing = false
      let inplace = Config.annotationInPlace
      let editing = false
      const range = new Range(
        document.positionAt(start),
        document.positionAt(end),
      )
      const rangeWithQuotes = new Range(
        document.positionAt(start - 1),
        document.positionAt(end + 1),
      )

      if (usageType === 'locale') {
        inplace = false
        if (locale !== Config.sourceLanguage) {
          text = loader.getValueByKey(key, Config.sourceLanguage, maxLength)
          // has source message but not current
          if (!loader.getValueByKey(key, locale))
            missing = true
        }
      }
      else {
        if (selection.start.line >= range.start.line && selection.end.line <= range.end.line) {
          editing = true
          inplace = false
        }

        text = loader.getValueByKey(key, locale, maxLength)
        // fallback to source
        if (!text && locale !== Config.sourceLanguage) {
          text = loader.getValueByKey(key, Config.sourceLanguage, maxLength)
          missing = true
        }
      }

      if (text && !inplace)
        text = `${annotationDelimiter}${text}`

      if (editing)
        text = ''

      const color = missing
        ? 'rgba(153, 153, 153, .3)'
        : 'rgba(153, 153, 153, .8)'

      let gutterType = 'none'
      if (missing)
        gutterType = 'missing'
      if (Config.reviewEnabled) {
        const comments = Global.reviews.getComments(key, locale)
        gutterType = getCommentState(comments) || gutterType
      }

      if (inplace) {
        inplaces.push({
          range: rangeWithQuotes,
        })
      }
      else if (usageType === 'code') {
        underlines.push({
          range,
        })
      }

      annotations.push({
        range: rangeWithQuotes,
        renderOptions: {
          after: {
            color,
            contentText: showAnnonations ? text : '',
            fontWeight: 'normal',
            fontStyle: 'normal',
          },
        },
        hoverMessage: createHover(key, maxLength, undefined, i),
        gutterType,
      })
    })

    setDecorationsWithGutter(annotations, editor)

    editor.setDecorations(underlineDecorationType, underlines)
    editor.setDecorations(disappearDecorationType, inplaces)
  }

  const throttledUpdate = throttle(() => update(), 500)

  const disposables: Disposable[] = []
  disposables.push(CurrentFile.loader.onDidChange(throttledUpdate))
  disposables.push(window.onDidChangeActiveTextEditor(throttledUpdate))
  disposables.push(window.onDidChangeTextEditorSelection(throttledUpdate))
  disposables.push(workspace.onDidChangeTextDocument(throttledUpdate))
  disposables.push(Global.reviews.onDidChange(throttledUpdate))

  update()

  return disposables
}

export default annotation
