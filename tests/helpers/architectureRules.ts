import ts from 'typescript'
import { posix } from 'node:path'

export function violations(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const errors: string[] = []
  const layer = path.replaceAll('\\', '/').split('src/main/')[1]?.split('/')[0]
  const pure = new Set(['path', 'crypto', 'buffer', 'util', 'timers', 'timers/promises'])
  const allowed: Record<string, string[]> = {
    ipc: ['ipc', 'contracts'],
    services: ['services', 'contracts', 'utils'],
    adapters: ['adapters', 'contracts', 'utils'],
    contracts: ['contracts'],
    utils: ['utils', 'contracts'],
    'index.ts': ['bootstrap', 'ipc', 'adapters', 'contracts', 'utils']
  }
  const dependency = (value: string, node: ts.Node): void => {
    if (value.startsWith('.')) {
      const target = posix.normalize(posix.join(posix.dirname(path), value))
      const targetLayer = target.split('src/main/')[1]?.split('/')[0]
      if (targetLayer && allowed[layer ?? ''] && !allowed[layer!].includes(targetLayer))
        errors.push(`${path}: forbidden ${layer} -> ${targetLayer}: ${value}`)
      return
    }
    if (layer === 'ipc' && value === 'electron' && ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings
      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        !node.importClause?.name &&
        bindings.elements.every(
          (item) =>
            (item.propertyName ?? item.name).text === 'ipcMain' ||
            ((item.isTypeOnly || node.importClause?.isTypeOnly) &&
              ['IpcMain', 'IpcMainInvokeEvent'].includes((item.propertyName ?? item.name).text))
        )
      )
        return
    }
    if (['services', 'utils', 'contracts', 'ipc'].includes(layer ?? '')) {
      const name = value.replace(/^node:/, '')
      if (value === 'zod' || (layer !== 'ipc' && layer !== 'contracts' && pure.has(name))) return
      errors.push(`${path}: forbidden external dependency ${value}`)
    }
    if (layer === 'index.ts' && value === 'electron' && ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings
      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((item) =>
          ['BrowserWindow', 'shell', 'dialog'].includes(item.name.text)
        )
      )
        errors.push(`${path}: native window responsibilities belong to adapters`)
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ['services', 'utils', 'ipc', 'contracts'].includes(layer ?? '') &&
      ts.isIdentifier(node) &&
      node.text === 'fetch'
    )
      errors.push(`${path}: fetch belongs to an adapter`)
    if (
      layer === 'utils' &&
      ts.isVariableStatement(node) &&
      node.parent === file &&
      (!(node.declarationList.flags & ts.NodeFlags.Const) ||
        node.declarationList.declarations.some(
          (item) =>
            item.initializer &&
            ts.isNewExpression(item.initializer) &&
            ts.isIdentifier(item.initializer.expression) &&
            ['Map', 'Set'].includes(item.initializer.expression.text)
        ))
    )
      errors.push(`${path}: mutable module state does not belong in utils`)
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      dependency(node.moduleSpecifier.text, node)
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (
        (expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && expression.text === 'require')) &&
        ['services', 'utils', 'ipc', 'contracts'].includes(layer ?? '') &&
        (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0]))
      )
        errors.push(`${path}: computed imports cannot bypass dependency boundaries`)
      if (
        (expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependency(node.arguments[0].text, node)
      if (
        ['services', 'utils', 'ipc', 'contracts'].includes(layer ?? '') &&
        ((ts.isIdentifier(expression) && expression.text === 'fetch') ||
          (ts.isPropertyAccessExpression(expression) && expression.name.text === 'fetch'))
      )
        errors.push(`${path}: direct fetch belongs to an adapter`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return errors
}
