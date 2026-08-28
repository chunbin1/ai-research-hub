# 研报站 数据库查询手册

排查检索问题、看 trace、核对索引状态时用。系统自带的 `sqlite3`(3.43+)就够,
**FTS5 和 trigram 都支持**,不用装任何东西。

## 两个库在哪

命令**都从 `packages/server/` 下执行** —— 服务端的 CWD 就是这里,相对路径才对得上。

| 路径 | 内容 |
|---|---|
| `data/research.db` | 主库:文档、FTS 索引、trace、聊天、用户、股票信号 |
| `../../data/chroma/chroma.sqlite3` | ChromaDB 的库:向量 + metadata |

原文不在库里,在 `data/raw/<docId>.md` 文件里。

**生产环境**进容器执行:

```bash
docker --context ai-research-hub exec ai-research-hub-server-1 \
  node -e "…"
```

---

## 起手式

```bash
cd packages/server
sqlite3 data/research.db
```

进去先设两个开关,输出立刻好看很多:

```
.mode box
.headers on
```

常用点命令(不加分号):

```
.tables                 列出所有表
.schema chunk_fts       看建表语句
.schema                 看全部
.mode box               表格输出(还有 line / json / csv)
.width 12 40 8          手动定列宽
.once /tmp/out.txt      下一条查询结果写文件
.quit                   退出
```

不进交互模式,一条命令直接跑:

```bash
sqlite3 data/research.db -box "select * from documents;"
```

> **服务在跑也能读** —— 库是 WAL 模式,支持并发读。但不要在里面写。

---

## ⚠️ FTS5 虚表的三个坑

`chunk_fts` 是 FTS5 虚表,行为由模块自己实现,和普通表不一样。这三条都是
**静默出错、不报警**,踩过一次就够了。

### ① `LIKE` 可能静默返回 0 行

```sql
select count(*) from chunk_fts where doc_id like 'doc%';    -- 0   ❌
select count(*) from chunk_fts where doc_id like '%doc%';   -- 0   ❌
select count(*) from chunk_fts where doc_id = 'doc_1787…';  -- 1   ✅
```

不报错,就是查不到。原因是 SQLite 把 `LIKE` 约束**下推给了 FTS5 模块**,
而模块处理不了就返回空。

行为按列而异且不直观 —— `content` / `section_title` / `section_slug` 上
`LIKE` 正常,偏偏 `doc_id` 不行。**别去记哪列行哪列不行,直接避开:**

```sql
where doc_id = 'doc_…'                    -- ✅ 首选
where substr(doc_id, 1, 3) = 'doc'        -- ✅ 需要前缀匹配时
where (doc_id || '') like '%doc%'         -- ✅ 包一层表达式阻止下推
```

后两种都是靠"让优化器认不出这是个纯列约束"来绕过下推的。

### ② `chunk_index` 存进去是 `real`

FTS5 的列没有类型亲和性,数值比较要 CAST:

```sql
select typeof(chunk_index) from chunk_fts limit 1;    -- 'real'

where cast(chunk_index as integer) between 6 and 8    -- ✅
```

### ③ `MATCH` 里必须包双引号

裸写数字或标点会炸:

```sql
... chunk_fts match '42.3'      -- Error: fts5: syntax error near "."
... chunk_fts match '"42.3"'    -- ✅
```

研报里满是数字和代码,这条不注意会在真实查询上崩掉。代码里 `toMatchExpr()`
已经处理了转义。

> 普通表(`documents` / `traces` / `chat_messages` …)没有这些问题,只有 `chunk_fts` 有。

---

## 文档与切块

```sql
-- 有哪些研报
select * from documents;

-- 某篇的块列表
select chunk_index, section_title, length(content) len
from chunk_fts
where doc_id = 'doc_1787472419127_c7mj'
order by cast(chunk_index as int);

-- 看某一块的正文
select substr(content, 1, 300) from chunk_fts
where doc_id = 'doc_1787472419127_c7mj'
  and cast(chunk_index as int) = 7;

-- 某个词出现在哪些块
select chunk_index, section_title from chunk_fts
where doc_id = 'doc_…' and content like '%毛利率区间%';
```

注意最后一条:过滤文档用 `doc_id =`,不要用 `like`(见上面坑 ①)。
`content like` 本身是好的 —— 它和 `match` 是两条不同的路径,
`like` 做纯子串匹配、不打分、不受 3 字限制,查"这个词到底在不在原文里"时很好用。

---

## 跑 BM25(最常用)

```sql
select chunk_index, section_title, round(bm25(chunk_fts), 3) score
from chunk_fts
where doc_id = 'doc_1787472419127_c7mj'
  and chunk_fts match '"毛利率"'
order by score
limit 5;
```

**`bm25()` 返回负数,越小越相关**,所以 `order by score` 升序就是相关性降序。

### 多词查询

代码里 `toMatchExpr()` 把查询切成 3-gram 再 OR 起来,手查时照做:

```sql
... chunk_fts match '"毛利率" OR "利率是" OR "率是多" OR "是多少"'
```

### 按列限定

```sql
... chunk_fts match 'section_title:"生意特征"'      -- 只搜标题
... chunk_fts match 'content:"生意特征"'            -- 只搜正文
... chunk_fts match '{section_title content}:"x"'  -- 指定多列
```

### 中文查询词至少 3 个字

trigram 分词器的限制。2 字词打不中:

```sql
select count(*) from chunk_fts where chunk_fts match '"市值"';    -- 0
select count(*) from chunk_fts where chunk_fts match '"市值："';  -- 有结果
```

---

