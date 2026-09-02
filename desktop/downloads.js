// 下载。
//
// 默认直接落到系统下载文件夹,**不弹保存对话框** —— 浏览器里点个附件还要选路径太啰嗦。
// 代价是用户得知道文件去哪了,所以进度和结果必须推给界面,并且给一条「在访达中显示」。
import { app, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

/** 进行中的下载,给「取消」用。done 之后就没有取消的意义了,随即移除。 */
const live = new Map();
let seq = 0;

/**
 * 重名不覆盖:`报告.pdf` → `报告 (1).pdf`。
 * setSavePath 指到已存在的文件会**直接盖掉**,而用户完全看不出来 ——
 * 这是那种事后才发现、且找不回来的损失。
 */
const freePath = (dir, filename) => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  for (let n = 1; existsSync(candidate) && n < 1000; n += 1) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
  }
  return candidate;
};

export const serveDownloads = (browsing, toRenderer) => {
  browsing.on("will-download", (_event, item) => {
    const id = String((seq += 1));
    const to = freePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(to); // 设了它就不弹对话框
    live.set(id, item);

    const report = (state) => toRenderer("worktop:download", {
      id,
      name: path.basename(to),
      path: to,
      state, // progressing | completed | cancelled | interrupted
      received: item.getReceivedBytes(),
      total: item.getTotalBytes(),
    });

    report("progressing");
    item.on("updated", (__event, state) => report(state === "interrupted" ? "interrupted" : "progressing"));
    item.once("done", (__event, state) => { live.delete(id); report(state); });
  });

  ipcMain.handle("worktop:download-cancel", (_event, id) => { live.get(String(id))?.cancel(); return true; });
  ipcMain.handle("worktop:download-reveal", (_event, target) => { shell.showItemInFolder(String(target)); return true; });
  ipcMain.handle("worktop:download-open", async (_event, target) => {
    const error = await shell.openPath(String(target));
    return !error;
  });
};
