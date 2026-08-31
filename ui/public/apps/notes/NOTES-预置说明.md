# 关于 dist/notes.mjs

notes 是这五个出厂应用里唯一有运行时依赖的(`ws` / `yjs` / `y-protocols` / `lib0`)。
为了装完就能跑,随包的是 `dist/notes.mjs` —— esbuild 打出来的自包含单文件,
不需要 node_modules。manifest 指的就是它。

**要改这个 app:**

    npm install
    # 改 src/ 或 ui/src/
    npm run build      # 前端 + 服务端一起重出 dist/

只想跑源码不打包,直接 `node bin/notes.mjs start --foreground`(需要先 npm install)。

上游在 https://github.com/yanglongyun/notes
