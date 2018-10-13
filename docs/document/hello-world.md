# Hello World

为了开始我们的Tokio之旅，我们先从我们必修的“hello world”示例开始。 这个程序将会创建一个TCP流并且写入＂hello,world＂到其中．这与写入非Tokio TCP流的Rust程序之间的区别在于该程序在创建流或者将"hello,world"的时候并不会阻塞程序的执行．

在开始之前你应该对TCP流的工作方式有一定的了解，相信理解[rust标准库](https://doc.rust-lang.org/std/net/struct.TcpStream.html)实现会对你有很大的帮助

让我们开始吧。

首先，生成一个新的crate。
```bash
$ cargo new --bin hello-world
$ cd hello-world
```
接下来，添加必要的依赖项：

```toml
[dependencies]
tokio = "0.1"
```

在`main.rs`中的引入包和类型：

```rust
extern crate tokio;

use tokio::io;
use tokio::net::TcpStream;
use tokio::prelude::*;
```

## 创建流

第一步是创建TcpStream.我们将使用Tokio实现的TcpStream.

```rust
fn main() {
    // Parse the address of whatever server we're talking to
    let addr = "127.0.0.1:6142".parse().unwrap();
    let stream = TcpStream::connect(&addr);

    // Following snippets come here...
}
```

接下来，我们定义服务器任务。此异步任务将创建一个流，然后一旦它被用于其他的处理程序就生成流．

```rust
let hello_world = TcpStream::connect(&addr).and_then(|stream| {
    println("created stream");

    //Process stream here

    Ok(())
})
.map_err(|err| {
    // All tasks must have an 'Error' type of '()'. This forces error
    // handing and helps avoid silencing failures.
    println!("connection error = {:?}",err);
});
```
TcpStream::



组合函数用于定义异步任务。调用`listener.incoming（）`返回已接受连接的[`Stream`]。  [`Stream`]有点像异步迭代器。

每个组合函数都具有必要状态的所有权回调执行并返回一个新的`Future`或`Stream`额外的“步骤”序列。

返回的 `future`和 `Stream`是懒惰的，即在呼叫时不执行任何工作。相反，一旦所有异步步骤都被序列化，那么最终的`Future`（代表任务）是在执行者(executor)产生。这是开始运行时候定义的工作。

我们将在以后挖掘`Future`和`Stream`。

## 产生任务

执行程序负责调度异步任务，驱动它们完成。有许多执行器实现可供选择，每个都有不同的利弊。在这个例子中，我们将使用`Tokio runtime`。

Tokio运行时是异步应用程序的预配置运行时。它包括一个线程池作为默认执行程序。此线程池已调整为用于异步应用程序。

```rust
#![deny(deprecated)]
extern crate tokio;
extern crate futures;
#
use tokio::io;
use tokio::net::TcpListener;
use tokio::prelude::*;
use futures::future;
fn main() {
let server = future::ok(());

println!("server running on localhost:6142");
tokio::run(server);
}
```

`tokio :: run`启动运行时，阻塞当前线程直到所有生成的任务都已完成，所有资源（如TCP套接字）都已完成
销毁。使用[`tokio :: spawn`] **生成任务必须**从内部发生`runtime`的上下文。

到目前为止，我们只在执行程序上运行一个任务，所以`server`任务是唯一阻止`run`返回。

接下来，我们将处理入站套接字。

## 写入数据

我们的目标是在每个接受的套接字上写上“hello world \ n”。我们会通过定义一个新的异步任务在相同的`current_thread`执行者上执行写入和生成该任务。

回到`incoming().for_each`块。

```rust
#![deny(deprecated)]
extern crate tokio;
#
use tokio::io;
use tokio::net::TcpListener;
use tokio::prelude::*;
fn main() {
    let addr = "127.0.0.1:6142".parse().unwrap();
    let listener = TcpListener::bind(&addr).unwrap();
let server = listener.incoming().for_each(|socket| {
    println!("accepted socket; addr={:?}", socket.peer_addr().unwrap());

    let connection = io::write_all(socket, "hello world\n")
        .then(|res| {
            println!("wrote message; success={:?}", res.is_ok());
            Ok(())
        });

    // Spawn a new task that processes the socket:
    tokio::spawn(connection);

    Ok(())
})
;
}
```

我们正在定义另一个异步任务。这项任务将取得所有权socket，在该套接字上写入消息，然后完成。 `connection`变量保存最后的任务。同样，还没有完成任何工作。

`tokio :: spawn`用于在运行时生成任务。因为`server` future在运行时运行，我们可以产生更多的任务。如果从运行时外部调用，`tokio :: spawn`将会发生混乱。

[`io :: write_all`]函数获取`socket`的所有权，返回[`Future`]在整个消息写入后完成。 `then`用于对写入后运行的步骤进行排序完成。在我们的例子中，我们只是向`STDOUT`写一条消息来表示写完了。

请注意，`res`是包含原始套接字的`Result`。 这允许我们在同一个套接字上对其他读取或写入进行排序。 但是，我们没有其他任何事情可做，所以我们只需删除套接字即可关闭套接字。

你可以在这里找到完整的[例子](https://github.com/tokio-rs/tokio/blob/master/examples/hello_world.rs)

## 下一步

本指南的下一页将开始深入研究Tokio运行时模型。
