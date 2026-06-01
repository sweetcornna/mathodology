import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { ensureAuthCookie } from "./api/figures";
import "katex/dist/katex.min.css";
import "./styles.css";

// Set the `mm_auth` cookie so same-origin <img>/<a> asset GETs (figures,
// notebook, paper) authenticate without a token in the URL (D8).
ensureAuthCookie();

createApp(App).use(createPinia()).use(router).mount("#app");
