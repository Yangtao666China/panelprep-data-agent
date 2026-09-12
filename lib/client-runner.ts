import type { Dataset, Plan, Result } from "./panelprep";
export function prepareInWorker(
  datasets: Dataset[],
  plan: Plan,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("处理超过 90 秒，请缩小数据量后重试。"));
    }, 90000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      finish();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error("后台数据处理未能完成，请重新载入页面或缩小数据量后重试。"),
      );
    };
    worker.postMessage({ datasets, plan });
  });
}
