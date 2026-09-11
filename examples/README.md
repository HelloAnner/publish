# 示例

- `routes/weibo.yaml`：用 opencli browser 原语发微博的操作路径示例。

用法：

```bash
mkdir -p ~/.config/publish/routes
cp examples/routes/weibo.yaml ~/.config/publish/routes/
publish routes validate
publish -c "第一条测试" -to weibo --dry-run
```
