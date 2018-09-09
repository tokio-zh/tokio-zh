---
home: true
heroImage: /imgs/tokio.png
pageClass: front
actionText: QQ群570065685
actionLink: /document/
features:
- title: 快速
  details: Tokio的零成本抽象为您提供裸机性能
- title: 高效
  details: Tokio可以轻松地异步实现协议和程序
- title: 可靠
  details: Tokio利用Rust的所有权和并发模型来确保线程安全
- title: 可扩展
  details: Tokio占用很小，处理规模任务很自然
footer: MIT Licensed | Copyright © 2018-present | krircc
---

# Tokio

用Rust编写快速的网络平台

```rust
// A tiny async echo server with Tokio
extern crate tokio;

use tokio::io;
use tokio::net::TcpListener;
use tokio::prelude::*;

fn main() {
    // Bind the server's socket
    let addr = "127.0.0.1:12345".parse().unwrap();
    let tcp = TcpListener::bind(&addr).unwrap();

    // Iterate incoming connections
    let server = tcp.incoming().for_each(|tcp| {
        // Split up the read and write halves
        let (reader, writer) = tcp.split();

        // Copy the data back to the client
        let conn = io::copy(reader, writer)
            // print what happened
            .map(|(n, _, _)| {
                println!("wrote {} bytes", n)
            })
            // Handle any errors
            .map_err(|err| {
                println!("IO error {:?}", err)
            });

        // Spawn the future as a concurrent task
        tokio::spawn(conn);

        Ok(())
    })
    .map_err(|err| {
        println!("server error {:?}", err);
    });

    // Start the runtime and spin up the server
    tokio::run(server);
}
```