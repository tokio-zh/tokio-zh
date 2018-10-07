# Tokio对`async/await`的实验性支持

周一快乐！

如果你还没有听说过，`async / await`是一个Rust正在为之工作的新功能。 它的目的是使异步编程变得简单（好吧，至少比现在简单一点）。 这项工作已经进行了一段时间，今天已经可以在Rust夜间频道上使用了。

我很高兴地宣布Tokio现在有实验性的异步/等待支持！ 让我们深入挖掘一下。

## 入门

首先，Tokio `async / await`支持由一个新的crate提供，创造性地命名为[`tokio-async-await`](https://crates.io/crates/tokio-async-await)。 这个板条箱是Tokio顶部的垫片。 它包含与tokio（作为重新导出）相同的所有类型和功能，以及与async / await一起使用的其他帮助程序。

要使用tokio-async-await，您需要从配置为使用Rust的2018版本的包中依赖它。 它也适用于最近的Rust夜间版本。

在您的应用程序的Cargo.toml中，添加以下内容：

```toml
# At the very top of the file
cargo-features = ["edition"]

# In the `[packages]` section
edition = "2018"

# In the `[dependencies]` section
tokio-async-await = "0.1.0"
```

然后，在您的应用程序中，执行以下操作：

```rust,ignore
// The nightly features that are commonly needed with async / await
#![feature(await_macro, async_await, futures_api)]

// This pulls in the `tokio-async-await` crate. While Rust 2018
// doesn't require `extern crate`, we need to pull in the macros.
#[macro_use]
extern crate tokio;

fn main() {
    // And we are async...
    tokio::run_async(async {
        println!("Hello");
    });
}
```

并运行它 (with nightly):

```txt
cargo +nightly run
```

你正在使用 Tokio + `async` / `await`!

请注意，要生成异步块，应使用`tokio :: run_async`函数（而不是`tokio :: run`）。

## 走得更远

现在，让我们构建一些简单的东西：一个echo服务器（yay）。

```rust,ignore
// Somewhere towards the top

#[macro_use]
extern crate tokio;

use tokio::net::{TcpListener, TcpStream};
use tokio::prelude::*;

// more to come...

// The main function
fn main() {
  let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
  let listener = TcpListener::bind(&addr).unwrap();

    tokio::run_async(async {
        let mut incoming = listener.incoming();

        while let Some(stream) = await!(incoming.next()) {
            let stream = stream.unwrap();
            handle(stream);
        }
    });
}
```

在此示例中，`incoming`是接受的TcpStream值的流。 我们使用`async / await`来迭代流。 目前，只有等待单个值（future）的语法，因此我们使用`next`组合器来获取流中下一个值的`future`。 这允许我们使用while语法迭代流。

一旦我们获得了流，它就会被传递给handle函数进行处理。 让我们看看它是如何实现的。

```rust,ignore
fn handle(mut stream: TcpStream) {
    tokio::spawn_async(async move {
        let mut buf = [0; 1024];

        loop {
            match await!(stream.read_async(&mut buf)).unwrap() {
                0 => break, // Socket closed
                n => {
                    // Send the data back
                    await!(stream.write_all_async(&buf[0..n])).unwrap();
                }
            }
        }
    });
}
```

就像`run_async`一样，有一个`spawn_async`函数可以将`async`块作为任务生成。

然后，为了执行echo逻辑，我们从套接字读入缓冲区并将数据写回同一个套接字。因为我们正在使用`async / await`，所以我们可以使用一个看起来堆栈分配的数组（它实际上最终在堆中）。

请注意，TcpStream具有`read_async`和`write_all_async`函数。这些函数执行与std中Read和Write特性上存在的同步等价物相同的逻辑。差异是，他们返回可以`awaited`的`futures`。

`* _async`函数通过使用扩展`traits`在`tokio-async-await crate`中定义。这些`traits`使用`tokio :: prelude :: *;`导入。

这只是一个开始，请查看存储库中的[examples](https://github.com/tokio-rs/tokio/blob/master/tokio-async-await/examples)目录以获取更多信息。甚至还有一个使用[hyper](https://github.com/tokio-rs/tokio/blob/master/tokio-async-await/examples/hyper.rs)。

## 一些笔记

首先，`tokio-async-await crate`仅提供`async / await`语法的兼容性。它没有为`futures` 0.3箱提供支持。预计用户将继续使用`futures` 0.1以保持与Tokio兼容。

为了使这工作，`tokio-async-await crate`定义了自己的`await!`宏。这个宏是由std提供的一个垫片，可以等待`futures` 0.1的`futures`。这就是兼容层能够保持轻量级和样板免费的方式。

这只是一个开始。随着时间的推移，`async / await`支持将继续发展和改进.

有了这个，祝你有个美好的一周！