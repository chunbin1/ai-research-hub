// 把当前路由生成的 OpenAPI 写到目录里，方便交给第三方。不监听端口，也不读数据库。
//
//   pnpm --filter @arh/server exec tsx scripts/export-openapi.ts /opt/cursor/artifacts
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { registerHttpRoutes } from '../src/http.js'

const outDir = resolve(process.argv[2] ?? '/opt/cursor/artifacts')
const app = Fastify({ logger: false })
await registerHttpRoutes(app)
await app.ready()

const json = app.swagger()
const yaml = app.swagger({ yaml: true })
await mkdir(outDir, { recursive: true })
await writeFile(resolve(outDir, 'openapi.json'), `${JSON.stringify(json, null, 2)}\n`)
await writeFile(resolve(outDir, 'openapi.yaml'), yaml.endsWith('\n') ? yaml : `${yaml}\n`)
await app.close()
console.log(resolve(outDir, 'openapi.json'))
console.log(resolve(outDir, 'openapi.yaml'))
