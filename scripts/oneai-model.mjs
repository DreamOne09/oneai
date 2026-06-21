#!/usr/bin/env node
// OneAI 一句話切換模型 CLI。
//   npm run model              顯示目前作用中的模型與所有別名
//   npm run model <別名>        切換全域預設模型 (例: npm run model claude)
//   npm run model role <角色> <別名>   設定某角色的模型 (例: npm run model role distill fast)
import { loadRegistry, activeModel, listAliases, setActive, setRole } from './oneaiModels.mjs'

function printState() {
  const reg = loadRegistry()
  console.log(`Gateway : ${reg.gateway}`)
  console.log(`Active  : ${reg.active} -> ${activeModel(reg)}`)
  console.log('Aliases :')
  for (const [alias, id] of Object.entries(listAliases(reg))) {
    console.log(`  ${alias.padEnd(12)} ${id}`)
  }
  if (reg.roles && Object.keys(reg.roles).length) {
    console.log('Roles   :')
    for (const [role, alias] of Object.entries(reg.roles)) {
      console.log(`  ${role.padEnd(12)} ${alias}`)
    }
  }
}

const [arg1, arg2, arg3] = process.argv.slice(2)

try {
  if (!arg1) {
    printState()
  } else if (arg1 === 'role') {
    if (!arg2 || !arg3) throw new Error('用法: npm run model role <角色> <別名>')
    const id = setRole(arg2, arg3)
    console.log(`已將角色「${arg2}」設為 ${arg3} -> ${id}`)
  } else {
    const id = setActive(arg1)
    console.log(`已切換預設模型為 ${arg1} -> ${id}`)
  }
} catch (err) {
  console.error(`錯誤: ${err.message}`)
  process.exit(1)
}
