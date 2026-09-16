# Issue #16 答复草稿

感谢这份非常精确的报告。两个查询的原始载荷把问题定死了：`mode` 描述的不是"这次
检索做了什么"，而是"返回的行里恰好有没有同时带两个分数"。

这个问题已在 `dsh-knowledge@4.0.0` 中修复。

## 根因

`effectiveMode` 用 `ranked.some(hit => hit.vectorScore !== undefined &&
hit.lexicalScore !== undefined)` 来推断"两条通道都参与了"。但 RRF 会把只出现在
一条列表里的命中正常合入结果，这类行天然只有一个分数——于是向量通道明明跑了、
它的命中也确实进了结果集，`mode` 仍然是 `"lexical"`。查询 B 被标成 `hybrid` 只是
因为它的前两行恰好都带两个分数；正如你指出的，这是结果行的巧合，不是检索的属性。

你记录的 `score` 语义漂移也成立：RRF 归一化分数、单通道相似度和重排概率共用同一个
字段，调用方无法从数字本身区分，而这个字段的含义在配置上重排器之后还会再变一次。

## 修复

1. **`mode` 改为报告实际执行的通道**。判定只依据 `retrieval.lexical.succeeded` 和
   `retrieval.vector.succeeded`。按行推断的实现是被删除的，没有留作兜底默认值——否则
   同一个错误还会在别的分支上被静默吞掉。
2. **每次检索返回 `retrieval` 明细**：`requestedMode`、`effectiveMode`，以及每条通道
   的 `attempted` / `succeeded` / `returnedCount`，失败时附 `errorCode`。即使所有行都
   只有 `vectorScore`，调用方现在也能看到向量通道成功并贡献了结果。
3. **新增 `scoreKind`**，取值 `lexical_relevance` / `vector_similarity` / `rrf` /
   `rerank`，说明 `score` 这个数字的含义；它同时出现在 HTTP 响应和 `knowledge_search`
   工具输出里。重排真的生效时是 `rerank`，所以 0.500 系列不会再被读成相似度。
4. 顺带把重排状态改成同一口径：网关拒绝时报告新的 `skipped`（`attempted: false`，并且
   不再输出 `elapsedMs: 0`），不再用 `degraded` 去描述一件根本没有尝试的事。

## 请你确认

在你原来的环境里重跑那两个查询：

- 查询 A 现在应报 `mode: "hybrid"`、`retrieval.vector.succeeded: true`、
  `scoreKind: "rrf"`；
- 启用重排后 `scoreKind` 变为 `"rerank"`，且 `rerank.status` 为 `applied` /
  `skipped` / `degraded` 之一并与 `attempted` 自洽。

所有字段都是加法，原有字段名不变；变化的是 `mode` 的含义——从"某一行有没有两个分数"
变成"哪条通道真的跑了"。如果你那边仍然出现 `mode: "lexical"` 而
`retrieval.vector.succeeded` 为 `true`，那是一个新的 bug，请把新的载荷贴回来。

确认无误后，这个 Issue 就可以按已完成关闭。
