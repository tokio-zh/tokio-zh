# Hello World

为了开始我们的Tokio之旅，我们先从我们必修的"hello world"示例开始。 这个程序将会创建一个TCP流并且写入＂hello,world＂到其中．这与写入非Tokio TCP流的Rust程序之间的区别在于该程序在创建流或者将"hello,world"的时候并不会阻塞程序的执行．

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
这里我们使用`tokio`自己[`io`]和[`net`]模块。这些模块提供与网络和I/O操作相同的抽象，与std相应的模块 有很小的差别; 所有操作都是异步执行的。

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
对`TcpStream :: connect`的调用返回创建的TCP流的[`Future`]。我们将在后面的指南中详细了解[`Futures`]，但是现在您可以将aFuture视为表示将来最终会发生的事情的值（在这种情况下将创建流）。这意味着`TcpStream :: connect`可以不等待它返回之前创建流。而是立即返回一个表示创建TCP流工作的值。当这项工作真正执行时，我们会在下面看到 。

`and_then`方法在创建流后生成流。 `and_then`是一个组合函数的示例，用于定义如何处理异步工作。

每个组合器函数都获得必要状态的所有权以及执行的回调，并返回具有附加"步骤"的新Future。这个Future是表示将在某个时间点完成的某些计算的值。

值得重申的是，返回的Future是懒惰的，即在调用组合子时不会执行任何工作。相反，一旦所有异步步骤都被排序，最终Future（表示整个任务）就"生成"（即运行）。这是先前定义的工作开始运行的时间。换句话说，到目前为止我们编写的代码实际上并没有创建TCP流。

稍后我们将更多地探讨futures（以及streams和sinks的相关概念）。

同样重要的是要注意，在我们实际运行未来之前，我们已经调用`map_err`来转换我们可能遇到的任何错误`()`。这可以确保我们承认错误。

接下来，我们将处理流。



## 写入数据

我们的目标是写入"hello world\n"流。

回到`TcpStream::connect(addr).and_then`块。

```rust
let client = TcpStream::connect(&addr).and_then(|stream_result| {
    println!("created stream");

    io::write_all(stream_result.unwrap(), "hello world\n").then(|result| {
      println!("wrote to stream; success={:?}", result.is_ok());
      Ok(())
    })
})
```

[`io::write_all`]函数获取`stream`的所有权，在整个消息写入后返回[`Future`]完成流。 `then`用于对写入完成后运行的步骤进行排序。 在我们的例子中，我们只是向`STDOUT`写一条消息来表示写完了。

注意`result`是一个包含原始流的`Result`。 这允许我们对相同的流进行附加读取或写入。 但是，我们没有其他任何事情要做，所以我们只删除流，然后自动关闭它。

## 运行客户端任务

到目前为止，我们已经`Future`代表了我们的程序要完成的工作，但我们实际上还没有运行它。我们需要一种方法来"产生"这种工作。我们需要一个执行者。

执行程序负责调度异步任务，使其完成。有许多执行器实现可供选择，每个都有不同的优缺点。在此示例中，我们将使用`Tokio`运行时([Tokio runtime][rt])的默认执行 程序。

```rust
println!("About to create the stream and write to it...");
tokio::run(client);
println!("Stream has been created and written to.");
```

`tokio::run `启动运行时，阻止当前线程，直到所有生成的任务完成并且所有资源（如文件和套接字）都已被删除。

到目前为止，我们只在执行程序上运行了一个任务，因此该`client`任务是阻止`run`返回的唯一任务。一旦`run`返回，我们可以确定我们的未来已经完成。

你可以在这里[here][full-code]找到完整的例子。

## 运行代码
[Netcat]是一种从命令行快速创建TCP套接字的工具。以下命令在先前指定的端口上启动侦听TCP套接字。

```bash
$ nc -l -p 6142
```

在不同的终端，我们将运行我们的项目。

```bash
$ cargo run
```

如果一切顺利，你应该看到`hello world`从`Netcat`打印出来。


## 下一步

本指南的下一页将开始深入研究Tokio运行时模型。

[`Future`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html

[rt]: https://docs.rs/tokio/0.1/tokio/runtime/index.html

[`io`]: https://docs.rs/tokio/0.1/tokio/io/index.html

[`net`]: https://docs.rs/tokio/0.1/tokio/net/index.html

[`io::write_all`]: https://docs.rs/tokio-io/0.1/tokio_io/io/fn.write_all.html/io/fn.write_all.html

[full-code]: https://github.com/tokio-rs/tokio/blob/master/examples/hello_world.rs

[Netcat]: http://netcat.sourceforge.net/
