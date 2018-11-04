# 示例：聊天服务器

我们将使用到目前为止已经涵盖的内容来构建聊天服务器。 这是一个非平凡的Tokio服务器应用程序。

服务器将使用基于行的协议。 行以`\ r \ n`结束。 这与telnet兼容，因此我们只使用telnet作为客户端。 当客户端连接时，它必须通过发送包含其“缺口”的行来标识自己（即，用于在其 `Peer`中标识客户端的某个名称）。

识别出客户端后，所有发送的行都以[nick]:为前缀,并广播给所有其他连接的客户端。

完整的代码可以在[这里](https://github.com/tokio-rs/tokio/blob/master/examples/chat.rs)找到。 请注意，Tokio提供了一些尚未涵盖的额外抽象，这些抽象将使聊天服务器能够用更少的代码编写。

首先，生成一个新的箱子。

```rust
$ cargo new --bin line-chat
cd line-chat
```

接下来，添加必要的依赖项：

```rust
[dependencies]
tokio = "0.1"
tokio-io = "0.1"
futures = "0.1"
bytes = "0.4"
```

```rust
extern crate tokio;
#[macro_use]
extern crate futures;
extern crate bytes;

use tokio::io;
use tokio::net::{TcpListener, TcpStream};
use tokio::prelude::*;
use futures::sync::mpsc;
use futures::future::{self, Either};
use bytes::{BytesMut, Bytes, BufMut};

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

/// Shorthand for the transmit half of the message channel.
type Tx = mpsc::UnboundedSender<Bytes>;

/// Shorthand for the receive half of the message channel.
type Rx = mpsc::UnboundedReceiver<Bytes>;
```

现在，我们为服务器设置必要的结构。 这些步骤与Hello World中使用的步骤相同！ 例：

* 将TcpListener绑定到本地端口。
* 定义接受入站连接并处理它们的任务。
* 启动Tokio运行时
* 产生服务器任务。

同样，在执行程序上生成服务器任务之前，实际上不会发生任何工作。

```rust
fn main() {
    let addr = "127.0.0.1:6142".parse().unwrap();
    let listener = TcpListener::bind(&addr).unwrap();

    let server = listener.incoming().for_each(move |socket| {
        // TODO: Process socket
        Ok(())
    })
    .map_err(|err| {
        // Handle error by printing to STDOUT.
        println!("accept error = {:?}", err);
    });

    println!("server running on localhost:6142");

    // Start the server
    //
    // This does a few things:
    //
    // * Start the Tokio runtime (reactor, threadpool, etc...)
    // * Spawns the `server` task onto the runtime.
    // * Blocks the current thread until the runtime becomes idle, i.e. all
    //   spawned tasks have completed.
    tokio::run(server);
}
```

## Chat State

聊天服务器要求从一个客户端接收的消息被广播到所有其他连接的客户端。 这将使用通过mpsc通道传递的消息来完成。

每个客户端套接字都将由任务管理。 每个任务都有一个关联的mpsc通道，用于接收来自其他客户端的消息。 所有这些通道的发送一半存储在Rc单元中以使它们可访问。

在这个例子中，我们将使用无界通道。 理想情况下，渠道永远不应该是无限制的，但在这种情况下处理背压有点棘手。 我们将把通道限制在后面专门用于处理背压的部分。

以下是共享状态的定义方式（上面已完成Tx类型别名）：

```rust
struct Shared {
    peers: HashMap<SocketAddr, Tx>,
}
```

然后，在main函数的最顶部，创建状态实例。 此状态实例将移动到接受传入连接的任务中。

```rust
let state = Arc::new(Mutex::new(Shared::new()));
```

现在我们可以处理传入的连接。 服务器任务更新为：

```rust
listener.incoming().for_each(move |socket| {
    process(socket, state.clone());
    Ok(())
})
```

服务器任务将所有套接字以及服务器状态的克隆传递给进程函数。 我们来定义那个功能。 它将具有这样的结构：

```rust
fn process(socket: TcpStream, state: Arc<Mutex<Shared>>) {
    // Define the task that processes the connection.
    let task = unimplemented!();

    // Spawn the task
    tokio::spawn(task);
}
```

对tokio :: spawn的调用将在当前的Tokio运行时生成一个新任务。 所有工作线程都保留对存储在线程局部变量中的当前运行时的引用。 注意，尝试从Tokio运行时外部调用tokio :: spawn将导致恐慌。

所有连接处理逻辑必须能够理解协议。 该协议是基于行的，由\ r \ n终止。 它不是在字节流级别工作，而是更容易在帧级工作，即使用表示原子消息的值。

我们实现了一个包含套接字的编解码器，并公开了一个采用和消耗行的API。

## 线性编解码器

对于采用字节流类型（AsyncRead + AsyncWrite）并在帧级别公开读写API的类型，编解码器是一个松散术语。 tokio-io crate为编写编解码器提供了额外的帮助，在这个例子中，我们将手动完成。

`Lines`编解码器定义如下：

```rust
struct Lines {
    socket: TcpStream,
    rd: BytesMut,
    wr: BytesMut,
}

impl Lines {
    /// Create a new `Lines` codec backed by the socket
    fn new(socket: TcpStream) -> Self {
        Lines {
            socket,
            rd: BytesMut::new(),
            wr: BytesMut::new(),
        }
    }
}
```

从套接字读取的数据缓冲到rd中。 读取完整行后，将返回给调用者。 调用者提交以写入套接字的行被缓冲到`wr`中，然后刷新。

这是读取一半的实现方式：

```rust
impl Stream for Lines {
    type Item = BytesMut;
    type Error = io::Error;

    fn poll(&mut self) -> Result<Async<Option<Self::Item>>, Self::Error> {
        // First, read any new data that might have been received
        // off the socket
        //
        // We track if the socket is closed here and will be used
        // to inform the return value below.
        let sock_closed = self.fill_read_buf()?.is_ready();

        // Now, try finding lines
        let pos = self.rd.windows(2)
            .position(|bytes| bytes == b"\r\n");

        if let Some(pos) = pos {
            // Remove the line from the read buffer and set it
            // to `line`.
            let mut line = self.rd.split_to(pos + 2);

            // Drop the trailing \r\n
            line.split_off(pos);

            // Return the line
            return Ok(Async::Ready(Some(line)));
        }

        if sock_closed {
            Ok(Async::Ready(None))
        } else {
            Ok(Async::NotReady)
        }
    }
}

impl Lines {
    fn fill_read_buf(&mut self) -> Result<Async<()>, io::Error> {
        loop {
            // Ensure the read buffer has capacity.
            //
            // This might result in an internal allocation.
            self.rd.reserve(1024);

            // Read data into the buffer.
            //
            // The `read_buf` fn is provided by `AsyncRead`.
            let n = try_ready!(self.socket.read_buf(&mut self.rd));

            if n == 0 {
                return Ok(Async::Ready(()));
            }
        }
    }
}
```

该示例使用字节包中的BytesMut。 这为在网络环境中处理字节序列提供了一些很好的实用程序。 Stream实现产生的BytesMut值只包含一行。

与往常一样，实现返回Async的函数的关键是永远不会返回Async :: NotReady，除非函数实现收到Async :: NotReady本身。 在此示例中，仅当fill_read_buf返回NotReady时才返回NotReady，如果TcpStream :: read_buf返回NotReady，则fill_read_buf仅返回NotReady。

```rust
struct Lines {
    socket: TcpStream,
    rd: BytesMut,
    wr: BytesMut,
}
impl Lines {
    fn buffer(&mut self, line: &[u8]) {
        // Push the line onto the end of the write buffer.
        //
        // The `put` function is from the `BufMut` trait.
        self.wr.put(line);
    }

    fn poll_flush(&mut self) -> Poll<(), io::Error> {
        // As long as there is buffered data to write, try to write it.
        while !self.wr.is_empty() {
            // Try to write some bytes to the socket
            let n = try_ready!(self.socket.poll_write(&self.wr));

            // As long as the wr is not empty, a successful write should
            // never write 0 bytes.
            assert!(n > 0);

            // This discards the first `n` bytes of the buffer.
            let _ = self.wr.split_to(n);
        }

        Ok(Async::Ready(()))
    }
}
fn main() {}
```

调用者通过调用缓冲区对所有行进行排队。 这会将该行附加到内部wr缓冲区。 然后，一旦所有数据排队，调用者就会调用poll_flush，它会对套接字进行实际写入操作。 poll_flush仅在所有排队数据成功写入套接字后才返回Ready。

与读取半部分类似，仅在函数实现收到NotReady本身时返回NotReady。

Lines编解码器在进程函数中使用如下：

```rust
fn process(socket: TcpStream, state: Arc<Mutex<Shared>>) {
    // Wrap the socket with the `Lines` codec that we wrote above.
    let lines = Lines::new(socket);

    // The first line is treated as the client's name. The client
    // is not added to the set of connected peers until this line
    // is received.
    //
    // We use the `into_future` combinator to extract the first
    // item from the lines stream. `into_future` takes a `Stream`
    // and converts it to a future of `(first, rest)` where `rest`
    // is the original stream instance.
    let connection = lines.into_future()
        // `into_future` doesn't have the right error type, so map
        // the error to make it work.
        .map_err(|(e, _)| e)
        // Process the first received line as the client's name.
        .and_then(|(name, lines)| {
            let name = match name {
                Some(name) => name,
                None => {
                    // TODO: Handle a client that disconnects
                    // early.
                    unimplemented!();
                }
            };

            // TODO: Rest of the process function
        });
}
```

## 广播消息

下一步是实现处理实际聊天功能的连接处理逻辑，即从一个客户端向所有其他客户端广播消息。

为了实现这一点，我们将明确地实现一个Future，它接受Lines编解码器实例并处理广播逻辑。 这个逻辑处理：

* 在其消息通道上接收消息并将其写入套接字。
* 从套接字接收消息并将其广播给所有 `Peer`。

完全使用组合器实现此逻辑也是可能的，但需要使用拆分，但尚未涉及。 此外，这提供了一个机会，可以看到如何手动实现一个非平凡的 `future`。

以下是处理连接的广播逻辑的 `future`定义：

```rust
struct Peer {
    /// Name of the peer. This is the first line received from the client.
    name: BytesMut,

    /// The TCP socket wrapped with the `Lines` codec.
    lines: Lines,

    /// Handle to the shared chat state.
    state: Arc<Mutex<Shared>>,

    /// Receive half of the message channel.
    ///
    /// This is used to receive messages from peers. When a message is received
    /// off of this `Rx`, it will be written to the socket.
    rx: Rx,

    /// Client socket address.
    ///
    /// The socket address is used as the key in the `peers` HashMap. The
    /// address is saved so that the `Peer` drop implementation can clean up its
    /// entry.
    addr: SocketAddr,
}
```

并且创建如下`Peer`实例：

```rust
impl Peer {
    fn new(name: BytesMut,
           state: Arc<Mutex<Shared>>,
           lines: Lines) -> Peer
    {
        // Get the client socket address
        let addr = lines.socket.peer_addr().unwrap();

        // Create a channel for this peer
        let (tx, rx) = mpsc::unbounded();

        // Add an entry for this `Peer` in the shared state map.
        state.lock().unwrap()
            .peers.insert(addr, tx);

        Peer {
            name,
            lines,
            state,
            rx,
            addr,
        }
    }
}
```

为其他 `Peer`创建mpsc通道，以将其消息发送到此新创建的 `Peer`。 在创建信道之后，将发送半部分插入 `Peer`映射中。 此条目在Peer的drop实现中删除。

```rust
impl Drop for Peer {
    fn drop(&mut self) {
        self.state.lock().unwrap().peers
            .remove(&self.addr);
    }
}
```

这是实现

```rust
impl Future for Peer {
    type Item = ();
    type Error = io::Error;

    fn poll(&mut self) -> Poll<(), io::Error> {
        // Receive all messages from peers.
        loop {
            // Polling an `UnboundedReceiver` cannot fail, so `unwrap`
            // here is safe.
            match self.rx.poll().unwrap() {
                Async::Ready(Some(v)) => {
                    // Buffer the line. Once all lines are buffered,
                    // they will be flushed to the socket (right
                    // below).
                    self.lines.buffer(&v);
                }
                _ => break,
            }
        }

        // Flush the write buffer to the socket
        let _ = self.lines.poll_flush()?;

        // Read new lines from the socket
        while let Async::Ready(line) = self.lines.poll()? {
            println!("Received line ({:?}) : {:?}", self.name, line);

            if let Some(message) = line {
                // Append the peer's name to the front of the line:
                let mut line = self.name.clone();
                line.put(": ");
                line.put(&message);
                line.put("\r\n");

                // We're using `Bytes`, which allows zero-copy clones
                // (by storing the data in an Arc internally).
                //
                // However, before cloning, we must freeze the data.
                // This converts it from mutable -> immutable,
                // allowing zero copy cloning.
                let line = line.freeze();

                // Now, send the line to all other peers
                for (addr, tx) in &self.state.lock().unwrap().peers {
                    // Don't send the message to ourselves
                    if *addr != self.addr {
                        // The send only fails if the rx half has been
                        // dropped, however this is impossible as the
                        // `tx` half will be removed from the map
                        // before the `rx` is dropped.
                        tx.unbounded_send(line.clone()).unwrap();
                    }
                }
            } else {
                // EOF was reached. The remote client has disconnected.
                // There is nothing more to do.
                return Ok(Async::Ready(()));
            }
        }

        // As always, it is important to not just return `NotReady`
        // without ensuring an inner future also returned `NotReady`.
        //
        // We know we got a `NotReady` from either `self.rx` or
        // `self.lines`, so the contract is respected.
        Ok(Async::NotReady)
    }
}
```

剩下的就是连接刚刚实施的Peer `future`。 为此，将客户端连接任务（在`process`函数中定义）扩展为使用Peer。

```rust
let connection = lines.into_future()
    .map_err(|(e, _)| e)
    .and_then(|(name, lines)| {
        // If `name` is `None`, then the client disconnected without
        // actually sending a line of data.
        //
        // Since the connection is closed, there is no further work
        // that we need to do. So, we just terminate processing by
        // returning `future::ok()`.
        //
        // The problem is that only a single future type can be
        // returned from a combinator closure, but we want to
        // return both `future::ok()` and `Peer` (below).
        //
        // This is a common problem, so the `futures` crate solves
        // this by providing the `Either` helper enum that allows
        // creating a single return type that covers two concrete
        // future types.
        let name = match name {
            Some(name) => name,
            None => {
                // The remote client closed the connection without
                // sending any data.
                return Either::A(future::ok(()));
            }
        };

        println!("`{:?}` is joining the chat", name);

        // Create the peer.
        //
        // This is also a future that processes the connection, only
        // completing when the socket closes.
        let peer = Peer::new(
            name,
            state,
            lines);

        // Wrap `peer` with `Either::B` to make the return type fit.
        Either::B(peer)
    })
    // Task futures have an error of type `()`, this ensures we handle
    // the error. We do this by printing the error to STDOUT.
    .map_err(|e| {
        println!("connection error = {:?}", e);
    });
```

除了添加Peer之外，还会处理name == None。 在这种情况下，远程客户端在识别自身之前终止。

返回多个 `future`（`name == None` handler和 `Peer`）通过将返回的 `future`包装在Either中来处理。 要么是枚举，要为每个变体接受不同的 `future`类型。 这允许返回多个 `future`类型而不到达`trait`对象。
