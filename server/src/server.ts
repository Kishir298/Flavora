import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "server_listen",
      port: config.port,
      mock: config.useMockRecipes,
    })
  );
});