## 看索引里存了什么

```sql
create virtual table if not exists temp.v using fts5vocab(main, chunk_fts, 'row');

-- 某个 token 的分布:doc = 出现在几块里,cnt = 总次数
select * from temp.v where term = '毛利率';

-- 最高频的 token(会发现全是 markdown 表格符号)
select * from temp.v order by cnt desc limit 10;

-- 索引规模
select count(*) 不同token, sum(cnt) 总出现次数 from temp.v;
```

`temp.` 前缀是临时表,退出就没,不污染库。

---

## Trace(排查一次问答)

```sql
-- 最近几次问答
select id, status, duration_ms, degraded_count, error_count, started_at
from traces order by started_at desc limit 5;

-- 展开某次的 span 树
select name, status, duration_ms, degraded_reason, metadata
from trace_spans where trace_id = 'tr_…'
order by start_offset_ms;
```

`metadata` 是 JSON,关键字段:

| span | 字段 | 含义 |
|---|---|---|
| `doc_retrieval` | `retrieval.ranks` | 每个入选块在向量路/BM25 路各自的名次 |
| `doc_retrieval` | `retrieval.degraded` | `vector_failed` / `bm25_failed` / `both_failed` / `both_empty` |
| `llm_generation` | `citation.coverage` | 引用覆盖率:模型实际用了几块 ÷ 塞了几块 |
| `llm_generation` | `ttfbMs` | 首字延迟 |

> ⚠️ `input` / `output` 被 `MAX_FIELD = 500` 截断,`prompt_assembly` 压根没记 output。
> **完整 prompt 事后查不到**,要看只能开 `LOG_LLM=full` 重新问一次,或者重放。

---

## 各表占多大

```sql
select name, sum(pgsize)/1024 kb from dbstat
where name like 'chunk_fts%' group by name order by kb desc;
```

`dbstat` 是虚表,系统 sqlite3 编译时带了。典型结果:

```
chunk_fts_data      324 KB   ← 真正的倒排索引
chunk_fts_content   100 KB   ← FTS5 存的原文副本
chunk_fts_idx         4 KB
chunk_fts_docsize     4 KB   ← BM25 长度归一化用
chunk_fts_config      4 KB
```

倒排索引约为原文 UTF-8 字节的 **4.4 倍**。注意 `length()` 数字符、
`octet_length()` 数字节,中文一个字 3 字节,比错了会得出 12 倍的错误结论。

---

## 查 ChromaDB

```bash
# 各文档的向量数
sqlite3 ../../data/chroma/chroma.sqlite3 -box "
  select string_value doc_id, count(*) n
  from embedding_metadata where key='doc_id' group by string_value;"

# collection 和维度
sqlite3 ../../data/chroma/chroma.sqlite3 "select name, dimension from collections;"
```

对账用:`chunk_fts` 的块数应该和 Chroma 的向量数一致。不一致说明两个索引不同步,
跑 `pnpm reindex` 重建 FTS,或重新上传文档重建向量。

---

## 备份

```bash
sqlite3 data/research.db "VACUUM INTO 'data/backup.db'"
```

**不要用 `cp`** —— WAL 模式下直接复制文件会漏掉尚未 checkpoint 的内容,
拿到的是残缺备份。`pnpm reset:dev` 脚本里用的就是 `VACUUM INTO`。

---

## SQL 不够用时

### 简单 Node 查询

```bash
node -e "
const D = require('./node_modules/better-sqlite3');
const db = new D('data/research.db', { readonly: true });
console.log(db.prepare('select * from documents').all());
"
```

### 需要调项目里的函数

写临时 `.ts` 文件跑 `npx tsx`:

```typescript
// 必须是第一个 import —— ESM 按顺序求值,晚了 ragConfig 会拿到默认值
// 而不是 .env 里的值(踩过:拿到 maxK=5 而线上是 10,结论全错)
import 'dotenv/config'
import { initDb } from './src/services/db.js'
import { initChunkFtsTable, searchBm25 } from './src/services/chunkFts.js'
import { initDocCollection, searchChunks } from './src/services/documentVector.js'
import { hybridRetrieve } from './src/services/retrieval.js'

const db = initDb()
initChunkFtsTable(db)
await initDocCollection()

const r = await hybridRetrieve('毛利率是多少', 'doc_1787472419127_c7mj', {
  vectorSearch: (q, d) => searchChunks(q, d),
  keywordSearch: (q, d, limit) => searchBm25(db, d, q, limit),
}, {})

console.log(r.meta.ranks)   // 两路名次
```

用完删掉,别留在仓库里。

> 跑任何涉及向量的探针都会调 embedding(付费)。BM25、trace、表结构这些纯 SQLite
> 的查询完全免费,随便跑。

---

## 快速自检清单

排查"检索不对"时按顺序过一遍:

```sql
-- 1. 文档在吗
select id, filename, chunk_count from documents;

-- 2. FTS 索引回填了吗(应与 chunk_count 一致)
select doc_id, count(*) from chunk_fts group by doc_id;

-- 3. 向量索引呢
-- sqlite3 ../../data/chroma/chroma.sqlite3
--   "select string_value, count(*) from embedding_metadata where key='doc_id' group by 1;"

-- 4. 最近的问答降级了吗
select id, status, degraded_count, started_at from traces
order by started_at desc limit 5;

-- 5. 那次检索到底命中了什么
select metadata from trace_spans
where trace_id='tr_…' and name='doc_retrieval';
```

第 2 步为 0 说明 FTS 没回填 —— 正常情况下启动会自愈,没自愈就手动
`pnpm reindex`。
