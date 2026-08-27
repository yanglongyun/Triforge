# 由 Workbench 启动时生成,勿手改(server/gadgets.ts)
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "overseer",
      worker = (
        modules = [ ( name = "overseer.js", esModule = embed "overseer.js" ) ],
        compatibilityDate = "2026-02-01",
        bindings = [
          ( name = "LOADER", workerLoader = ( id = "apps" ) ),
          ( name = "NODE", service = "node" ),
          ( name = "SECRET", text = "3c6841899382152456eb6f04dd2936e28aabccc638472c31" ),
        ],
      )
    ),
    ( name = "node", external = ( address = "127.0.0.1:9599" ) ),
  ],
  sockets = [ ( name = "http", address = "127.0.0.1:64760", http = (), service = "overseer" ) ]
);
