// @ts-nocheck
import { startServer } from "./server/http.js";

const port = Number(process.env.WORKBENCH_PORT) || 9506;
await startServer(port);
