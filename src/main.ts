import "./styles.css";
import { MegaminxApp } from "./app/controller";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root element.");

const app = new MegaminxApp(root);

window.addEventListener(
  "beforeunload",
  () => {
    app.dispose();
  },
  { once: true },
);
