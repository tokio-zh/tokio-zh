# 示例：Echo服务器

我们将使用到目前为止所覆盖的内容来构建echo服务器。这是一个Tokio应用程序，它包含了我们迄今为止学到的所有内容。服务器将简单地从连接的客户端接收消息，并将收到的相同消息发送回客户端。

我们将能够使用我们在`hello world`部分中创建的基本Tcp客户端来测试此echo服务器 。

完整的代码可以在[这里](https://github.com/tokio-rs/tokio/blob/master/examples/echo.rs)找到。

## 创建

首先，生成一个新的箱子。

```bash
$ cargo new --bin echo-server
cd echo-server
```

接下来，添加必要的依赖项：

```toml
[dependencies]
tokio = "0.1"
```

main.rs

```rust
extern crate tokio;
extern crate futures;

use tokio::io;
use tokio::net::TcpListener;
use tokio::prelude::*;
```

现在，我们为服务器设置必要的结构：

* 绑定`TcpListener`到本地端口。
* 定义接受入站连接并处理它们的任务。
* 生成服务器任务。
* 启动Tokio运行时

同样，在执行者上生成服务器任务之前，实际上不会执行任何工作。

```rust
fn main() {
    let addr = "127.0.0.1:6142".parse().unwrap();
    let listener = TcpListener::bind(&addr).unwrap();

    // Here we convert the `TcpListener` to a stream of incoming connections
    // with the `incoming` method. We then define how to process each element in
    // the stream with the `for_each` combinator method
    let server = listener.incoming().for_each(|socket| {
        // TODO: Process socket
        Ok(())
    })
    .map_err(|err| {
        // Handle error by printing to STDOUT.
        println!("accept error = {:?}", err);
    });

    println!("server running on localhost:6142");
    # // `select` completes when the first of the two futures completes. Since
    # // future::ok() completes immediately, the server won't hang waiting for
    # // more connections. This is just so the doc test doesn't hang.
    # let server = server.select(futures::future::ok(())).then(|_| Ok(()));

    // Start the server
    //
    // This does a few things:
    //
    // * Start the Tokio runtime
    // * Spawns the `server` task onto the runtime.
    // * Blocks the current thread until the runtime becomes idle, i.e. all
    //   spawned tasks have completed.
    tokio::run(server);
}
```

在这里，我们创建了一个可以侦听传入TCP连接的`TcpListener`。在监听器上， 我们调用incoming，将监听器转换为入站客户端连接流。然后我们调用for_each，它将产生每个入站客户端连接。 目前我们没有对此入站连接做任何事情 - 这是我们的下一步。

一旦我们拥有了我们的服务器，我们就可以将它交给`tokio::run`。到目前为止，我们的服务器功能一无所获。由Tokio运行时驱动我们的`Future`完成。

注意：我们必须在服务器上调用`map_err`，因为`tokio :: run`需要一个`Item`为type（）和`Error`为type（）的`Future`。 这是为了确保在将`Future`交付给运行时之前处理所有值和错误。

## 处理连接

既然我们有传入的客户端连接，我们应该处理它们。

我们只想将从套接字读取的所有数据复制回套接字本身（例如“echo”）。 我们可以使用标准的`io :: copy`函数来做到这一点。

该copy函数有两个参数，从哪里读取以及在哪里写入。 但是，我们只有一个参数，使用`socket`。 幸运的是，有一个方法[split](https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncRead.html#method.split)，它将可读和可写的流分成两半。 此操作允许我们独立地处理每个流，例如将它们作为`copy`函数的两个参数传递。

然后，`copy`函数返回一个`Future`，当复制操作完成时，将接收此`Future`，解析为复制的数据量。

让我们来看看我们再次传递给`for_each`的闭包。

```rust
let server = listener.incoming().for_each(|socket| {
  // split the socket stream into readable and writable parts
  let (reader, writer) = socket.split();
  // copy bytes from the reader into the writer
  let amount = io::copy(reader, writer);

  let msg = amount.then(|result| {
    match result {
      Ok((amount, _, _)) => println!("wrote {} bytes", amount),
      Err(e)             => println!("error: {}", e),
    }

    Ok(())
  });

  // spawn the task that handles the client connection socket on to the
  // tokio runtime. This means each client connection will be handled
  // concurrently
  tokio::spawn(msg);
  Ok(())
})
```

如您所见，我们已将`socket`流拆分为可读写部分。 然后我们使用`io :: copy`从`reader`读取并写入`writer`。 我们使用`then` 组合器来查看`amount`未来的`Item`和`Error`作为`Result`打印一些诊断。

对[tokio::spawn](https://docs.rs/tokio-executor/0.1/tokio_executor/fn.spawn.html)的调用是关键所在。 至关重要的是我们希望所有`clients`同时取得进展，而不是在完成另一个`client`时阻止其中一个。 为此，我们使用`tokio :: spawn`函数在后台执行工作。

如果我们没有这样做，那么`for_each`中块的每次调用都会在一次解决，这意味着我们永远不会同时处理两个客户端连接！
