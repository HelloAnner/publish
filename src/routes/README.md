# 内置 route

这个目录里的 `*.yaml` / `*.json` 会被自动加载为平台（优先级低于 `~/.config/publish/routes/`）。

仓库自带的示例放在 `examples/routes/`，不会自动生效——想用就复制到
`~/.config/publish/routes/`，或者 `publish routes init <id>` 生成模板。

格式说明见 `examples/routes/weibo.yaml` 与 README 的「自定义平台」章节。
