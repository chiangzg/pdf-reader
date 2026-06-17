# Traefik 证书存储

`acme.json` 由 Traefik 自动写入 Let's Encrypt 证书。**首次部署前必须执行：**

```bash
touch proxy/acme.json
chmod 600 proxy/acme.json
```

该文件已在 `.gitignore` 中，不会提交。
