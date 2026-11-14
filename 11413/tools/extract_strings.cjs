// Collect every translatable string in ui/src (first argument of t(), T(); 2nd and 3rd of plural()) -> smart_stall/ui_strings.json
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')
const ROOT = 'c:/Users/LokeshKumarYerra(Qua/Desktop/Paytm-Ai-Hackathon/11413'
const req = createRequire(ROOT + '/ui/package.json')
const parser = req('@babel/parser')
const out = new Set()

function lit(n) {
  if (!n) return null
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return null
}
function walk(node) {
  if (!node || typeof node.type !== 'string') return
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    const nm = node.callee.name
    const idx = nm === 't' || nm === 'T' ? [0] : nm === 'plural' ? [1, 2] : []
    for (const i of idx) { const v = lit(node.arguments[i]); if (v && /[A-Za-z]{2}/.test(v.replace(/\{\d+\}/g, ''))) out.add(v) }
  }
  for (const k of Object.keys(node)) {
    if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) continue
    const v = node[k]
    Array.isArray(v) ? v.forEach(walk) : walk(v)
  }
}
function files(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : /\.(jsx?|)$/.test(e.name) && /\.jsx?$/.test(e.name) ? [path.join(d, e.name)] : [])
}
for (const f of files(ROOT + '/ui/src')) {
  walk(parser.parse(fs.readFileSync(f, 'utf-8'), { sourceType: 'module', plugins: ['jsx'] }).program)
}
// The sentences the server sends and the screen shows through td(): worth translating ahead of time too.
const extra = JSON.parse(fs.existsSync(ROOT + '/smart_stall/ui_extra.json') ? fs.readFileSync(ROOT + '/smart_stall/ui_extra.json', 'utf-8') : '[]')
extra.forEach((s) => out.add(s))
const list = [...out].sort()
fs.writeFileSync(ROOT + '/smart_stall/ui_strings.json', JSON.stringify(list, null, 1))
console.log(list.length, 'strings')
