import { prepare } from "./panelprep";
self.onmessage = (event) => {
  try {
    self.postMessage({ result: prepare(event.data.datasets, event.data.plan) });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
