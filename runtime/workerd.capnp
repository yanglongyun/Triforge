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
          ( name = "SECRET", text = "1a9a4959db9d412854ec1c69b1e77db84305ac8b550fc50d" ),
        ],
      )
    ),
    ( name = "node", external = ( address = "127.0.0.1:9599" ) ),
  ],
  sockets = [ ( name = "http", address = "127.0.0.1:51739", http = (), service = "overseer" ) ]
);
