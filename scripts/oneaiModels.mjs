// OneAI 模型解析器 (DRY 共用)。讀/寫 config/oneai.models.json,
// 提供「目前要用哪個模型」給各服務與 CLI。模型 id 一律來自登錄表,不寫死。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY_PATH = join(ROOT, 'config', 'oneai.models.json')

export function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  } catch (err) {
    throw new Error(`無法讀取模型登錄表 ${REGISTRY_PATH}: ${err.message}`)
  }
}

function saveRegistry(reg) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8')
}

// 別名 -> 真實模型 id;找不到別名時當作已是真實 id 直接回傳。
export function resolveAlias(alias, reg = loadRegistry()) {
  return reg.aliases?.[alias] ?? alias
}

// 目前作用中的模型 id(全域預設)。
export function activeModel(reg = loadRegistry()) {
  return resolveAlias(reg.active, reg)
}

// 指定角色(brain/distill/code...)的模型;沒設定就退回全域 active。
export function modelForRole(role, reg = loadRegistry()) {
  const alias = reg.roles?.[role] ?? reg.active
  return resolveAlias(alias, reg)
}

export function listAliases(reg = loadRegistry()) {
  return reg.aliases ?? {}
}

export function setActive(alias) {
  const reg = loadRegistry()
  if (!reg.aliases?.[alias]) {
    throw new Error(`未知別名「${alias}」。可用:${Object.keys(reg.aliases ?? {}).join(', ')}`)
  }
  reg.active = alias
  saveRegistry(reg)
  return resolveAlias(alias, reg)
}

export function setRole(role, alias) {
  const reg = loadRegistry()
  if (!reg.aliases?.[alias]) {
    throw new Error(`未知別名「${alias}」。可用:${Object.keys(reg.aliases ?? {}).join(', ')}`)
  }
  reg.roles = reg.roles ?? {}
  reg.roles[role] = alias
  saveRegistry(reg)
  return resolveAlias(alias, reg)
}
