import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();
// Bind loopback only — never 0.0.0.0. Port-forwarding an open bind would
// expose unauthenticated single-user data to LAN/remote sites.
app.listen(config.port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "server_listen",
      port: config.port,
      localRecipes: true,
    })
  );
});
