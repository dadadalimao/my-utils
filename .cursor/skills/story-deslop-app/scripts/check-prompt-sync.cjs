#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const clientRoot = path.join(repoRoot, 'apps', 'mini', 'apps', 'client')
const serverRoot = path.join(repoRoot, 'apps', 'mini', 'apps', 'server')
const clientTemplates = path.join(clientRoot, 'src', 'constants', 'templates.ts')
const serverSeed = path.join(serverRoot, 'prisma', 'seed.ts')
const databaseFile = path.join(serverRoot, 'prisma', 'dev.db')

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

for (const file of [clientTemplates, serverSeed]) {
  if (!fs.existsSync(file)) {
    fail(`Missing prompt source: ${file}`)
    process.exit()
  }
}

let ts
try {
  ts = createRequire(path.join(clientRoot, 'package.json'))('typescript')
} catch {
  fail(`Cannot load TypeScript from ${path.join(clientRoot, 'node_modules')}`)
  process.exit()
}

function readPromptSource(file, templatesName) {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const constants = new Map()

  function readText(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text
    }
    if (ts.isIdentifier(node)) {
      return constants.get(node.text)?.value ?? null
    }
    if (!ts.isTemplateExpression(node)) return null
    let value = node.head.text
    for (const span of node.templateSpans) {
      if (!ts.isIdentifier(span.expression)) return null
      const part = constants.get(span.expression.text)
      if (part === undefined) return null
      value += part.value + span.literal.text
    }
    return value
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const value = readText(declaration.initializer)
      if (value === null) continue
      const pos = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile))
      constants.set(declaration.name.text, {
        value,
        line: pos.line + 1,
      })
    }
  }

  const templates = []
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== templatesName ||
        !declaration.initializer ||
        !ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        continue
      }
      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue
        const values = {}
        for (const property of element.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            !ts.isIdentifier(property.name) ||
            !['mode', 'name', 'content'].includes(property.name.text)
          ) {
            continue
          }
          values[property.name.text] = readText(property.initializer)
        }
        templates.push(values)
      }
    }
  }

  return { constants, templates }
}

const client = readPromptSource(clientTemplates, 'BUILTIN_TEMPLATES')
const server = readPromptSource(serverSeed, 'TEMPLATES')
const names = new Set([...client.constants.keys(), ...server.constants.keys()])
const mismatches = []

for (const name of [...names].sort()) {
  const left = client.constants.get(name)
  const right = server.constants.get(name)
  if (!left) {
    mismatches.push(`${name}: missing in client templates.ts`)
    continue
  }
  if (!right) {
    mismatches.push(`${name}: missing in server seed.ts`)
    continue
  }
  if (left.value !== right.value) {
    mismatches.push(
      `${name}: client line ${left.line} (${left.value.length} chars) != ` +
        `server line ${right.line} (${right.value.length} chars)`,
    )
  }
}

const clientByName = new Map(client.templates.map((item) => [`${item.mode}:${item.name}`, item]))
const serverByName = new Map(server.templates.map((item) => [`${item.mode}:${item.name}`, item]))
for (const key of new Set([...clientByName.keys(), ...serverByName.keys()])) {
  if (!clientByName.has(key)) {
    mismatches.push(`${key}: template missing in client templates.ts`)
    continue
  }
  if (!serverByName.has(key)) {
    mismatches.push(`${key}: template missing in server seed.ts`)
    continue
  }
  if (clientByName.get(key).content !== serverByName.get(key).content) {
    mismatches.push(`${key}: template content differs between client and seed`)
  }
}

async function main() {
  let databaseRows = []
  if (process.env.SKIP_PROMPT_DB_CHECK !== '1' && fs.existsSync(databaseFile)) {
    try {
      const { PrismaClient } = createRequire(path.join(serverRoot, 'package.json'))('@prisma/client')
      const dbUrl = `file:${databaseFile.replace(/\\/g, '/')}`
      const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
      try {
        databaseRows = await prisma.promptTemplate.findMany({
          select: { mode: true, name: true, content: true, enabled: true },
        })
      } finally {
        await prisma.$disconnect()
      }
    } catch (error) {
      mismatches.push(`database templates could not be read: ${error.message}`)
    }

    for (const expected of client.templates) {
      const key = `${expected.mode}:${expected.name}`
      const matched = databaseRows.filter(
        (item) => item.mode === expected.mode && item.name === expected.name,
      )
      if (!matched.length) {
        mismatches.push(`${key}: template missing in database`)
      } else if (matched.length > 1) {
        mismatches.push(`${key}: duplicate database records`)
      } else if (!matched[0].enabled) {
        mismatches.push(`${key}: database template is disabled`)
      } else if (matched[0].content !== expected.content) {
        mismatches.push(`${key}: database content differs from client template`)
      }
    }
  }

  if (mismatches.length) {
    console.error('Prompt template sync: FAILED')
    for (const mismatch of mismatches) console.error(`- ${mismatch}`)
    process.exitCode = 1
  } else {
    const dbStatus =
      process.env.SKIP_PROMPT_DB_CHECK === '1' || !fs.existsSync(databaseFile)
        ? 'database skipped'
        : `${databaseRows.length} database rows checked`
    console.log(
      `Prompt template sync: OK (${names.size} constants, ` +
        `${client.templates.length} templates, ${dbStatus})`,
    )
  }
}

main().catch((error) => {
  console.error(`Prompt template sync: FAILED (${error.message})`)
  process.exitCode = 1
})
